// npm run load:test (AB#962, ISP-266): the server at release scale, in its production image, with real sockets.
//
//   npm run load:test                                   200 corporations for 10 minutes
//   npm run load:test -- --corps 500 --minutes 5
//   npm run load:test -- --json out.json                also write the numbers as JSON
//
// How: bench-ticks' template corporation (office, five staff, a lease mining, research and a CEO program queued, a full
// finance history) is cloned N times into a scratch data directory. The image is built from this checkout and run
// locally with production's size (0.5 CPU, 1 GiB, ops/infra/isp/isp.bicep), NODE_ENV=production, a throwaway JWT secret
// and the data directory mounted at /data. scripts/load-probe.mjs is loaded into it to time every ticker and sample
// event-loop delay and memory from inside. This process connects one socket.io client per corporation (default
// transports, as the page does), each holding an access token signed with the throwaway secret, and while connected
// each reads its account over HTTP every 20 s and says one line in global chat about once a minute. Nothing touches
// production: no Azure resource, no real secret.
//
// What it cannot see: the seeded world has no concessions, arbitration cases, patents, lobbying, raids, bonds or share
// offerings, so those tickers are timed over empty stores; every corporation is a clone, so they finish things at the
// same moments; one machine plays every client, over loopback, so there is no network latency; and Docker Desktop's
// CPU cap is not Azure's.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import jwt from "jsonwebtoken";
import { io } from "socket.io-client";
import { cloneTemplate } from "./bench-ticks.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "..");

/** The budgets the report flags against. A ticker's p95 may use half its interval; the event loop's p99 delay 100 ms. */
export const BUDGET = { tickerShareOfInterval: 0.5, eventLoopP99Ms: 100, memoryShareOfLimit: 0.8, httpP95Ms: 500 };

export function parseArgs(argv) {
  const opts = { corps: 200, minutes: 10, cpus: "0.5", memory: "1g", json: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--corps") { opts.corps = Math.max(1, Number(value) || opts.corps); i++; }
    else if (flag === "--minutes") { opts.minutes = Math.max(0.5, Number(value) || opts.minutes); i++; }
    else if (flag === "--cpus") { opts.cpus = String(value); i++; }
    else if (flag === "--memory") { opts.memory = String(value); i++; }
    else if (flag === "--json") { opts.json = value; i++; }
    else if (flag === "--keep") opts.keep = true;
  }
  return opts;
}

/** The value at percentile p of a list of numbers, or 0 for none. */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * A name for a timer's call site, read from the source line: the ticker functions it calls ("dominanceTick",
 * "loanServicingTick + defaultRecoveryTick"), or else the function the line sits in, or else the site itself.
 */
export function labelFor(site, readSource = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")) {
  const [file, lineNo] = [site.slice(0, site.lastIndexOf(":")), Number(site.slice(site.lastIndexOf(":") + 1))];
  let lines;
  try { lines = readSource(file).split(/\r?\n/); } catch { return site; }
  const line = lines[lineNo - 1] || "";
  const calls = [...new Set([...line.matchAll(/\b([a-z]\w*(?:Tick|Completions|Orders))\b/g)].map((m) => m[1]))];
  if (calls.length) return calls.join(" + ");
  for (let i = lineNo - 1; i >= 0; i--) {
    const fn = lines[i].match(/function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (fn) return `${fn[1] || fn[2]} (${site})`;
  }
  return site;
}

/** The report's numbers from the probe's lines, the clients' counts and docker's samples. */
export function summarize({ probeLines, clientWindows, httpTimes, dockerSamples, memoryLimitBytes, durationSec, label = labelFor }) {
  const timers = new Map();
  for (const l of probeLines) for (const [site, t] of Object.entries(l.timers || {})) {
    const cur = timers.get(site) || { site, kind: t.kind, everyMs: t.everyMs, times: [] };
    cur.times.push(...t.times);
    timers.set(site, cur);
  }
  const tickers = [...timers.values()].map((t) => ({
    name: label(t.site), site: t.site, kind: t.kind, everyMs: t.everyMs, runs: t.times.length,
    p50: percentile(t.times, 50), p95: percentile(t.times, 95), max: Math.max(...t.times),
    busyShare: t.times.reduce((s, x) => s + x, 0) / (durationSec * 1000)
  })).sort((a, b) => b.p95 - a.p95);
  const eld = probeLines.map((l) => l.eventLoopDelay).filter(Boolean);
  const rss = probeLines.map((l) => l.memory?.rss).filter(Number.isFinite);
  const heap = probeLines.map((l) => l.memory?.heapUsed).filter(Number.isFinite);
  const perSecond = clientWindows.map((w) => w.events / w.seconds);
  const byEvent = {};
  for (const w of clientWindows) for (const [k, v] of Object.entries(w.byEvent)) byEvent[k] = (byEvent[k] || 0) + v;
  const totalSeconds = clientWindows.reduce((s, w) => s + w.seconds, 0) || 1;
  const cpu = dockerSamples.map((d) => d.cpuPercent).filter(Number.isFinite);
  const dmem = dockerSamples.map((d) => d.memBytes).filter(Number.isFinite);
  return {
    tickers,
    eventLoop: { p50OfWindows: percentile(eld.map((e) => e.p50), 50), worstP99: Math.max(0, ...eld.map((e) => e.p99)), worstMax: Math.max(0, ...eld.map((e) => e.max)), windowsOverBudget: eld.filter((e) => e.p99 > BUDGET.eventLoopP99Ms).length, windows: eld.length },
    memory: { rssStart: rss[0] || 0, rssMax: Math.max(0, ...rss), rssEnd: rss.at(-1) || 0, heapMax: Math.max(0, ...heap), containerMax: Math.max(0, ...dmem), limit: memoryLimitBytes },
    fanOut: { meanPerSecond: perSecond.reduce((s, x) => s + x, 0) / (perSecond.length || 1), peakPerSecond: Math.max(0, ...perSecond), bytesPerSecond: clientWindows.reduce((s, w) => s + w.bytes, 0) / totalSeconds, byEvent: Object.fromEntries(Object.entries(byEvent).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v / totalSeconds])) },
    http: { requests: httpTimes.length, p50: percentile(httpTimes.map((h) => h.ms), 50), p95: percentile(httpTimes.map((h) => h.ms), 95), errors: httpTimes.filter((h) => !h.ok).length },
    cpu: { meanPercent: cpu.reduce((s, x) => s + x, 0) / (cpu.length || 1), maxPercent: Math.max(0, ...cpu) },
    connectedMin: Math.min(...clientWindows.map((w) => w.connected)), connectedMax: Math.max(0, ...clientWindows.map((w) => w.connected))
  };
}

const f = (n) => (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US"));
const mb = (b) => `${Math.round(b / 1024 / 1024)} MB`;

/** The report as text, with the budget lines that fail marked OVER. */
export function renderReport(s, opts, machine) {
  const out = [];
  out.push(`${opts.corps} corporations, ${opts.minutes} min, production image at --cpus ${opts.cpus} --memory ${opts.memory}. ${machine}`);
  out.push(`Clients connected: ${s.connectedMin} to ${s.connectedMax} of ${opts.corps}. Times are the synchronous part of each run (what holds the event loop), in ms.`);
  out.push("");
  out.push(`${"timer".padEnd(44)} | ${"every".padStart(6)} | ${"runs".padStart(5)} | ${"p50".padStart(8)} | ${"p95".padStart(8)} | ${"max".padStart(8)} | busy`);
  for (const t of s.tickers) {
    out.push(`${t.name.slice(0, 44).padEnd(44)} | ${(t.kind === "interval" ? `${t.everyMs / 1000}s` : "once").padStart(6)} | ${String(t.runs).padStart(5)} | ${f(t.p50).padStart(8)} | ${f(t.p95).padStart(8)} | ${f(t.max).padStart(8)} | ${(t.busyShare * 100).toFixed(1)}%`);
  }
  const busy = s.tickers.reduce((sum, t) => sum + t.busyShare, 0);
  out.push(`All timers together hold the event loop ${(busy * 100).toFixed(1)}% of the run.`);
  out.push("");
  out.push(`Event-loop delay: median window p50 ${f(s.eventLoop.p50OfWindows)} ms; worst window p99 ${f(s.eventLoop.worstP99)} ms, max ${f(s.eventLoop.worstMax)} ms; ${s.eventLoop.windowsOverBudget} of ${s.eventLoop.windows} five-second windows over ${BUDGET.eventLoopP99Ms} ms at p99.`);
  out.push(`Memory: RSS ${mb(s.memory.rssStart)} at start, ${mb(s.memory.rssMax)} peak, ${mb(s.memory.rssEnd)} at end; heap peak ${mb(s.memory.heapMax)}; container peak ${mb(s.memory.containerMax)} of ${mb(s.memory.limit)}.`);
  out.push(`CPU (docker stats, 100% = one core): mean ${f(s.cpu.meanPercent)}%, peak ${f(s.cpu.maxPercent)}%.`);
  out.push(`Socket fan-out received by the clients: mean ${f(s.fanOut.meanPerSecond)} events/s, peak ${f(s.fanOut.peakPerSecond)}/s, ${f(s.fanOut.bytesPerSecond / 1024)} KiB/s of payload.`);
  out.push(`  by event (per second): ${Object.entries(s.fanOut.byEvent).slice(0, 8).map(([k, v]) => `${k} ${f(v)}`).join(", ")}`);
  out.push(`HTTP GET /api/accounts/:id: ${s.http.requests} requests, p50 ${f(s.http.p50)} ms, p95 ${f(s.http.p95)} ms, ${s.http.errors} errors.`);
  out.push("");
  const over = [];
  for (const t of s.tickers) if (t.kind === "interval" && t.everyMs && t.p95 > t.everyMs * BUDGET.tickerShareOfInterval) over.push(`OVER  ${t.name}: p95 ${f(t.p95)} ms against half its ${t.everyMs / 1000}s interval`);
  if (s.eventLoop.worstP99 > BUDGET.eventLoopP99Ms) over.push(`OVER  event-loop delay: worst p99 ${f(s.eventLoop.worstP99)} ms against ${BUDGET.eventLoopP99Ms} ms`);
  const memPeak = Math.max(s.memory.containerMax, s.memory.rssMax);
  if (s.memory.limit && memPeak > s.memory.limit * BUDGET.memoryShareOfLimit) over.push(`OVER  memory: ${mb(memPeak)} against ${BUDGET.memoryShareOfLimit * 100}% of ${mb(s.memory.limit)}`);
  if (s.http.p95 > BUDGET.httpP95Ms) over.push(`OVER  HTTP p95: ${f(s.http.p95)} ms against ${BUDGET.httpP95Ms} ms`);
  if (s.http.errors) over.push(`OVER  HTTP errors: ${s.http.errors}`);
  if (s.connectedMin < opts.corps) over.push(`OVER  sockets: as few as ${s.connectedMin} of ${opts.corps} connected in some window`);
  out.push(...(over.length ? over : ["Everything is within budget."]));
  return out.join("\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function docker(args, opts = {}) {
  const res = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (res.status !== 0) throw new Error(`docker ${args[0]} failed (${res.status}): ${(res.stderr || res.stdout || "").slice(-2000)}`);
  return res.stdout.trim();
}

function parseBytes(s) {
  const m = String(s).trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!m) return NaN;
  const unit = m[2].toUpperCase().replace("I", "");
  return Number(m[1]) * ({ B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "isp-load-"));
  const dataDir = path.join(work, "data");
  const probeDir = path.join(work, "probe");
  fs.mkdirSync(probeDir, { recursive: true });
  const secret = crypto.randomBytes(48).toString("hex"); // throwaway: signs this run's tokens and nothing else
  const name = `isp-load-${process.pid}`;
  let started = false;
  try {
    // 1. The world: bench-ticks' template corporation, cloned N times, every clone verified.
    process.stderr.write(`building the template corporation...\n`);
    const templateDir = path.join(work, "template");
    fs.mkdirSync(templateDir);
    const tpl = spawnSync(process.execPath, [path.join(ROOT, "scripts", "bench-ticks.mjs"), "template"], {
      cwd: ROOT, encoding: "utf8", timeout: 5 * 60_000,
      env: { ...process.env, ISP_DATA_DIR: templateDir, ISP_DISABLE_TICKERS: "1", PORT: "0", NODE_ENV: "test", JWT_SECRET: secret, ISP_DEV: "1" }
    });
    const tplLine = (tpl.stdout || "").trim().split("\n").reverse().find((l) => l.startsWith("{"));
    if (tpl.status !== 0 || !tplLine) throw new Error(`template failed: ${(tpl.stderr || "").slice(-2000)}`);
    cloneTemplate(templateDir, JSON.parse(tplLine).id, opts.corps, dataDir);
    const snapPath = path.join(dataDir, "accounts-snapshot.json");
    const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    const ids = Object.keys(snap.accounts);
    for (const id of ids) snap.accounts[id].emailVerifiedAt = snap.accounts[id].emailVerifiedAt || new Date().toISOString();
    fs.writeFileSync(snapPath, JSON.stringify(snap));
    fs.copyFileSync(path.join(ROOT, "scripts", "load-probe.mjs"), path.join(probeDir, "load-probe.mjs"));

    // 2. The production image, built from this checkout (never a working tree's data: Bug #4806), run at production's size.
    process.stderr.write(`building the image...\n`);
    docker(["build", "-q", "-t", "isp-load:local", ROOT], { timeout: 15 * 60_000 });
    docker(["run", "-d", "--rm", "--name", name, "--cpus", opts.cpus, "--memory", opts.memory, "-p", "127.0.0.1::3000",
      "-v", `${dataDir}:/data`, "-v", `${probeDir}:/probe`,
      "-e", `JWT_SECRET=${secret}`, "-e", "NODE_OPTIONS=--import=/probe/load-probe.mjs", "-e", "ISP_LOAD_METRICS=/probe/metrics.jsonl",
      "isp-load:local"]);
    started = true;
    const port = docker(["port", name, "3000/tcp"]).split("\n")[0].split(":").pop();
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      if (i > 120) throw new Error(`the container did not answer /healthz:\n${docker(["logs", "--tail", "50", name])}`);
      await sleep(500);
    }
    const memoryLimitBytes = Number(docker(["inspect", "-f", "{{.HostConfig.Memory}}", name])) || 0;
    process.stderr.write(`server up at ${base}; connecting ${ids.length} clients...\n`);

    // 3. The clients.
    let window = { events: 0, bytes: 0, byEvent: {} };
    const clientWindows = [];
    const httpTimes = [];
    const sockets = [];
    const timers = [];
    const endAt = Date.now() + opts.minutes * 60_000;
    for (const [i, id] of ids.entries()) {
      const token = jwt.sign({ sub: id, kind: "access", pwc: 0 }, secret, { expiresIn: "6h" });
      const socket = io(base, { auth: { token }, reconnection: true });
      socket.onAny((event, ...args) => {
        window.events += 1;
        window.byEvent[event] = (window.byEvent[event] || 0) + 1;
        try { window.bytes += JSON.stringify(args).length; } catch { /* unmeasurable payload */ }
      });
      sockets.push(socket);
      const read = async () => {
        const start = performance.now();
        try {
          const res = await fetch(`${base}/api/accounts/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          await res.arrayBuffer();
          httpTimes.push({ ms: performance.now() - start, ok: res.ok });
        } catch { httpTimes.push({ ms: performance.now() - start, ok: false }); }
      };
      timers.push(setTimeout(() => timers.push(setInterval(read, 20_000)), Math.random() * 20_000));
      const chat = () => { if (socket.connected) socket.emit("chat:send", { channel: "global", content: `load line from corporation ${i}` }); timers.push(setTimeout(chat, 45_000 + Math.random() * 30_000)); };
      timers.push(setTimeout(chat, 10_000 + Math.random() * 60_000));
      if (i % 20 === 19) await sleep(1_000); // connect in waves, as players arrive, not all in one tick
    }

    // 4. Sample every 5 s until the end.
    const dockerSamples = [];
    let last = Date.now();
    while (Date.now() < endAt) {
      await sleep(5_000);
      const now = Date.now();
      clientWindows.push({ ...window, seconds: (now - last) / 1000, connected: sockets.filter((s) => s.connected).length });
      window = { events: 0, bytes: 0, byEvent: {} };
      last = now;
      if (clientWindows.length % 3 === 0) {
        try {
          const [cpu, mem] = docker(["stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", name]).split("|");
          dockerSamples.push({ cpuPercent: Number(cpu.replace("%", "")), memBytes: parseBytes(mem.split("/")[0]) });
        } catch { /* a missed sample */ }
      }
      const mins = ((endAt - now) / 60_000).toFixed(1);
      if (clientWindows.length % 12 === 0) process.stderr.write(`${mins} min left; ${clientWindows.at(-1).connected} connected\n`);
    }
    for (const t of timers) { clearTimeout(t); clearInterval(t); }
    for (const s of sockets) s.close();

    // 5. The report.
    const probeLines = fs.existsSync(path.join(probeDir, "metrics.jsonl"))
      ? fs.readFileSync(path.join(probeDir, "metrics.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    if (!probeLines.length) throw new Error("the probe wrote nothing: was it loaded? (docker logs follow)\n" + docker(["logs", "--tail", "50", name]));
    const summary = summarize({ probeLines, clientWindows: clientWindows.slice(1), httpTimes, dockerSamples, memoryLimitBytes, durationSec: opts.minutes * 60 });
    const cpu = os.cpus()[0]?.model?.trim();
    const machine = `Host: ${cpu} (${os.cpus().length} logical cores), ${Math.round(os.totalmem() / 1024 ** 3)} GB, ${os.type()}.`;
    console.log(renderReport(summary, opts, machine));
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ opts, summary }, null, 2));
  } finally {
    if (started) { try { docker(["stop", "-t", "20", name]); } catch { /* already gone */ } }
    if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
    else process.stderr.write(`kept ${work}\n`);
  }
  process.exit(0);
}

if (path.resolve(process.argv[1] || "") === HERE) main().catch((e) => { console.error(e); process.exit(1); });
