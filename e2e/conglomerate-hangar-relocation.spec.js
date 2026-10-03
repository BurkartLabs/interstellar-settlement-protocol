// ISP-212a (AB#4654): once a conglomerate's station opens, its hangar is there, with the goods it held at Earth Station
// Prime. The founder here (e2e/seed-construction-account.mjs, cg-hangar) deposited 900 Silicates and 301 Nickel at Earth,
// then built Venus Platform through the real project, and is docked there. The Hangar screen must name Venus Platform
// and hold the same goods. Shots of the screen at 1280 and 375 go to e2e/screenshots/ab-4654/ (SHOT_LABEL names them;
// "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/conglomerate-hangar-relocation.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gameDrawn, openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4654");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "hangar-relocation-e2e-fixture-secret-0123";

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`the hangar is at the conglomerate's station once it opens, with its goods, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    const email = `cg-hangar-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-cg-hangar-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "cg-hangar"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const url = await new Promise((resolve, reject) => {
        let out = "";
        const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
        const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
        server.stdout.on("data", read);
        server.stderr.on("data", read);
      });
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await gameDrawn(page);

      await openTab(page, "conglomerate");
      await page.locator('[data-role="cong-tab"][data-tab="hangar"]').click();
      const panel = page.locator("#cong-panel-hangar");
      await expect(panel).toContainText("Silicates", { timeout: 15_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      let box = await panel.boundingBox();
      await page.setViewportSize({ width, height: Math.max(height, Math.ceil(box.y + box.height) + 200) });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      box = await panel.boundingBox();
      await page.screenshot({ path: path.join(SHOT_DIR, `hangar-${LABEL}-${width}.png`), clip: box, animations: "disabled" });
      await page.setViewportSize({ width, height });

      await expect(panel).toContainText("Venus Platform");
      await expect(panel).not.toContainText("Earth Station Prime");
      await expect(panel).toContainText(/Silicates\s*900/);
      await expect(panel).toContainText(/Nickel\s*301/);
      await expect(panel).toContainText("Moved to the station"); // the ledger's row for each item that moved
    } finally {
      server.kill();
    }
  });
}
