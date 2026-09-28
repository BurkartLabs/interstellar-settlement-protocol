// AB#2482: a moon's view on the Starmap goes back up the map's real order: Back To Planet (its own planet), Back To
// System, Back To Cluster. At 1280x800 and 375x812: the three are drawn and do not overlap; Back To Planet opens
// the moon's planet, not the system. Screenshots go to e2e/screenshots/ab-2482/ (gitignored).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";
import { recordCanvas, lastLabel } from "./starmapCanvas.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2482");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "starmap-moon-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "375x812", width: 375, height: 812, mobile: true }
];
const BACKS = ["◂ Back To Planet", "◂ Back To System", "◂ Back To Cluster"];

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

const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);
const clearLabels = (page) => page.evaluate(() => { window.__labels = []; window.__arcs = []; });

for (const vp of VIEWPORTS) {
  test(`a moon's view goes Back To Planet, System or Cluster, at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-moon-back-e2e-"));
    const email = `moon-${Date.now()}-${vp.width}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    await recordCanvas(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      await openTab(page, "starmap");
      const canvas = page.locator("#starmap-canvas");
      await expect(canvas).toBeVisible();

      for (const [moon, planet] of [["luna", "Earth"], ["europa", "Jupiter"]]) {
        await clearLabels(page);
        expect(await mapShow(page, { systemId: "sol", bodyId: moon })).toBe(true);
        await page.waitForTimeout(400);
        // All three drawn, none over another (each label's box, with the button's padding)
        const drawn = [];
        for (const text of BACKS) {
          const l = await lastLabel(page, text);
          expect(l, `${text} on ${moon}`).toBeTruthy();
          drawn.push(l);
        }
        for (let i = 0; i < drawn.length; i += 1) {
          for (let j = 0; j < i; j += 1) {
            const apart = drawn[i].y !== drawn[j].y || drawn[i].x >= drawn[j].x + drawn[j].w + 20 || drawn[j].x >= drawn[i].x + drawn[i].w + 20;
            expect(apart, `${BACKS[j]} and ${BACKS[i]} apart on ${moon}`).toBe(true);
          }
        }
        const box = await canvas.boundingBox();
        for (const l of drawn) expect(l.x + l.w, "on the canvas").toBeLessThanOrEqual(box.width);
        if (moon === "luna") {
          await canvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
          await page.screenshot({ path: path.join(SHOT_DIR, `moon-${vp.label}.png`) });
        }

        // Back To Planet opens the moon's own planet, not the system
        const back = drawn[0];
        await canvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await clearLabels(page);
        await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
        await expect(page.locator("#map-details .ui-panel__title")).toHaveText(`${planet} - Sol`);
        await page.waitForTimeout(300);
        expect(await lastLabel(page, "◂ Back To Planet"), "a planet has no Back To Planet").toBeFalsy();
        expect(await lastLabel(page, "◂ Back To System")).toBeTruthy();
        if (moon === "luna") await page.screenshot({ path: path.join(SHOT_DIR, `planet-after-back-${vp.label}.png`) });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
