// Bug #4802: a conglomerate's dominance summed each member's whole 7-day window, so a corporation that joined carried
// its week of sales from before it was a member into the group the moment it joined. Here (e2e/seed-dominance-join.mjs)
// Cedar Trading sold heavily at Alpha Centauri as an independent, then joined Halcyon Accord today: the conglomerate
// dominance overlay must name Cedar Trading, the independent it was, as Alpha Centauri's leader, not the Accord. Shots
// of the legend and the system's details at 1280 and 375 go to e2e/screenshots/bug-4802/ (SHOT_LABEL names them;
// "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/dominance-join.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";
import { openSystem, recordCanvas } from "./starmapCanvas.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "bug-4802");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "dominance-join-e2e-fixture-secret-0123456";

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`the conglomerate overlay credits a member's pre-join sales to the corporation it was, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    const email = `dominance-join-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-dominance-join-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-dominance-join.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const names = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
    const server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const url = await new Promise((resolve, reject) => {
        let out = "";
        const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
        const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
        server.stdout.on("data", read);
        server.stderr.on("data", read);
      });
      await recordCanvas(page);
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });

      await openTab(page, "starmap");
      const canvas = page.locator("#starmap-canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await page.selectOption("#map-overlay", "cong-dominance");
      const legend = page.locator("#starmap-dominance-legend");
      await expect(legend).toBeVisible({ timeout: 15_000 });
      await legend.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await legend.screenshot({ path: path.join(SHOT_DIR, `legend-${LABEL}-${width}.png`), animations: "disabled" });

      await openSystem(page, canvas, "Alpha Centauri");
      const details = page.locator("#map-details");
      await expect(details.locator("[data-dominance-details]")).toBeVisible({ timeout: 15_000 });
      await details.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await details.screenshot({ path: path.join(SHOT_DIR, `alpha-centauri-${LABEL}-${width}.png`), animations: "disabled" });

      // Cedar's 180,000 of sales and Birch's 60,000 were both made as independents: 75% and 25%, and the Accord none
      const shares = details.locator("[data-dominance-details]");
      await expect(shares).toContainText(new RegExp(`${names.cedar}\\s*75%`));
      await expect(shares).toContainText(new RegExp(`${names.birch}\\s*25%`));
      await expect(shares).not.toContainText(names.accord);
      await expect(legend).toContainText(names.cedar);
      await expect(legend).not.toContainText(names.accord);
    } finally {
      server.kill();
    }
  });
}
