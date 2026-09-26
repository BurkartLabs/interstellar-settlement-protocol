// npm run bench:ticks (AB#729, ISP-43): what the server's tickers and its state write cost at 10, 100 and 1,000
// corporations, measured in-process on this machine. No network and no sockets: emits go to rooms nobody is in, so the
// cost of sending to real clients is not in these numbers.
//
// How: one process builds a template corporation through the real HTTP routes (office, five hires, the Earth lease,
// an extractor mining, research and a CEO program queued, a full set of finance snapshots) and saves it. The template
// is cloned N times into an accounts snapshot, and a fresh process per N loads it the way the server does on start,
// times each ticker (median of RUNS calls, and the slowest), and times one full write of the accounts and the world.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "..");
const SIZES = [10, 100, 1000];
const RUNS = 5;

/** Each ticker with its interval, as server/index.js registers it. tests/unit/benchTicks.test.js keeps this in step. */
export const TICKERS = [
  { name: "miningTick", intervalMs: 5_000 },
  { name: "refineryTick", intervalMs: 10_000 },
  { name: "asteroidExpeditionTick", intervalMs: 10_000 },
  { name: "fabricationTick", intervalMs: 5_000 },
  { name: "travelTick", intervalMs: 5_000 },
  { name: "shipmentTick", intervalMs: 5_000 },
  { name: "processRndCompletions", intervalMs: 5_000 },
  { name: "processCeoInsightCompletions", intervalMs: 5_000 },
  { name: "checkAndResetNpcBuyOrders", intervalMs: 60_000 },
  { name: "financialSnapshotTick", intervalMs: 30_000 },
  { name: "beltTick", intervalMs: 60_000 }                  // AB#2329
];

/** The budget: a ticker may use at most half its own interval at 1,000 corporations; a state write at most 1 second. */
export const BUDGET = { tickerShareOfInterval: 0.5, writeMs: 1000 };

const env = (dir) => ({
  ...process.env,
  ISP_DATA_DIR: dir,
  ISP_DISABLE_TICKERS: "1",
  PORT: "0",
  NODE_ENV: "test",
  JWT_SECRET: "bench-ticks-throwaway-secret-0123456789abcdef",
  ISP_DEV: ""
});

async function importServer() {
  return import(new URL("../server/index.js", import.meta.url).href);
}

/** Child: build the template corporation through the routes, save, print its account id. */
async function buildTemplate() {
  const { server, financialSnapshotTick } = await importServer();
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (res.status >= 400) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  };
  const reg = await call("POST", "/api/auth/register", { email: "bench-template@example.com", password: "bench-template-password", ceoName: "Bench CEO", corpName: "Bench Template" });
  const id = reg.account.id;
  const t = reg.accessToken;
  const a = (route, body) => call("POST", `/api/accounts/${id}/${route}`, body, t);
  await a("walkthrough-complete");
  await a("gameplay/rent-office", { stationId: "earth-station-prime", durationDays: 28 });
  await a("gameplay/hire", { count: 5 });
  const leased = await a("gameplay/purchase-lease", { body: "earth" });
  const lease = leased.state.corp.miningLeases.at(-1);
  const built = await a(`gameplay/lease/${lease.id}/build-extractor`, {});
  const extractorId = built.state.corp.miningLeases.find((l) => l.id === lease.id).extractorIds.at(-1);
  await a(`gameplay/lease/${lease.id}/start-mining`, { amount: 250, hours: 72, extractorId });
  await a("gameplay/queue-rnd", { techId: "tt-basic-extraction" });
  await a("gameplay/queue-ceo", { programId: "ceo-risk-assessment" });
  for (let i = 0; i < 60; i++) financialSnapshotTick(); // a full snapshot history, as after 30 minutes online
  const { saveAccountsNow } = await import(new URL("../server/gameState.js", import.meta.url).href);
  await saveAccountsNow();
  process.stdout.write(JSON.stringify({ id }) + "\n");
  process.exit(0);
}

/** Parent: clone the template account n times into a new data directory's snapshot. */
function cloneTemplate(templateDir, templateId, n, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const saved = JSON.parse(fs.readFileSync(path.join(templateDir, "accounts-snapshot.json"), "utf8"));
  const store = saved.accounts ? saved : { accounts: saved };
  const template = store.accounts[templateId];
  const accounts = {};
  for (let i = 0; i < n; i++) {
    const id = `acc-bench-${String(i).padStart(4, "0")}`;
    const copy = JSON.parse(JSON.stringify(template));
    copy.id = id;
    copy.email = `bench-${i}@example.com`;
    copy.state.corp.corporationName = `Bench ${i}`;
    accounts[id] = copy;
  }
  fs.writeFileSync(path.join(dir, "accounts-snapshot.json"), JSON.stringify({ ...store, accounts }));
  fs.copyFileSync(path.join(templateDir, "state.json"), path.join(dir, "state.json"));
}

/** Child: load the snapshot as the server does, time each ticker and one full write. */
async function measure() {
  const mod = await importServer();
  const { saveAccountsNow, getAllAccountIds } = await import(new URL("../server/gameState.js", import.meta.url).href);
  const count = getAllAccountIds().length;
  const tickers = {};
  for (const { name } of TICKERS) {
    const fn = mod[name];
    if (typeof fn !== "function") throw new Error(`server/index.js does not export ${name}`);
    const times = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      await fn();
      times.push(performance.now() - start);
    }
    times.sort((x, y) => x - y);
    tickers[name] = { medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1) };
  }
  const start = performance.now();
  await saveAccountsNow();
  const writeMs = performance.now() - start;
  const dir = process.env.ISP_DATA_DIR;
  const bytes = (f) => fs.statSync(path.join(dir, f)).size;
  process.stdout.write(JSON.stringify({ count, tickers, writeMs, accountsBytes: bytes("accounts-snapshot.json"), stateBytes: bytes("state.json") }) + "\n");
  process.exit(0);
}

function child(mode, dir, extra = []) {
  const res = spawnSync(process.execPath, [HERE, mode, ...extra], { cwd: ROOT, env: env(dir), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  const line = (res.stdout || "").trim().split("\n").reverse().find((l) => l.startsWith("{"));
  if (res.status !== 0 || !line) throw new Error(`${mode} failed (${res.status}): ${(res.stderr || "").slice(-2000)}`);
  return JSON.parse(line);
}

const ms = (n) => (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US"));
const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;

/** The report: a table of ms per ticker at each N, the write, the budget and what is over it. */
export function renderReport(results, machine) {
  const lines = [];
  lines.push(`Machine: ${machine.cpu} (${machine.cores} logical cores), ${machine.ramGb} GB RAM, ${machine.platform}, Node ${machine.node}.`);
  lines.push(`Each ticker called ${RUNS} times in-process; median (slowest) in milliseconds. No sockets connected.`);
  lines.push("");
  const head = ["ticker".padEnd(29), "every", ...results.map((r) => `N = ${r.n.toLocaleString("en-US")}`.padStart(19))].join(" | ");
  lines.push(head);
  lines.push("-".repeat(head.length));
  for (const { name, intervalMs } of TICKERS) {
    const cells = results.map((r) => `${ms(r.tickers[name].medianMs)} (${ms(r.tickers[name].maxMs)})`.padStart(19));
    lines.push([name.padEnd(29), `${intervalMs / 1000}s`.padStart(5), ...cells].join(" | "));
  }
  lines.push("-".repeat(head.length));
  lines.push([ "state write (accounts + world)".padEnd(29), "".padStart(5), ...results.map((r) => `${ms(r.writeMs)} ms`.padStart(19))].join(" | "));
  lines.push([ "accounts-snapshot.json".padEnd(29), "".padStart(5), ...results.map((r) => mb(r.accountsBytes).padStart(19))].join(" | "));
  lines.push([ "state.json".padEnd(29), "".padStart(5), ...results.map((r) => mb(r.stateBytes).padStart(19))].join(" | "));
  lines.push("");
  const top = results.find((r) => r.n === Math.max(...results.map((x) => x.n)));
  lines.push(`Budget at N = ${top.n.toLocaleString("en-US")}: each ticker under ${BUDGET.tickerShareOfInterval * 100}% of its interval; a state write under ${BUDGET.writeMs.toLocaleString("en-US")} ms.`);
  const over = [];
  for (const { name, intervalMs } of TICKERS) {
    const limit = intervalMs * BUDGET.tickerShareOfInterval;
    const took = top.tickers[name].medianMs;
    if (took > limit) over.push(`  OVER  ${name}: ${ms(took)} ms against ${ms(limit)} ms`);
  }
  if (top.writeMs > BUDGET.writeMs) over.push(`  OVER  state write: ${ms(top.writeMs)} ms against ${BUDGET.writeMs} ms`);
  lines.push(...(over.length ? over : ["  Everything is within budget."]));
  const sum = TICKERS.reduce((s, { name, intervalMs }) => s + top.tickers[name].medianMs / intervalMs, 0);
  lines.push(`All tickers together keep the event loop busy ${(sum * 100).toFixed(0)}% of the time at N = ${top.n.toLocaleString("en-US")}, before any request is served.`);
  return lines.join("\n");
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "isp-bench-"));
  try {
    const templateDir = path.join(work, "template");
    fs.mkdirSync(templateDir);
    const { id } = child("template", templateDir);
    const results = [];
    for (const n of SIZES) {
      const dir = path.join(work, `n${n}`);
      cloneTemplate(templateDir, id, n, dir);
      const r = child("measure", dir);
      if (r.count < n) throw new Error(`loaded ${r.count} accounts, expected at least ${n}`);
      results.push({ n, ...r });
      process.stderr.write(`measured N = ${n}\n`);
    }
    const machine = { cpu: os.cpus()[0]?.model?.trim(), cores: os.cpus().length, ramGb: Math.round(os.totalmem() / 1024 ** 3), platform: `${os.type()} ${os.release()}`, node: process.versions.node };
    console.log(renderReport(results, machine));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
if (path.resolve(process.argv[1] || "") === HERE) {
  if (mode === "template") buildTemplate().catch((e) => { console.error(e); process.exit(1); });
  else if (mode === "measure") measure().catch((e) => { console.error(e); process.exit(1); });
  else main().catch((e) => { console.error(e); process.exit(1); });
}
