// ISP-140 (AB#834): the four cross-track chains on the Refinery Chains screen, in a real browser: each card names every
// input, the research it needs, and whether a batch's worth of each is here; since AB#836 its Start button says which
// are short. Screenshots go to e2e/screenshots/ab-834/ (gitignored; the ones the pull request shows were copied to
// docs/ab-834/).
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
// AB#836: each card is named for what it makes, and says of each input whether a batch's worth is here.
const CARDS = [
  ["fusion-core-chain", "Fusion Reactor Cores", "20 Fusion Pellets + 10 Rare-Earth Magnets + 20 Cryogenic Coolant per batch → 4 Fusion Reactor Cores", "Start Run"],
  ["fission-module-chain", "Compact Fission Modules", "5 Thorium Fuel Rods + 10 Pressure Vessels per batch → 5 Compact Fission Modules", "Short: Thorium Fuel Rods, Pressure Vessels"],
  ["spaceframe-chain", "Lightweight Spaceframes", "30 Aluminium-Lithium Alloy + 20 Structural Alloys per batch → 10 Lightweight Spaceframes", "Short: Aluminium-Lithium Alloy, Structural Alloys"],
  ["ion-thruster-chain", "Ion Thrusters", "10 Rare-Earth Magnets + 10 Plasma Conduits + 10 Battery Cells per batch → 5 Ion Thrusters", "Short: Plasma Conduits, Battery Cells"]
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

      for (const [id, title, recipe, button] of CARDS) {
        const card = page.locator(`#chain-${id}`);
        await expect(card.locator(".ui-card__title"), id).toHaveText(title);
        await expect(card, id).toContainText(recipe);
        await expect(card.locator(".ui-card__meta > .ui-badge--success").first(), id).toHaveText("Research unlocked");
        await expect(card.locator(".refinery__start"), id).toHaveText(button);
        await expect(card.locator(".refinery__start"), id)[button === "Start Run" ? "toBeEnabled" : "toBeDisabled"]();
      }
      await page.screenshot({ path: path.join(SHOT_DIR, `cross-track-${width}x${height}.png`), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
