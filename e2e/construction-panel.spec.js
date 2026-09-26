// ISP-95 (AB#785): the construction panel on the Station, in the running game. A fresh corporation sees every row
// locked with its reason; a level-5 corporation sees several rows it can build, builds the Assembly Facility from the
// panel, and the row and the slot counter change without a reload. At 1440x900 and 390x844. Starts its own server on a
// seeded data directory (the listing-refusal-in-row.spec.js pattern); screenshots go to e2e/screenshots/ab-785/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-785");
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

async function openPanel(browser, viewport, kind) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
  const page = await context.newPage();
  const email = `construction-${kind}-${Date.now()}-${viewport.width}@example.test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-construction-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, kind], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "station");
  const section = page.locator("#station-construction-section");
  await expect(section.locator("[data-building-row]")).toHaveCount(3);
  await section.scrollIntoViewIfNeeded();
  return { page, section, errors, close: async () => { await context.close(); child.kill(); } };
}

for (const viewport of VIEWPORTS) {
  test(`a fresh corporation sees every building with what is in its way, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, section, errors, close } = await openPanel(browser, viewport, "fresh");
    try {
      await expect(section.locator("[data-build-id]")).toHaveCount(0);
      await expect(section.locator('[data-building-row="refinery"] .facility-blocked')).toHaveText("Requires Material Compression I research.");
      await expect(section.locator('[data-building-row="basic-extractor-yard"] .facility-blocked')).toHaveText("Needs a mining lease: file one at the ISA Claims & Leases Division.");
      await section.screenshot({ path: path.join(SHOT_DIR, `fresh-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  test(`a level-5 corporation builds from the panel, and the row and slot counter change, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, section, errors, close } = await openPanel(browser, viewport, "level5");
    try {
      await expect(page.locator("#construction-slots")).toHaveText("Building slots: 3 of 6 in use.") // the Headquarters every corporation starts with, and two yards;
      await expect(section.locator("[data-build-id]")).toHaveCount(3);
      await section.screenshot({ path: path.join(SHOT_DIR, `level5-before-${viewport.label}.png`) });
      await section.locator('[data-build-id="assembly-facility"]').click();
      await expect(section.locator('[data-building-row="assembly-facility"] .facility-blocked')).toHaveText("Built: your corporation operates the most it may, 1.");
      await expect(page.locator("#construction-slots")).toHaveText("Building slots: 4 of 6 in use.");
      // The receipt modal (AB#744) opens over the page; photograph it, close it, then the panel as it is now.
      await page.screenshot({ path: path.join(SHOT_DIR, `level5-receipt-${viewport.label}.png`) });
      await page.keyboard.press("Escape");
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: path.join(SHOT_DIR, `level5-after-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });
}
