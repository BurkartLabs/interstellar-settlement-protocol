// AB#1857: Create Listing with nothing in inventory said so, then drew its column headers over an empty table. The
// other Exchange tables hide theirs when empty (AB#402). With goods the table is drawn as before. Starts its own server
// on a seeded data directory (the sell-orders-capped.spec.js pattern); screenshots go to e2e/screenshots/ab-1857/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyAndLogIn } from "./verification.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-1857");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "create-listing-e2e-fixture-secret-0123456789";

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "1" },
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

async function openCreateListing(page) {
  await openTab(page, "market");
  const card = page.locator("section.form-card", { has: page.locator("#market-sell-grid") });
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  return card;
}

for (const viewport of VIEWPORTS) {
  test(`Create Listing hides its table when there is nothing to list, and draws it when there is, at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(90_000);
    const email = `create-listing-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-create-listing-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-trade-account.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-trade-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // A new corporation: nothing in inventory anywhere.
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await page.goto(`${url}/register.html`);
      await page.fill("#register-email", `empty-${stamp}@example.test`);
      await page.fill("#register-password", PASSWORD);
      await page.fill("#register-ceo", "Playtest CEO");
      await page.fill("#register-corp", `Empty Corp ${stamp}`);
      await page.click('#register-form button[type="submit"]');
      await verifyAndLogIn(page, url, `empty-${stamp}@example.test`, PASSWORD); // AB#2288: verify, then log in
      await page.waitForURL(/\/\?account=/);
      await page.getByRole("button", { name: "I'll find my own way" }).click();

      let card = await openCreateListing(page);
      await expect(card.locator("#market-sell-empty")).toBeVisible();
      await expect(card.locator(".ui-table-wrap")).toBeHidden();
      // On a phone the stacked table draws no headers anyway, and an empty wrap has no size, so toBeHidden alone
      // passes there without the fix: assert the flag itself as well.
      await expect(card.locator(".ui-table-wrap")).toHaveJSProperty("hidden", true);
      await expect(card.getByRole("columnheader", { name: "Sell Quantity" })).toBeHidden();
      await page.screenshot({ path: path.join(SHOT_DIR, `empty-${viewport.label}.png`) });

      // The seeded corporation holds 40 Silicates at Earth Station Prime: the table and its row are drawn.
      await page.click("#logout-btn, button:has-text('Log Out')");
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);

      card = await openCreateListing(page);
      await expect(card.locator("#market-sell-empty")).toBeHidden();
      await expect(card.locator(".ui-table-wrap")).toBeVisible();
      await expect(card.locator(".ui-table-wrap")).toHaveJSProperty("hidden", false);
      await expect(card.locator("#market-sell-grid tr")).toHaveCount(1);
      await expect(card.locator('[data-sell-item="Silicates"]')).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `with-goods-${viewport.label}.png`) });

      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
