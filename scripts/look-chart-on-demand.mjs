// Bug #4838: Chart.js loads only when a chart is drawn. Seeds a corporation (e2e/seed-exchange-account.mjs) in a scratch
// data directory, starts its own server on a port the OS picks, signs in, and records every request for Chart.js:
//   1. on Overview, and after 35 s there (the account's finance updates redraw the charts whatever tab is open), none;
//   2. on the Financial Core, one, and its cash chart is drawn;
//   3. after a sale into the Silicates bid (so the Exchange has a price to chart), the Exchange's price chart is drawn,
//      from the copy already loaded.
// Shots at 1280x800 of the Financial Core and the Exchange's chart go to <outDir>.
//
// Usage: node scripts/look-chart-on-demand.mjs <outDir>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { ALLOW_RESTRICTED_PORTS_ARG } from "./chromium-ports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || "docs/bug-4838");
const SECRET = "exchange-e2e-fixture-secret-0123456789abcd";
const PASSWORD = "playtest-password-not-real";
const email = `charts-${Date.now()}@example.test`;
fs.mkdirSync(outDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-charts-"));

const seeded = spawnSync(process.execPath, ["e2e/seed-exchange-account.mjs", dir, email, PASSWORD], { cwd: ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr}`);
const server = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" }, stdio: ["ignore", "pipe", "pipe"] });
const base = await new Promise((resolve, reject) => {
  let out = "";
  const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
  const read = (chunk) => {
    out += chunk;
    const port = out.match(/listening on port (\d+)/)?.[1];
    if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
  };
  server.stdout.on("data", read);
  server.stderr.on("data", read);
  server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
});

const browser = await chromium.launch({ args: [ALLOW_RESTRICTED_PORTS_ARG] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let chartLoads = 0;
  page.on("request", (r) => { if (r.url().includes("chart.umd")) chartLoads++; });
  const drawn = (id) => page.evaluate((canvasId) => Boolean(window.Chart?.getChart?.(document.getElementById(canvasId))), id);

  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.locator("#game-shell:not([hidden])").waitFor({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  console.log(`1. signed in, on Overview: Chart.js requests ${chartLoads}`);
  await page.waitForTimeout(35_000);
  console.log(`   after 35 s on Overview: Chart.js requests ${chartLoads}, window.Chart ${await page.evaluate(() => typeof window.Chart)}`);

  await openTab(page, "finance");
  await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.getElementById("cashflow-chart"))), null, { timeout: 15_000 });
  console.log(`2. Financial Core: Chart.js requests ${chartLoads}; cash chart drawn ${await drawn("cashflow-chart")}`);
  await page.locator("#cashflow-chart").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, "finance-charts-1280x800.png") });

  await openTab(page, "market");
  const sell = page.locator('[data-npc-order-id="npc-buy-silicates-daily"]');
  await sell.waitFor();
  await page.fill('[data-npc-sell-qty="npc-buy-silicates-daily"]', "10");
  await sell.click();
  await page.locator("#trade-confirm-ok").click();
  await page.locator("#action-receipt-modal").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await openTab(page, "overview");
  await openTab(page, "market"); // the chart refreshes whenever the Exchange is shown
  await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.getElementById("price-chart-canvas"))), null, { timeout: 15_000 });
  console.log(`3. Exchange after a sale: Chart.js requests ${chartLoads}; price chart drawn ${await drawn("price-chart-canvas")}`);
  await page.locator("#price-chart-canvas").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, "exchange-price-chart-1280x800.png") });

  // 4. A fresh browser that goes to the Exchange first: the price chart is the one that fetches Chart.js
  const fresh = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  let freshLoads = 0;
  fresh.on("request", (r) => { if (r.url().includes("chart.umd")) freshLoads++; });
  fresh.on("pageerror", (e) => errors.push(e.message));
  await fresh.goto(`${base}/login.html`);
  await fresh.fill("#login-email", email);
  await fresh.fill("#login-password", PASSWORD);
  await fresh.click('#login-form button[type="submit"]');
  await fresh.locator("#game-shell:not([hidden])").waitFor({ timeout: 20_000 });
  await openTab(fresh, "market");
  await fresh.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.getElementById("price-chart-canvas"))), null, { timeout: 15_000 });
  console.log(`4. a fresh visit, Exchange first: Chart.js requests ${freshLoads}; price chart drawn true`);
  console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => (server.exitCode !== null ? r() : server.once("exit", r)));
  fs.rmSync(dir, { recursive: true, force: true });
}
