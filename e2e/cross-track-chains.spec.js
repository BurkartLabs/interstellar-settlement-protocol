// ISP-140 (AB#834): the four cross-track chains on the Refinery Chains screen, in a real browser: each card names every
// input, the research it needs, and what the corporation holds of each. Starting one from the page is AB#836's form;
// until then the card says so, and this spec holds it to that. Screenshots go to e2e/screenshots/ab-834/ (gitignored;
// the ones the pull request shows were copied to docs/ab-834/).
//
// Run: `npx playwright test e2e/cross-track-chains.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-834");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "cross-track-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const CARDS = [
  ["Fusion Pellets + Rare-Earth Magnets + Cryogenic Coolant Refining", "20 Fusion Pellets + 10 Rare-Earth Magnets + 20 Cryogenic Coolant per batch → 4 Fusion Reactor Cores", "Inventory: 20 Fusion Pellets, 10 Rare-Earth Magnets, 20 Cryogenic Coolant"],
  ["Thorium Fuel Rods + Pressure Vessels Refining", "5 Thorium Fuel Rods + 10 Pressure Vessels per batch → 5 Compact Fission Modules", "Inventory: 0 Thorium Fuel Rods, 0 Pressure Vessels"],
  ["Aluminium-Lithium Alloy + Structural Alloys Refining", "30 Aluminium-Lithium Alloy + 20 Structural Alloys per batch → 10 Lightweight Spaceframes", "Inventory: 0 Aluminium-Lithium Alloy, 0 Structural Alloys"],
  ["Rare-Earth Magnets + Plasma Conduits + Battery Cells Refining", "10 Rare-Earth Magnets + 10 Plasma Conduits + 10 Battery Cells per batch → 5 Ion Thrusters", "Inventory: 10 Rare-Earth Magnets, 0 Plasma Conduits, 0 Battery Cells"]
];

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
  test(`the cross-track chains on the Refinery Chains screen, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-cross-track-e2e-"));
    const email = `assembly-${width}-${Date.now()}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-assembler-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-assembler-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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
      await openTab(page, "refinery");

      for (const [title, recipe, inventory] of CARDS) {
        const card = page.locator("#refinery-chains .refinery__chain", { hasText: title });
        await expect(card, title).toContainText(recipe);
        await expect(card, title).toContainText(inventory);
        await expect(card.locator(".ui-badge--success"), title).toHaveText("Research unlocked");
        await expect(card, title).toContainText("Starting it from this page arrives in a later build.");
      }
      await page.screenshot({ path: path.join(SHOT_DIR, `cross-track-${width}x${height}.png`), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
