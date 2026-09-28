// ISP-137 (AB#831): the Nickel-Iron track on the page, in a real browser. A Mars lease says it yields Iron Ore, the
// Refinery Chains screen shows the smelting chain's two inputs and the Pressure Vessel chain, and a Pressure Vessel run
// starts from the form. Screenshots go to e2e/screenshots/ab-831/ (gitignored; the ones the pull request shows were
// copied to docs/ab-831/).
//
// Run: `npx playwright test e2e/nickel-iron-track.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab, openStationOffices } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-831");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "nickel-iron-e2e-fixture-secret-0123456789";
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

for (const [width, height] of [[375, 812], [1280, 800]]) {
  test(`the Nickel-Iron track on the Station and Refinery screens, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-nickel-iron-e2e-"));
    const email = `metals-${width}-${Date.now()}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-metals-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-metals-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });

      await openTab(page, "station");
      await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
      await page.click('[data-building-action="building:isa-claims-leases"]');
      const marsCard = page.locator('#station-building-content [data-role="lease-card"]', { hasText: "Mars" });
      await expect(marsCard.locator('[data-role="lease-yield"]')).toContainText("Iron Ore");
      await expect(marsCard.locator('[data-role="lease-type"]')).toHaveText("Mixed Extraction"); // Bug #2354
      await shot("mars-lease");

      await openTab(page, "refinery");
      const smelting = page.locator("#chain-smelting-chain");
      await expect(smelting).toContainText("150 Iron Ore + 50 Nickel per batch → 80 Nickel-Iron Alloy");
      // AB#836: two batches is what 300 Iron Ore and 100 Nickel cover, so each row needs what it holds.
      await expect(smelting.locator('[data-input-item="Iron Ore"] [data-role="amounts"]')).toHaveText("Needs 300 · holds 300");
      await expect(smelting.locator('[data-input-item="Nickel"] [data-role="amounts"]')).toHaveText("Needs 100 · holds 100");
      const vessels = page.locator("#chain-pressure-vessel-chain");
      await expect(vessels).toContainText("80 Nickel-Iron Alloy per batch → 25 Pressure Vessels");
      await expect(vessels.locator(".refinery__quantity")).toHaveValue("160");
      // AB#2353: the Resource catalog is data/refinery-chains.json's list, Iron Ore included.
      const catalog = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "refinery-chains.json"), "utf8")).resourceCatalog;
      expect(await page.locator("#resource-catalog li").allTextContents()).toEqual(catalog);
      await shot("chains");

      await vessels.locator(".refinery__start").click();
      await expect(page.locator("#action-receipt-title")).toHaveText("Production Run Started", { timeout: 10_000 });
      await expect(page.locator("#action-receipt-body")).toContainText("160 Nickel-Iron Alloy");
      await expect(page.locator("#action-receipt-body")).toContainText("50 Pressure Vessels");
      await page.keyboard.press("Escape");
      await expect(page.locator("#refinery-active-runs")).toContainText("Processing: 160 Nickel-Iron Alloy → 50 Pressure Vessels");
      await shot("running");
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
