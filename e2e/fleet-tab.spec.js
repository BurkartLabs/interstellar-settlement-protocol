// ISP-175 (AB#869): the Fleet tab from the running app: units with upkeep and readiness, two fleets (one in transit), a
// ship and a training job in production, and a deployment through the picker and its confirmation. At 1440x900 and
// 390x844; screenshots go to e2e/screenshots/ab-869/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-869");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900, mobile: false },
  { label: "390x844", width: 390, height: 844, mobile: true }
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
  test(`the Fleet tab: units and upkeep, two fleets (one in transit), both queues, and a deployment, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const email = `fleet-tab-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-fleet-tab-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "fleet-tab"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
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
      await openTab(page, "fleet");
      const tab = page.locator("#fleet");
      await expect(tab).toBeVisible();
      // units table: count, stats and upkeep per type, and the total
      await expect(tab.locator('[data-unit-row="lf"]')).toContainText("Light Fighter");
      await expect(tab.locator('[data-unit-row="lf"]')).toContainText("14 in fleets, 6 in reserve");
      await expect(tab.locator("[data-upkeep-total]")).toHaveText(/^¤[\d,]+$/);
      await expect(tab.locator("[data-fleet-readiness]")).toHaveText("85%");
      // two fleets, one in transit with its arrival
      await expect(tab.locator("[data-fleet]")).toHaveCount(2);
      await expect(tab.locator('[data-fleet="flt-e2e-talon"] [data-fleet-location]')).toContainText(/In transit to Mars Orbital Dock, arrives in 4\d min/);
      await expect(tab.locator('[data-fleet="flt-e2e-aegis"] [data-fleet-location]')).toHaveText("Stationed at Earth Station Prime");
      // both queues, with time remaining
      await expect(tab.locator("[data-ship-job]")).toContainText(/3 Light Fighters ready in 1 h \d+ min/);
      await expect(tab.locator("[data-troop-job]")).toContainText(/2 squads of Attack Troops ready in \d+ min/);
      await page.screenshot({ path: path.join(SHOT_DIR, `fleet-tab-${viewport.label}.png`), fullPage: true });
      await page.screenshot({ path: path.join(SHOT_DIR, `fleet-tab-top-${viewport.label}.png`) });
      await tab.locator("#fleet-units").screenshot({ path: path.join(SHOT_DIR, `fleet-units-${viewport.label}.png`) });
      // text first: the figures are text, readable with graphics off
      const plain = await tab.innerText();
      for (const words of ["Readiness", "85%", "Upkeep", "Aegis", "Talon", "In transit to Mars Orbital Dock", "Light Fighter"]) expect(plain).toContain(words);
      // deploy: the picker lists destinations with their travel time, and a confirmation comes before anything is sent
      const aegis = tab.locator('[data-fleet="flt-e2e-aegis"]');
      await aegis.locator('[data-fleet-deploy="flt-e2e-aegis"]').click();
      const mars = aegis.locator('[data-deploy-to="mars-orbital-dock"]');
      await expect(mars).toBeEnabled();
      await expect(aegis.locator(".fleet__destination", { hasText: "Mars Orbital Dock" })).toContainText(/Sol · \d+ (s|min)/);
      await expect(aegis.locator('[data-deploy-to="centauri-prime-station"]')).toBeDisabled();
      await aegis.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `fleet-deploy-picker-${viewport.label}.png`) });
      await mars.click();
      const confirm = page.locator("#trade-confirm-modal");
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText("Mars Orbital Dock");
      await expect(confirm).toContainText("Travel time");
      await page.screenshot({ path: path.join(SHOT_DIR, `fleet-deploy-confirm-${viewport.label}.png`) });
      await page.locator("#trade-confirm-ok").click();
      await expect(tab.locator('[data-fleet="flt-e2e-aegis"] [data-fleet-location]')).toContainText("In transit to Mars Orbital Dock");
      const ox = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ox).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
