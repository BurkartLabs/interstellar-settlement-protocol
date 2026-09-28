// AB#1169: with 35 player listings on the book, Sell Orders draws 30 and says so, instead of letting 30 rows read as
// the whole book. Starts its own server on a seeded data directory (the logistics-shipments.spec.js pattern).
import { test, expect } from "@playwright/test";
import { openExchangePage, openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "busy-book-e2e-fixture-secret-0123456789ab";

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

for (const viewport of VIEWPORTS) {
  test(`Sell Orders says it is showing 30 of 35 at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `busy-book-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-busy-book-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-busy-book.mjs", dir, email, PASSWORD, "35"], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-busy-book.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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
      await openExchangePage(page, "players"); // AB#2472: the player order books

      await expect(page.locator("#exchange-buy-table tr")).toHaveCount(30, { timeout: 10_000 });
      const note = page.locator("#exchange-buy-capped");
      await expect(note).toBeVisible();
      await expect(note).toHaveText("Showing 30 of 35 player sell orders. Sort by price or filter by resource to see the rest.");
      await expect(page.locator("#my-sell-orders-capped")).toBeHidden();

      await note.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 200));
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab1169-sell-orders-capped-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
