// AB#1326: open Sol and Epsilon Eridani on the Starmap at desktop, tablet and phone sizes and photograph each system
// view, so the outer bodies can be seen inside the top and bottom edges. The geometry itself is asserted in
// tests/unit/starmapFit.test.js; this is the look. Starts its own server (the logistics-shipments.spec.js pattern).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "docked-e2e-fixture-secret-0123456789abcd";

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "768x1024", width: 768, height: 1024, mobile: true },
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

const labelOf = (page, test) => page.evaluate((src) => {
  const match = new Function("t", `return ${src}`);
  return window.__labels.filter((l) => match(l.t)).pop();
}, test);

/** Taps a cluster star by its label: an init script records where the canvas wrote each label, and a star sits 10px
 *  plus its radius before its label, or after it when the label is drawn to the left. */
async function openSystem(page, canvas, name) {
  const label = await labelOf(page, `t === ${JSON.stringify(name)}`);
  expect(label, `${name} is drawn on the cluster view`).toBeTruthy();
  for (const dx of [-17, -20, label.w + 17, label.w + 20]) {
    await page.evaluate(() => { window.__labels = []; });
    await canvas.click({ position: { x: label.x + dx, y: label.y - 1 } });
    await page.waitForTimeout(400);
    if (await labelOf(page, `t.endsWith("Back To Cluster")`)) return;
  }
  throw new Error(`could not open ${name}`);
}

for (const viewport of VIEWPORTS) {
  test(`system views fit the Starmap at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile
    });
    const page = await context.newPage();
    const email = `starmap-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-starmap-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-docked-account.mjs", dir, email, PASSWORD, "earth-station-prime"], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-docked-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    try {
      await page.addInitScript(() => {
        window.__labels = [];
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
          window.__labels.push({ t: String(text), x, y, w: this.measureText(String(text)).width });
          return fillText.call(this, text, x, y, ...rest);
        };
      });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "starmap");
      const canvas = page.locator("#starmap-canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);

      // AB#1337: Alpha Centauri, where Centauri Prime ran its name across the star on a phone.
      for (const [name, file] of [["Sol", "ab1326-sol"], ["Epsilon Eridani", "ab1326-epsilon-eridani"], ["Alpha Centauri", "ab1337-alpha-centauri"]]) {
        await openSystem(page, canvas, name);
        await page.waitForTimeout(600);
        await canvas.screenshot({ path: path.join(SCREEN_DIR, `${file}-${viewport.label}.png`) });
        const back = await labelOf(page, `t.endsWith("Back To Cluster")`);
        await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
        await page.waitForTimeout(600);
      }
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
      await context.close();
    }
  });
}
