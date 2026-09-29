// Bug #4801: founding a conglomerate asked for a corporation 7 days old, but joining asked nothing, so accounts made
// minutes ago could join and pool their starting credits. The founder here (e2e/seed-join-age.mjs) invites Newcastle
// Mining, registered today: refused, with the day it may join. Shots of the roster's invite form at 1280 and 375 go to
// e2e/screenshots/bug-4801/ (SHOT_LABEL names them; "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/conglomerate-join-age.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "bug-4801");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "join-age-e2e-fixture-secret-01234567890";

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`inviting a corporation registered today is refused, with the day it may join, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    const email = `join-age-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-join-age-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-join-age.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { fresh } = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
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
      await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });

      await openTab(page, "conglomerate");
      const C = page.locator("#conglomerate");
      await C.locator('[data-role="cong-tab"][data-tab="roster"]').click();
      await C.locator("#cong-invite-name").fill("Newcastle");
      await C.locator('[data-role="cong-invite-search"] button[type="submit"]').click();
      await C.locator('[data-role="cong-invite"]').first().click();
      const status = C.locator('[data-role="cong-invite-status"]');
      await expect(status).not.toBeEmpty({ timeout: 10_000 });
      const form = C.locator('[data-role="cong-invite-search"]').locator("xpath=ancestor::*[self::section or self::div][1]");
      await form.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await form.screenshot({ path: path.join(SHOT_DIR, `invite-${LABEL}-${width}.png`), animations: "disabled" });

      await expect(status).toContainText(/A corporation can join a conglomerate 7 days after it was registered\. That corporation can from/);
      await expect(C.locator('[data-role="cong-roster"]')).not.toContainText(fresh);
    } finally {
      server.kill();
    }
  });
}
