// ISP-143 (AB#837): the resource concentration overlay, from the running game at 1440x900 and 390x844: choose Helium-3
// in the Starmap's Resource picker, look at the cluster, then open Sol. Starts its own server on a seeded data dir
// (e2e/seed-prospector-account.mjs: a corporation docked in Barnard's Star, Sol selected on the map as it opens).
//
// Run: npx playwright test e2e/resource-overlay.spec.js (no server needed).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import { openSystem, recordCanvas } from "./starmapCanvas.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "prospector-e2e-fixture-secret-0123456789ab";

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
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

const drawn = (page) => page.evaluate(() => window.__labels.map((l) => l.t));

for (const vp of [{ label: "1440x900", width: 1440, height: 900, mobile: false }, { label: "390x844", width: 390, height: 844, mobile: true }]) {
  test(`the Helium-3 overlay on the cluster and in Sol, at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-overlay-e2e-"));
    const email = `overlay-${Date.now()}-${vp.width}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-prospector-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    try {
      await recordCanvas(page);
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "starmap");
      const canvas = page.locator("#starmap-canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);

      // The action: choose Helium-3.
      await expect(page.locator("#map-resource option[value='Helium-3']")).toHaveCount(1);
      await page.evaluate(() => { window.__labels = []; });
      await page.selectOption("#map-resource", "Helium-3");
      await page.waitForTimeout(500);
      const legend = page.locator("#starmap-resource-legend");
      await expect(legend).toBeVisible();
      await expect(legend).toContainText("Helium-3");
      await expect(legend).toContainText("50% and over");
      const labels = await drawn(page);
      // On a desktop each named star carries its share (Sol: its gas giants' 30%); a phone keeps its few names short and
      // lists the richest systems under the map.
      if (vp.mobile) expect(labels.some((l) => l.startsWith("Helium-3"))).toBe(false);
      else expect(labels).toContain("Helium-3 30%");
      await expect(page.locator("#map-details [data-overlay-richest] li")).toHaveCount(6);
      await legend.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab837-cluster-${vp.label}.png`), fullPage: vp.mobile });
      await test.info().attach(`cluster-${vp.label}`, { body: await page.screenshot({ fullPage: vp.mobile }), contentType: "image/png" });

      // Sol's system view: each planet and the belt with its share; the panel lists every body, moons included.
      await openSystem(page, canvas, "Sol");
      await page.waitForTimeout(400);
      const inSol = await drawn(page);
      expect(inSol).toContain("Jupiter · 30%");
      // A desktop names every body's share; a phone only the shares there are (its panel lists the rest).
      expect(inSol).toContain(vp.mobile ? "Earth" : "Earth · none");
      expect(inSol).toContain(vp.mobile ? "Asteroid Belt" : "Asteroid Belt · not scouted");
      const bodies = page.locator("#map-details [data-overlay-bodies]");
      await expect(bodies).toContainText("Luna (Moon): 25%");
      await expect(bodies).toContainText("Asteroid Belt (Field): not scouted");
      await canvas.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab837-sol-${vp.label}.png`), fullPage: vp.mobile });
      await test.info().attach(`sol-${vp.label}`, { body: await page.screenshot({ fullPage: vp.mobile }), contentType: "image/png" });

      // None takes it away.
      await page.selectOption("#map-resource", "none");
      await expect(legend).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
      await context.close();
    }
  });
}
