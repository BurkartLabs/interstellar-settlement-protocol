// ISP-312 (AB#2308): the Station's upgrade control for a tier-5 Basic Extractor Yard, now that tiers 6 to 8 are in
// data/economy.json. Allowed tier 6 (seeded; Level 20 grants it since AB#800), the row offers tier 6 at its price; at
// maxUpgradeTier 5 it shows tier 6's comparison and the level that opens it.
// At 1280x800 and 375x812; viewport screenshots of the yard row go to e2e/screenshots/ab-2308/.
import { test, expect } from "@playwright/test";
import { openTab, openStationOffices } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-2308");
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

async function openYard(browser, viewport, kind) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
  const page = await context.newPage();
  const email = `yard-${kind}-${Date.now()}-${viewport.width}@example.test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-yard-tier-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, kind], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}
${seeded.stderr}`);
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "station");
  // The yards' controls are on the Earth lease's page, opened from the ISA Claims & Leases Division.
  await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
  await page.click('[data-building-action="building:isa-claims-leases"]');
  await page.click('[data-action="manage-lease"][data-lease-id="lease-earth-qa"]');
  const control = page.locator('[data-role="yard-upgrade"]').first();
  await expect(control).toBeVisible();
  await control.evaluate((el) => el.scrollIntoView({ block: "center" }));
  return { page, control, errors, close: async () => { await context.close(); child.kill(); } };
}

for (const viewport of VIEWPORTS) {
  test(`a tier-5 yard allowed tier 6 offers it at ¤202,500, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, control, errors, close } = await openYard(browser, viewport, "tier5");
    try {
      await expect(control).toContainText("Tier 5 of 8");
      await expect(control).toContainText("cap 610 → 763 t/h");
      await expect(control.locator("button")).toHaveText("Upgrade to tier 6 (¤202,500)");
      await page.screenshot({ path: path.join(SHOT_DIR, `tier5-allowed-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  test(`a tier-5 yard at maxUpgradeTier 5 sees that tier 6 opens at Level 20, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, control, errors, close } = await openYard(browser, viewport, "tier5-locked");
    try {
      await expect(control).toContainText("Tier 6 opens at Corporation Level 20; you are Level 5."); // AB#800
      await expect(control.locator("button")).toHaveCount(0);
      await page.screenshot({ path: path.join(SHOT_DIR, `tier5-locked-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });
}
