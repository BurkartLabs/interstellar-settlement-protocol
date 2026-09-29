// Bug #4797: what a player sees when a listing is priced over the line (5x the item's standing bid): the Exchange's
// listing form (the players' subpage) after listing 1 Silicates at 500 a unit (the line is 120), at 1280x800 and 375x812. Seeds a
// corporation holding Silicates in a scratch data directory, starts its own server there on a port the OS picks, and
// stops it and removes the directory afterwards.
//
// Usage: node scripts/look-price-ceiling.mjs <outDir>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { openExchangePage } from "../e2e/nav.mjs";
import { ALLOW_RESTRICTED_PORTS_ARG } from "./chromium-ports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || "docs/bug-4797");
const SECRET = "exchange-e2e-fixture-secret-0123456789abcd";
const PASSWORD = "playtest-password-not-real";
const email = `ceiling-${Date.now()}@example.test`;
fs.mkdirSync(outDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-ceiling-"));

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
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await openExchangePage(page, "players"); // AB#2472: the listing form sits with the players' listings
  await page.locator('[data-sell-price="Silicates"]').waitFor();
  for (const [w, h] of [[1280, 800], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.fill('[data-sell-qty="Silicates"]', "1");
    await page.fill('[data-sell-price="Silicates"]', "500");
    await page.click('[data-sell-item="Silicates"]');
    await page.locator("#trade-confirm-ok").click();
    await page.waitForTimeout(800);
    const said = await page.locator('[data-sell-status="Silicates"]').innerText();
    await page.locator('[data-sell-status="Silicates"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 120));
    console.log(`${w}x${h}: the row says: ${said.replace(/\s+/g, " ")}`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`  sideways scroll ${wide}px`);
    await page.screenshot({ path: path.join(outDir, `price-ceiling-refused-${w}x${h}.png`) });
  }
  console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => (server.exitCode !== null ? r() : server.once("exit", r)));
  fs.rmSync(dir, { recursive: true, force: true });
}
