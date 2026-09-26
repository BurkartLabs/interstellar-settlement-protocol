// AB#1168: list Silicates on the Galactic Exchange, take the listing down, and read Trade History — the cancelled row
// carries a badge like every other row, and neither it nor the Listed row shows a Total, because neither moved money.
// Starts its own server on a seeded data directory (the logistics-shipments.spec.js pattern), so no server is needed.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "trade-e2e-fixture-secret-0123456789abcdef";

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

async function confirmIfAsked(page) {
  const ok = page.locator("#trade-confirm-ok");
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

for (const viewport of VIEWPORTS) {
  test(`a cancelled listing in Trade History at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `trade-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-trade-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-trade-account.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-trade-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "market");

      await page.fill('[data-sell-qty="Silicates"]', "2");
      await page.fill('[data-sell-price="Silicates"]', "25");
      await page.click('[data-sell-item="Silicates"]');
      await page.waitForTimeout(300);
      await confirmIfAsked(page);
      const cancelBtn = page.locator("[data-cancel-order-id]").first();
      await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
      await cancelBtn.click();
      await page.waitForTimeout(300);
      await confirmIfAsked(page);

      const rows = page.locator("#trade-history-table tr");
      await expect(rows).toHaveCount(2, { timeout: 10_000 });
      const cancelled = rows.nth(0);
      await expect(cancelled.locator('.ui-badge[data-trade-type="cancelled"]')).toHaveText(/cancelled/i);
      await expect(rows.nth(1).locator('.ui-badge[data-trade-type="listed"]')).toBeVisible();
      for (const row of [rows.nth(0), rows.nth(1)]) await expect(row.locator("td").nth(5)).toHaveText("-");

      const table = page.locator("#trade-history-table").locator("xpath=ancestor::*[contains(@class,'panel') or contains(@class,'card')][1]");
      await table.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab1168-trade-history-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
