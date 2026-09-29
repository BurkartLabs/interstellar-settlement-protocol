// Bug #4841: the Logistics screen scrolled sideways at 375 (169px) and 768 (24px): the Shipments In Transit table was
// wider than the screen (found by the facelift inventory, AB#941). A corporation with shipments in flight, one of them
// held (e2e/seed-industry-account.mjs), at 375x812, 768x1024 and 1280x800: the page does not scroll sideways, and
// every cell of the table stays inside the screen. Screenshots of the table go to e2e/screenshots/ab-4841/.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4841");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "logistics-overflow-fixture-secret-0123456";
const PASSWORD = "playtest-password-not-real";

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

for (const [width, height] of [[375, 812], [768, 1024], [1280, 800]]) {
  test(`Logistics does not scroll sideways at ${width}x${height} (Bug #4841)`, async ({ page }) => {
    test.setTimeout(90_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-logistics-overflow-"));
    const email = `logistics-${width}-${Date.now()}@example.test`;
    const run = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (run.status !== 0) throw new Error(`seed failed: ${run.stdout}\n${run.stderr}`);
    const { child, url } = await startServer(dir);
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "logistics");
      const table = page.locator("#logistics-in-flight table");
      await expect(table).toBeVisible();
      await expect(page.locator("#logistics-in-flight .logistics__shipment")).not.toHaveCount(0);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const outside = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll("#logistics-in-flight td, #logistics-in-flight th")]
          .filter((el) => el.getClientRects().length)
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.right > vw + 1 || r.left < -1).length;
      });
      // the panel redraws as its arrival times count down, so the shot is the page clipped to where the panel is
      const box = await page.evaluate(() => { const r = document.querySelector("#logistics-in-flight").getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: Math.max(r.width, document.documentElement.scrollWidth - r.left - scrollX), height: r.height }; });
      await page.screenshot({ path: path.join(SHOT_DIR, `in-transit-${width}.png`), fullPage: true, clip: box });
      expect(sideways, "the page scrolls sideways").toBe(0);
      expect(outside, "cells of the in-transit table outside the screen").toBe(0);
    } finally {
      child.kill();
    }
  });
}
