// ISP-170 (AB#864): the Orbital Shipyard on the Station's construction panel, locked with its reason and then built,
// from the running app at 1440x900 and 390x844; screenshots go to e2e/screenshots/ab-864/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-864");
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

async function signIn(browser, viewport, kind) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
  const page = await context.newPage();
  const email = `shipyard-${kind}-${Date.now()}-${viewport.width}@example.test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-shipyard-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, kind], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\?account=/);
  await openTab(page, "station");
  const row = page.locator('#station-construction-section [data-building-row="orbital-shipyard"]');
  await row.scrollIntoViewIfNeeded();
  return { context, page, child, errors, row };
}

for (const viewport of VIEWPORTS) {
  test(`the Orbital Shipyard is locked below Level 10 and says so, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const s = await signIn(browser, viewport, "level5");
    try {
      await expect(s.row.locator(".station__blocked")).toHaveText("Requires Corporation Level 10 (you are level 5).");
      await expect(s.row.locator("[data-build-id]")).toHaveCount(0);
      await expect(s.row).toContainText("¤150,000");
      await s.row.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await s.page.screenshot({ path: path.join(SHOT_DIR, `shipyard-locked-${viewport.label}.png`) });
      expect(s.errors).toEqual([]);
    } finally { await s.context.close(); s.child.kill(); }
  });

  test(`the Orbital Shipyard is built at Level 10 with Fleet Coordination, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const s = await signIn(browser, viewport, "shipyard");
    try {
      const build = s.row.locator('[data-build-id="orbital-shipyard"]');
      await expect(build).toHaveText("Build (¤150,000)");
      await build.click();
      const receipt = s.page.locator("#action-receipt-modal");
      await expect(receipt).toBeVisible();
      await expect(receipt).toContainText("Orbital Shipyard Commissioned");
      await expect(receipt).toContainText("Nothing yet: ship production opens later in v0.10");
      await s.page.screenshot({ path: path.join(SHOT_DIR, `shipyard-receipt-${viewport.label}.png`) });
      await s.page.keyboard.press("Escape");
      await expect(s.row.locator(".station__blocked")).toHaveText("Built: your corporation operates the most it may, 1.");
      await s.row.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await s.page.screenshot({ path: path.join(SHOT_DIR, `shipyard-built-${viewport.label}.png`) });
      expect(s.errors).toEqual([]);
    } finally { await s.context.close(); s.child.kill(); }
  });
}
