// ISP-112 (AB#804): the starmap's cluster view, drawn from data/systems.json since the systems' map positions moved
// there out of starmap.js, is the view it was: every system's name is drawn where it was before the move, at 1440x900
// and 390x844. The positions from before are e2e/fixtures/starmap-cluster-labels.json, recorded from main (99306233)
// by this spec before the move, through a switch that wrote them and has since been removed (e2e specs write nothing
// into the checkout, AB#1827). Screenshots go to e2e/screenshots/ab-804/.
// Starts its own server on a seeded data directory (the starmap-system-fit.spec.js pattern).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-804");
const FIXTURE = path.join(REPO_ROOT, "e2e", "fixtures", "starmap-cluster-labels.json");
const PASSWORD = "playtest-password-not-real";
const SECRET = "docked-e2e-fixture-secret-0123456789abcd";
const SYSTEM_NAMES = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "systems.json"), "utf8")).map((s) => s.name);
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

test.describe.configure({ mode: "serial" });

for (const viewport of VIEWPORTS) {
  test(`the cluster view draws every system where it did before AB#804, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const email = `cluster-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-cluster-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-docked-account.mjs", dir, email, PASSWORD, "earth-station-prime"], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-docked-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.addInitScript(() => {
        window.__labels = [];
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
          window.__labels.push({ t: String(text), x, y });
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
      await expect(canvas).toBeVisible();
      await page.waitForTimeout(800); // the cluster view draws on change, not on a timer: keep every label it drew
      const labels = await page.evaluate((names) => Object.fromEntries(names.map((n) => {
        const last = window.__labels.filter((l) => l.t === n).pop();
        return [n, last ? { x: Math.round(last.x * 2) / 2, y: Math.round(last.y * 2) / 2 } : null];
      })), SYSTEM_NAMES);
      for (const name of SYSTEM_NAMES) expect(labels[name], `${name} is drawn on the cluster view`).toBeTruthy();

      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await canvas.screenshot({ path: path.join(SHOT_DIR, `cluster-after-${viewport.label}.png`) });
      const before = JSON.parse(fs.readFileSync(FIXTURE, "utf8"))[viewport.label];
      expect(labels).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
