// AB#2351: the Exchange's standing buy orders, each with its own remaining-today figure: a product's is its npcBuyers
// dailyQty (Aerogel 240, Fusion Pellets 160), a raw item's the world's 7,000. Seeds a corporation holding both kinds in
// a scratch data directory, starts its own server there on a port the OS picks, sells 60 of its 100 Aerogel and 300 of its 400 Silicates (a row shows while some is held)
// through the page, and shoots the standing bids at 375x812 and 1280x800. Stops the server and removes the directory.
//
// Usage: node scripts/look-standing-quotas.mjs <outDir>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { ALLOW_RESTRICTED_PORTS_ARG } from "./chromium-ports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || "docs/ab-2351");
const SECRET = "exchange-e2e-fixture-secret-0123456789abcd";
const PASSWORD = "playtest-password-not-real";
const email = `quotas-${Date.now()}@example.test`;
fs.mkdirSync(outDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-quotas-"));

const seeded = spawnSync(process.execPath, ["e2e/seed-exchange-account.mjs", dir, email, PASSWORD, "products"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
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
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "market");
  await page.locator("#npc-buy-table tr").first().waitFor();

  for (const [item, qty] of [["Aerogel", 60], ["Silicates", 300]]) {
    const id = `npc-buy-${item.toLowerCase()}-daily`;
    await page.fill(`[data-npc-sell-qty="${id}"]`, String(qty));
    await page.click(`[data-npc-order-id="${id}"]`);
    await page.locator("#trade-confirm-ok").click();
    await page.locator("#action-receipt-modal").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#action-receipt-modal").waitFor({ state: "hidden" });
  }
  const rows = (await page.locator("#npc-buy-table tr").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  console.log("standing rows:", rows);

  for (const [w, h] of [[1280, 800], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    // a phone stacks each row into a card, so it is scrolled to the Aerogel card; a desktop shows the whole table
    await page.evaluate((phone) => {
      const aerogel = [...document.querySelectorAll("#npc-buy-table tr")].find((tr) => tr.cells[0]?.textContent.trim() === "Aerogel");
      const target = phone ? aerogel : document.querySelector("#exchange-standing-section");
      const top = target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top - document.querySelector(".app-header").getBoundingClientRect().height - 12);
    }, w < 600);
    await page.waitForTimeout(200);
    console.log(`${w}x${h}: sideways scroll ${wide}px`);
    await page.screenshot({ path: path.join(outDir, `standing-quotas-${w}x${h}.png`) });
  }
  console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => (server.exitCode !== null ? r() : server.once("exit", r)));
  fs.rmSync(dir, { recursive: true, force: true });
}
