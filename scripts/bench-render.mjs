// node scripts/bench-render.mjs (AB#730, ISP-44): what the client costs under 4x CPU throttling, on a corporation with
// 5 extractors, a full order book and 50 trades. Reports first paint, the first full render, time to interactive, the
// median and 95th percentile of 20 full re-renders, and how busy live socket updates keep the main thread; writes a
// Chrome trace of the re-renders. Needs Playwright: the `playwright` package, or PLAYWRIGHT_PATH pointing at one.
// BENCH_CHANNEL picks an installed browser (for example msedge or chrome); without it Playwright's own Chromium runs.
//
// A full re-render is updateAllViews in public/scripts/app.js, timed by its own performance measure
// ("isp:updateAllViews"). The page triggers one after every action; this drives 20 through the Suites' hire form,
// one employee at a time, the way a player's clicks do.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THROTTLE = 4;
const RENDERS = 20;
const IDLE_SECONDS = 60;
export const BUDGET = { medianMs: 16, p95Ms: 50 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const where = process.env.PLAYWRIGHT_PATH || "playwright";
  try {
    return require(where);
  } catch {
    throw new Error(`Playwright was not found (${where}). Install it (npm i -D playwright) or set PLAYWRIGHT_PATH to a playwright package.`);
  }
}

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "production", ISP_DEV: "", JWT_SECRET: "bench-render-throwaway-secret-0123456789abcdef" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out.slice(-500)}`)), 30000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, port: Number(port) }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out.slice(-500)}`)); });
  });
}

const stop = (child) => new Promise((r) => { child.once("exit", r); child.kill(); });

async function api(port, method, url, body, token) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

/** Build the corporation through the routes, then give it the rest in its saved snapshot. */
async function seed(dir) {
  const { child, port } = await startServer(dir);
  const who = { email: "bench-render@example.com", password: "bench-render-password", ceoName: "Bench CEO", corpName: "Render Bench" };
  const reg = await api(port, "POST", "/api/auth/register", who);
  const id = reg.account.id;
  const a = (route, body) => api(port, "POST", `/api/accounts/${id}/${route}`, body, reg.accessToken);
  await a("walkthrough-complete");
  await a("gameplay/rent-office", { stationId: "earth-station-prime", durationDays: 28 });
  await a("gameplay/hire", { count: 5 });
  const leased = await a("gameplay/purchase-lease", { body: "earth" });
  const lease = leased.state.corp.miningLeases.at(-1);
  const built = await a(`gameplay/lease/${lease.id}/build-extractor`, {});
  const extractorId = built.state.corp.miningLeases.find((l) => l.id === lease.id).extractorIds.at(-1);
  await a(`gameplay/lease/${lease.id}/start-mining`, { amount: 250, hours: 72, extractorId });
  await sleep(1500); // the debounced snapshot write
  await stop(child);

  const snapFile = path.join(dir, "accounts-snapshot.json");
  const saved = JSON.parse(fs.readFileSync(snapFile, "utf8"));
  const store = saved.accounts ? saved : { accounts: saved };
  const corp = store.accounts[id].state.corp;
  const first = corp.mining.silicateExtractors[0];
  corp.mining.silicateExtractors = Array.from({ length: 5 }, (_, i) => ({ ...JSON.parse(JSON.stringify(first)), id: `${first.id}-${i}`, name: `Extractor ${i + 1}` }));
  corp.employeeCap = 100;
  corp.finances.credits = 10_000_000;
  const now = Date.now();
  corp.tradeHistory = Array.from({ length: 50 }, (_, i) => ({ id: `th-bench-${i}`, type: i % 2 ? "sold" : "bought", item: ["Silicates", "Nickel", "Carbon"][i % 3], quantity: 10 + i, unitPrice: 20 + (i % 7), total: (10 + i) * (20 + (i % 7)), counterparty: `Bench Trader ${i % 9}`, at: now - i * 60_000 }));
  fs.writeFileSync(snapFile, JSON.stringify(store));

  const stateFile = path.join(dir, "state.json");
  const world = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const items = ["Silicates", "Nickel", "Carbon", "Titanium", "Helium-3", "Rare Earths"];
  world.market.orderBook = Array.from({ length: 200 }, (_, i) => ({ id: `ord-bench-${i}`, type: "sell", item: items[i % items.length], quantity: 5 + (i % 40), unitPrice: 10 + (i % 90), seller: `Bench Seller ${i % 25}`, sellerAccountId: `acc-bench-seller-${i % 25}`, stationId: "earth-station-prime", createdAt: now - i * 30_000 }));
  fs.writeFileSync(stateFile, JSON.stringify(world));
  return { id, who };
}

/** Self time per function in a V8 CPU profile, top first: [{ fn, where, ms, share }]. */
export function selfTimes(profile, top = 12) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const ms = new Map();
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const cf = n.callFrame;
    const key = `${cf.functionName || "(anonymous)"}|${cf.url ? cf.url.split("/").pop() : ""}:${cf.lineNumber + 1}`;
    ms.set(key, (ms.get(key) || 0) + (profile.timeDeltas[i] || 0) / 1000);
  });
  const total = [...ms.values()].reduce((a, b) => a + b, 0);
  return [...ms.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => {
    const [fn, where] = k.split("|");
    return { fn, where, ms: v, share: v / total };
  });
}

async function measure(dir, { id, who }, tracePath) {
  const { chromium } = loadPlaywright();
  const { child, port } = await startServer(dir);
  const login = await api(port, "POST", "/api/auth/login", { email: who.email, password: who.password });
  const browser = await chromium.launch(process.env.BENCH_CHANNEL ? { channel: process.env.BENCH_CHANNEL } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      window.__longTasks = [];
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, end: e.startTime + e.duration }); }).observe({ type: "longtask", buffered: true });
    });
    const page = await context.newPage();
    // BENCH_BLOCK=starfield.js: an experiment, the page without one script, to find what a cost belongs to.
    if (process.env.BENCH_BLOCK) await page.route(`**/${process.env.BENCH_BLOCK}`, (route) => route.abort());
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    const base = `http://127.0.0.1:${port}`;
    await page.goto(`${base}/login.html`);
    await page.evaluate((p) => { localStorage.setItem("isp.accountId", p.id); localStorage.setItem("isp.accessToken", p.token); localStorage.setItem("isp.refreshToken", p.refresh); }, { id, token: login.accessToken, refresh: login.refreshToken });

    // Load: first paint, the first full render, and time to interactive (the end of the last long task before five
    // quiet seconds, the Lighthouse definition without its network condition).
    await page.goto(`${base}/`);
    await page.waitForFunction(() => performance.getEntriesByName("isp:updateAllViews").length > 0, null, { timeout: 60000 });
    const firstRender = await page.evaluate(() => { const m = performance.getEntriesByName("isp:updateAllViews")[0]; return m.startTime + m.duration; });
    let tti = firstRender;
    for (let waited = 0; waited < 60000; waited += 500) {
      await sleep(500);
      const tasks = await page.evaluate(() => window.__longTasks);
      const last = tasks.filter((t) => t.end >= firstRender).reduce((m, t) => Math.max(m, t.end), firstRender);
      const nowMs = await page.evaluate(() => performance.now());
      tti = last;
      if (nowMs - last >= 5000) break;
    }
    const paint = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, e.startTime])));

    // 20 full re-renders, through the Suites' hire form, traced.
    const tab = page.locator('.tab-btn[data-tab="station"]');
    if (await tab.isVisible()) await tab.click(); else await page.evaluate(() => document.querySelector('.tab-btn[data-tab="station"]').click());
    await page.locator('[data-building-action="building:orbital-executive-suites"]').click();
    const hireForm = page.locator("#office-hire-form");
    await hireForm.waitFor({ timeout: 20000 });
    await browser.startTracing(page, { path: tracePath, screenshots: false });
    // BENCH_PROFILE=1: a CPU profile of the re-renders, so the report can say which functions the time goes to.
    if (process.env.BENCH_PROFILE) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp.send("Profiler.start");
    }
    const renders = [];
    for (let i = 0; i < RENDERS; i++) {
      const before = await page.evaluate(() => performance.getEntriesByName("isp:updateAllViews").length);
      await page.fill("#office-hire-count", "1");
      await hireForm.locator("button[type=submit]").click();
      await page.waitForFunction((n) => performance.getEntriesByName("isp:updateAllViews").length > n, before, { timeout: 30000 });
      renders.push(await page.evaluate(() => performance.getEntriesByName("isp:updateAllViews").at(-1).duration));
      await sleep(300);
    }
    await browser.stopTracing();
    const hot = process.env.BENCH_PROFILE ? selfTimes((await cdp.send("Profiler.stop")).profile) : null;

    // Live updates: how much of the main thread the socket events and the page's 1-second timer take, left alone.
    await cdp.send("Performance.enable");
    const metric = async (name) => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === name)?.value || 0;
    const busyBefore = await metric("TaskDuration");
    await sleep(IDLE_SECONDS * 1000);
    const busyShare = (await metric("TaskDuration")) - busyBefore;
    const sorted = [...renders].sort((x, y) => x - y);
    return {
      firstPaint: paint["first-paint"], firstContentfulPaint: paint["first-contentful-paint"], firstRender, tti,
      renders, median: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted.at(-1),
      idleBusyShare: busyShare / IDLE_SECONDS, errors, hot
    };
  } finally {
    await browser.close();
    await stop(child);
  }
}

export function renderReport(r, machine) {
  const f = (n) => `${Math.round(n).toLocaleString("en-US")} ms`;
  const lines = [
    `Machine: ${machine.cpu} (${machine.cores} logical cores), ${machine.platform}, Node ${machine.node}, browser ${machine.browser}.`,
    `CPU throttled ${THROTTLE}x (DevTools' Emulation.setCPUThrottlingRate), 1280x800, server on this machine (no network throttling).`,
    "Corporation: 5 extractors, 200 open orders in the book, 50 trades, an office, a lease and research.",
    "",
    `First paint:                     ${f(r.firstPaint)}`,
    `First contentful paint:          ${f(r.firstContentfulPaint)}`,
    `First full render finished:      ${f(r.firstRender)}`,
    `Time to interactive:             ${f(r.tti)}   (end of the last long task before 5 quiet seconds)`,
    "",
    `Full re-render (updateAllViews), ${r.renders.length} renders: median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, slowest ${r.max.toFixed(1)} ms.`,
    `Budget: median under ${BUDGET.medianMs} ms and p95 under ${BUDGET.p95Ms} ms: ${r.median < BUDGET.medianMs && r.p95 < BUDGET.p95Ms ? "within" : "OVER"} (median ${r.median < BUDGET.medianMs ? "within" : "over"}, p95 ${r.p95 < BUDGET.p95Ms ? "within" : "over"}).`,
    `Left alone for ${IDLE_SECONDS} s (socket updates and the page's 1-second timer): main thread busy ${(r.idleBusyShare * 100).toFixed(1)}% of the time.`,
    `Page errors: ${r.errors.length ? r.errors.join("; ") : "none"}.`
  ];
  if (r.hot) {
    lines.push("", "Where the re-renders' time goes (CPU profile, self time, top functions):");
    for (const h of r.hot) lines.push(`  ${(h.share * 100).toFixed(1).padStart(5)}%  ${h.fn.padEnd(32)} ${h.where}`);
  }
  return lines.join("\n");
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-render-"));
  const tracePath = process.env.BENCH_TRACE || path.join(ROOT, "render-trace.json");
  try {
    const who = await seed(dir);
    const result = await measure(dir, who, tracePath);
    const machine = { cpu: os.cpus()[0]?.model?.trim(), cores: os.cpus().length, platform: `${os.type()} ${os.release()}`, node: process.versions.node, browser: process.env.BENCH_CHANNEL || "Playwright Chromium" };
    console.log(renderReport(result, machine));
    console.log(`\nRenders (ms): ${result.renders.map((d) => d.toFixed(1)).join(", ")}`);
    console.log(`Trace: ${tracePath}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
