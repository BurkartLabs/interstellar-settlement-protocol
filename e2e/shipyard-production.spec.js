// ISP-171 (AB#865): ship production at the Orbital Shipyard, from the Station page of the running app: queue three Light
// Fighters, see them on the slips, cancel them. At 1280x800 and 375x812; screenshots go to e2e/screenshots/ab-865/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-865");
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
  test(`queue Light Fighters at the Orbital Shipyard, see them on the slips, and cancel, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const email = `ships-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-ships-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "shipyard-built"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
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
      await openTab(page, "fleet"); // ISP-175 (AB#869): production is on the Fleet tab
      const section = page.locator("#station-shipyard-section");
      await expect(section).toBeVisible();
      // Destroyers and Siege Engines need their research; Light Fighters are open with Fleet Coordination
      await expect(section.locator('[data-ship-unit] option[value="lf"]')).not.toBeDisabled();
      await section.locator("[data-ship-quantity]").fill("3");
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `shipyard-form-${viewport.label}.png`) });
      await section.locator("[data-ship-queue]").click();
      const receipt = page.locator("#action-receipt-modal");
      await expect(receipt).toContainText("Ship Production Queued");
      await expect(receipt).toContainText("3 Light Fighters");
      await page.screenshot({ path: path.join(SHOT_DIR, `shipyard-queued-receipt-${viewport.label}.png`) });
      await page.keyboard.press("Escape");
      const job = section.locator("[data-ship-job]");
      await expect(job).toHaveCount(1);
      await expect(job).toContainText("3 Light Fighters");
      await expect(job).toContainText("Cancel (returns half)");
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `shipyard-on-the-slips-${viewport.label}.png`) });
      await job.locator("[data-ship-cancel]").click();
      await expect(receipt).toContainText("Ship Production Cancelled");
      await expect(receipt).toContainText("half: the job was under way");
      await page.screenshot({ path: path.join(SHOT_DIR, `shipyard-cancelled-receipt-${viewport.label}.png`) });
      await page.keyboard.press("Escape");
      await expect(section.locator("[data-ship-job]")).toHaveCount(0);
      const ox = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ox).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
