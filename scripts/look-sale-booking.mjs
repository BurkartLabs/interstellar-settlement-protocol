// Bug #4882: what the seller sees after a sale above the ISA's own ask. A seller lists 100 Silicates at the ceiling (5x
// the bid, 120 a unit) and a second corporation buys them all; the seller's Finance tab then shows the sale as Exchange
// revenue at the ask (36 a unit) and the rest as Exchange Above Value. At 1280x800 and 375x812. Seeds both corporations
// in a scratch data directory, starts its own server there on a port the OS picks, and removes it all afterwards.
//
// Usage: node scripts/look-sale-booking.mjs <outDir>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "exchange-e2e-fixture-secret-0123456789abcd";
const PASSWORD = "playtest-password-not-real";

// child: seed the two corporations with the server's own account code, then exit
if (process.argv[2] === "--seed") {
  const [, , , dir, sellerEmail, buyerEmail] = process.argv;
  process.env.ISP_DATA_DIR = dir;
  process.env.JWT_SECRET = SECRET;
  process.env.NODE_ENV = "test";
  const store = await import(pathToFileURL(path.join(ROOT, "server/gameState.js")).href);
  const { issueVerificationToken, verifyEmailToken } = await import(pathToFileURL(path.join(ROOT, "server/emailVerification.js")).href);
  for (const [email, corpName, stock] of [[sellerEmail, "Varga Silicate Works", 400], [buyerEmail, "Okonkwo Holdings", 0]]) {
    const { account } = await store.createAccount({ email, password: PASSWORD, ceoName: "Look QA", corpName });
    verifyEmailToken(issueVerificationToken(account.id));
    store.mutateAccountState(account.id, (state) => {
      state.corp.currentStationId = "earth-station-prime";
      state.corp.finances.credits = 250_000;
      state.corp.inventory = { "earth-station-prime": { Silicates: stock } };
    });
    store.markWalkthroughCompleted(account.id);
  }
  await store.saveAccountsNow();
  process.exit(0);
}

const { chromium } = await import("@playwright/test");
const { openTab } = await import("../e2e/nav.mjs");
const { ALLOW_RESTRICTED_PORTS_ARG } = await import("./chromium-ports.mjs");
const outDir = path.resolve(process.argv[2] || "docs/bug-4882");
fs.mkdirSync(outDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-booking-"));
const stamp = Date.now();
const sellerEmail = `booking-seller-${stamp}@example.test`;
const buyerEmail = `booking-buyer-${stamp}@example.test`;
const seeded = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--seed", dir, sellerEmail, buyerEmail], { cwd: ROOT, encoding: "utf8" });
if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

const server = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" }, stdio: ["ignore", "pipe", "pipe"] });
const base = await new Promise((resolve, reject) => {
  let out = "";
  const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
  const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
  server.stdout.on("data", read);
  server.stderr.on("data", read);
  server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
});

const api = async (method, url, body, token) => {
  const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  if (r.status >= 400) throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
};
const browser = await chromium.launch({ args: [ALLOW_RESTRICTED_PORTS_ARG] });
try {
  // the sale, through the routes: the seller lists at the ceiling and the buyer takes it all
  const seller = await api("POST", "/api/auth/login", { email: sellerEmail, password: PASSWORD });
  const buyer = await api("POST", "/api/auth/login", { email: buyerEmail, password: PASSWORD });
  const listed = await api("POST", "/api/market/orders", { type: "sell", item: "Silicates", quantity: 100, unitPrice: 120 }, seller.accessToken);
  const orderId = listed.order?.id ?? listed.id ?? listed.orderId;
  await api("POST", `/api/market/orders/${orderId}/buy`, { quantity: 100 }, buyer.accessToken);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", sellerEmail);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "finance");
  await page.click("#finance-subtab-statements"); // the lifetime ledger is on the Statements page
  const table = page.locator("#finance-pnl-table");
  await table.waitFor();
  for (const [w, h] of [[1280, 800], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    const panel = table.locator("xpath=ancestor::*[contains(@class,'ui-panel')][1]");
    await panel.scrollIntoViewIfNeeded();
    const rows = await table.locator("tbody tr").allInnerTexts();
    console.log(`${w}x${h}: ${rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" | ")}`);
    if (w >= 600) await panel.screenshot({ path: path.join(outDir, `sale-booking-finance-${w}x${h}.png`) });
    else {
      // a phone: the ledger is taller than the screen, so a viewport shot from its first row, clear of the sticky header
      await table.locator("tbody tr").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.screenshot({ path: path.join(outDir, `sale-booking-finance-${w}x${h}.png`) });
    }
  }
  console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => (server.exitCode !== null ? r() : server.once("exit", r)));
  fs.rmSync(dir, { recursive: true, force: true });
}
