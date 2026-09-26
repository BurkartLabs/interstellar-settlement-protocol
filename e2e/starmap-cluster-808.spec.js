// ISP-116 (AB#808): the cluster view in the running game at 1440x900 and 390x844. At 1440 every system is named and
// no two names overlap, measured from what the canvas actually wrote; on a phone only Sol and its neighbours are named.
// Then a locked system (one past the deep-star gate) is tapped, its panel names the research, and back on the cluster
// its name carries the gate. Screenshots of both states at both sizes go to e2e/screenshots/ab-808/. Starts its own
// server on a seeded data directory (the starmap-system-fit.spec.js pattern).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-808");
const PASSWORD = "playtest-password-not-real";
const SECRET = "docked-e2e-fixture-secret-0123456789abcd";
const SYSTEMS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "systems.json"), "utf8"));
const RESEARCH = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "research.json"), "utf8")).nodes;
const LOCKED = SYSTEMS.find((s) => s.accessResearch === "tt-deep-star-navigation" && !SYSTEMS.find((x) => x.id === "sol").adjacent.includes(s.id));
const GATE = `Requires ${RESEARCH.find((n) => n.id === LOCKED.accessResearch).name}`;
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

/** The names the cluster view wrote in its last frame, with their boxes (from the canvas's own measureText). */
const clusterNames = (page) => page.evaluate((names) => {
  const frame = window.__labels.slice(window.__frameStart || 0);
  const latest = new Map();
  for (const l of frame) if (names.includes(l.t)) latest.set(l.t, l);
  return [...latest.values()].map((l) => ({ t: l.t, left: l.x, right: l.x + l.w, top: l.y - l.size * 0.8, bottom: l.y + l.size * 0.25 }));
}, SYSTEMS.map((s) => s.name));

test.describe.configure({ mode: "serial" });

for (const viewport of VIEWPORTS) {
  test(`the cluster view is legible and a locked system names its gate, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const email = `cluster808-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-cluster808-e2e-"));
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
        const clearRect = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
          // a new Starmap frame starts with a clear; the page has other canvases (the starfield) that clear too
          if (this.canvas?.id === "starmap-canvas") window.__frameStart = window.__labels.length;
          return clearRect.apply(this, args);
        };
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
          if (this.canvas?.id !== "starmap-canvas") return fillText.call(this, text, x, y, ...rest);
          const size = Number((/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 11])[1]);
          window.__labels.push({ t: String(text), x, y, w: this.measureText(String(text)).width, size });
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
      const box = await canvas.boundingBox();
      console.log(`cluster canvas at ${viewport.label}: ${Math.round(box.width)}x${Math.round(box.height)}`);

      const noneOverlap = (list) => {
        for (let i = 0; i < list.length; i += 1) {
          for (let j = i + 1; j < list.length; j += 1) {
            const [a, b] = [list[i], list[j]];
            expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, `${a.t} / ${b.t}`).toBe(false);
          }
        }
      };
      const sol = SYSTEMS.find((s) => s.id === "sol");
      const named = (ids) => SYSTEMS.filter((s) => ids.includes(s.id)).map((s) => s.name);
      let names = await clusterNames(page);
      if (!viewport.mobile) {
        expect(names.map((n) => n.t).sort(), "every system named").toEqual(SYSTEMS.map((s) => s.name).sort());
      } else {
        // On a phone: Sol (selected at first) and its neighbours that fit; nothing else.
        expect(names.map((n) => n.t), "Sol named").toContain("Sol");
        for (const n of names) expect(named(["sol", ...sol.adjacent]), `${n.t} may be named`).toContain(n.t);
      }
      noneOverlap(names);
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await canvas.screenshot({ path: path.join(SHOT_DIR, `cluster-${viewport.label}.png`) });

      // Tap the locked system where the catalog puts it; its panel names the research, and so does the cluster after.
      await canvas.click({ position: { x: LOCKED.mapPosition.x * box.width, y: LOCKED.mapPosition.y * box.height } });
      await page.waitForTimeout(600);
      await expect(page.locator("#map-details")).toContainText(GATE);
      const back = await page.evaluate(() => window.__labels.filter((l) => l.t.endsWith("Back To Cluster")).pop());
      await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
      await page.waitForTimeout(600);
      const written = await page.evaluate(() => window.__labels.slice(window.__frameStart || 0).map((l) => l.t));
      // On a desktop the gate is under its name on the map; on a phone it is in the panel just below (checked above).
      if (!viewport.mobile) expect(written, "the gate under the locked system's name").toContain(GATE);
      await expect(page.locator("#map-details")).toContainText(GATE);
      names = await clusterNames(page);
      expect(names.map((n) => n.t), "the selected locked system is named").toContain(LOCKED.name);
      if (viewport.mobile) for (const n of names) expect(named(["sol", LOCKED.id, ...LOCKED.adjacent]), `${n.t} may be named`).toContain(n.t);
      noneOverlap(names);
      await canvas.screenshot({ path: path.join(SHOT_DIR, `cluster-locked-selected-${viewport.label}.png`) });
      await page.screenshot({ path: path.join(SHOT_DIR, `page-locked-selected-${viewport.label}.png`), fullPage: false });
      const panel = page.locator("#map-details");
      await panel.scrollIntoViewIfNeeded();
      await panel.screenshot({ path: path.join(SHOT_DIR, `panel-locked-selected-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
