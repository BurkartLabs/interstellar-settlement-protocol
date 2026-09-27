// ISP-172 (AB#866): troop training at Headquarters, from the Station page of the running app: a standing garrison, five
// squads of Defense Troops trained and cancelled. At 1280x800 and 375x812; screenshots go to e2e/screenshots/ab-866/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-866");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "375x812", width: 375, height: 812, mobile: true }
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
  test(`train Defense Troops at Headquarters, see them in training beside the garrison, and cancel, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const email = `troops-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-troops-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "troops"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      await openTab(page, "station");
      const section = page.locator("#station-training-section");
      await expect(section).toBeVisible();
      await expect(section).toContainText("Earth Station Prime: 10 squads of Defense Troops");
      await section.locator("[data-troop-unit]").selectOption("dt");
      await expect(section.locator("[data-troop-cost]")).toHaveText("¤800 and 6 Structural Alloys a squad; 20 min each");
      await section.locator("[data-troop-quantity]").fill("5");
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `training-form-${viewport.label}.png`) });
      await section.locator("[data-troop-train]").click();
      const receipt = page.locator("#action-receipt-modal");
      await expect(receipt).toContainText("Troop Training Started");
      await expect(receipt).toContainText("5 squads of Defense Troops");
      await expect(receipt).toContainText("Earth Station Prime, where you queued them");
      await page.screenshot({ path: path.join(SHOT_DIR, `training-receipt-${viewport.label}.png`) });
      await page.keyboard.press("Escape");
      const job = section.locator("[data-troop-job]");
      await expect(job).toContainText("5 squads of Defense Troops");
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `training-in-progress-${viewport.label}.png`) });
      await job.locator("[data-troop-cancel]").click();
      await expect(receipt).toContainText("Troop Training Cancelled");
      await page.keyboard.press("Escape");
      await expect(section.locator("[data-troop-job]")).toHaveCount(0);
      const ox = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ox).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
