// ISP-115 (AB#807): the whole 22-system map of docs/design/starmap-20.md on the Starmap's cluster view, from the running
// game, at 1440x900 and 390x844. On a desktop every system is named; on a phone (AB#808) the system the corporation is
// in, the selected one and the selected one's neighbours (those whose names fit) are named, and the rest are stars. Tapping a Frontier system shows it and its gate. Starts its
// own server on a seeded data dir (e2e/seed-prospector-account.mjs: a corporation docked in Barnard's Star).
//
// Run: npx playwright test e2e/starmap-22.spec.js (no server needed).
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
const SYSTEMS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/systems.json"), "utf8"));

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

for (const vp of [{ label: "1440x900", width: 1440, height: 900, mobile: false }, { label: "390x844", width: 390, height: 844, mobile: true }]) {
  test(`the cluster view shows all 22 systems, at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-starmap22-e2e-"));
    const email = `starmap22-${Date.now()}-${vp.width}@example.test`;
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
      await page.waitForTimeout(1000);

      await canvas.screenshot({ path: path.join(SCREEN_DIR, `ab807-cluster-${vp.label}.png`) });
      await test.info().attach(`cluster-${vp.label}`, { body: await canvas.screenshot(), contentType: "image/png" });
      // The last frame's names (every draw clears the canvas, and the recorder with it only here).
      await page.evaluate(() => { window.__labels = []; });
      await page.setViewportSize({ width: vp.width, height: vp.height - 1 }); // a resize redraws the cluster
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(600);
      const drawn = new Set(await page.evaluate(() => window.__labels.map((l) => l.t)));
      const nameOf = (id) => SYSTEMS.find((s) => s.id === id).name;
      expect(SYSTEMS).toHaveLength(22);
      if (!vp.mobile) {
        expect(SYSTEMS.map((s) => s.name).filter((name) => !drawn.has(name)), "names missing from the cluster view").toEqual([]);
      } else {
        // AB#808 on a phone: the system you are in and the selected one (Sol, on opening) are named, and nothing is but
        // them and the selected system's neighbours; a neighbour whose name has nowhere to go is a star named on tap.
        const may = new Set(["barnards-star", "sol", ...SYSTEMS.find((s) => s.id === "sol").adjacent].map(nameOf));
        expect(drawn.has("Barnard's Star") && drawn.has("Sol"), "Barnard's Star and Sol are named").toBe(true);
        expect(SYSTEMS.map((s) => s.name).filter((name) => drawn.has(name) && !may.has(name)), "names a phone should not draw").toEqual([]);
        await test.info().attach("phone-names", { body: [...drawn].filter((t) => SYSTEMS.some((s) => s.name === t)).join(", "), contentType: "text/plain" });
      }

      // A Frontier system, opened from its star: its bodies and its gate.
      await openSystem(page, canvas, "Wolf 1061");
      const details = page.locator("#map-details");
      await expect(details).toContainText("Wolf 1061");
      await expect(details).toContainText("Frontier Cartography");
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab807-wolf-1061-${vp.label}.png`), fullPage: vp.mobile });
      await test.info().attach(`wolf-1061-${vp.label}`, { body: await page.screenshot({ fullPage: vp.mobile }), contentType: "image/png" });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
      await context.close();
    }
  });
}
