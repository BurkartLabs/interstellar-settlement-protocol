// Bug #4800: a mercenary offer took a price up to 10,000,000 whatever the fleet was worth, and a hire that never fights
// pays the owner the whole price and returns the collateral, so two accounts could move 10,000,000 a term. The price is
// now capped by the fleet's value, as the collateral is. The player here (e2e/seed-construction-account.mjs, mercs)
// offers its fleet Aegis at 10,000,000: refused, naming the cap. Shots of the form at 1280 and 375 go to
// e2e/screenshots/bug-4800/ (SHOT_LABEL names them; "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/mercenary-price-cap.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gameDrawn, openExchangePage } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "bug-4800");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`an offer priced above its fleet's value is refused, naming the cap, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    const email = `merc-cap-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-merc-cap-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "mercs"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
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

      await openExchangePage(page, "mercs");
      const form = page.locator("[data-merc-form]");
      await expect(form).toBeVisible({ timeout: 15_000 });
      await form.locator("[data-merc-price]").fill("10000000");
      await form.locator("[data-merc-collateral]").fill("1");
      await form.locator("[data-merc-offer-submit]").click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      // the whole panel: on main's code the offer went up at 10,000,000 (its form redrawn); now the form says why not
      const panel = page.locator("#exchange-mercenary-section");
      await page.evaluate(() => window.scrollTo(0, 0));
      let box = await panel.boundingBox();
      await page.setViewportSize({ width, height: Math.max(height, Math.ceil(box.y + box.height) + 200) });
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 0));
      box = await panel.boundingBox();
      await page.screenshot({ path: path.join(SHOT_DIR, `mercenary-panel-${LABEL}-${width}.png`), clip: box, animations: "disabled" });
      await page.setViewportSize({ width, height });

      await expect(page.locator("[data-merc-form] [role=status]")).toContainText(/Choose a price from 100 to the fleet's value, [\d,]+ credits\./);
    } finally {
      server.kill();
    }
  });
}
