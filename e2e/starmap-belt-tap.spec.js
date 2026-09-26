// AB#1344: on a phone, a tap on an asteroid belt in a system view went Back To Cluster. The back button's click target
// was a circle of radius 0.55 x its width (67px for "Back To Cluster"), wider than the button, and it was tested before
// any body. AB#1287 moved the orbits clear of the drawn button but not of that circle, so every belt drawn beside the
// button (one per system with a belt) sat inside it. This taps the centre of every belt in every system, at a phone
// and a desktop size, and expects the belt's own panel: Scout for the belt in the player's system, "travel there" for
// the rest. Starts its own server
// (the starmap-system-fit.spec.js pattern).
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
const SECRET = "prospector-e2e-fixture-secret-0123456789ab";

const VIEWPORTS = [
  { label: "375x812", width: 375, height: 812, mobile: true },
  { label: "1280x800", width: 1280, height: 800, mobile: false }
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

const lastLabel = (page, text) => page.evaluate((t) => window.__labels.filter((l) => l.t === t).pop(), text);
const backShown = (page) => page.evaluate(() => window.__labels.some((l) => l.t.endsWith("Back To Cluster")));

/** Taps a cluster star by its label: a star sits 10px plus its radius before its label, or after it. */
async function openSystem(page, canvas, name) {
  const label = await lastLabel(page, name);
  expect(label, `${name} is drawn on the cluster view`).toBeTruthy();
  for (const dx of [-17, -20, label.w + 17, label.w + 20]) {
    await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
    await canvas.click({ position: { x: label.x + dx, y: label.y - 1 } });
    await page.waitForTimeout(400);
    if (await backShown(page)) return;
  }
  throw new Error(`could not open ${name}`);
}

/**
 * Where a belt is drawn: drawAsteroidBelt fills its ring glow (radius + 8) and then strokes its ring (radius) about
 * the belt's centre, the radius being Math.max(10, body.radius + 5) in the system view.
 */
async function beltCentre(page, radius) {
  return page.evaluate((r) => {
    const arcs = window.__arcs;
    for (let i = 0; i + 1 < arcs.length; i += 1) {
      const [glow, ring] = [arcs[i], arcs[i + 1]];
      if (glow.x === ring.x && glow.y === ring.y && Math.abs(ring.r - r) < 0.01 && Math.abs(glow.r - r - 8) < 0.01) {
        return { x: ring.x, y: ring.y };
      }
    }
    return null;
  }, radius);
}

for (const viewport of VIEWPORTS) {
  test(`a tap on every belt opens the belt, with Scout, at ${viewport.label}`, async ({ browser, request }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile
    });
    const page = await context.newPage();
    const email = `belt-tap-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-belt-tap-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-prospector-account.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-prospector-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    try {
      const systems = (await (await request.get(`${url}/api/bootstrap`)).json()).world.systems;
      const belts = systems.flatMap((s) => (s.bodies || []).filter((b) => b.type === "Field").map((b) => ({ system: s, belt: b })));
      expect(belts.length, "the catalogue has belts to tap").toBeGreaterThanOrEqual(5);

      await page.addInitScript(() => {
        window.__labels = [];
        window.__arcs = [];
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
          window.__labels.push({ t: String(text), x, y, w: this.measureText(String(text)).width });
          return fillText.call(this, text, x, y, ...rest);
        };
        const arc = CanvasRenderingContext2D.prototype.arc;
        CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...rest) {
          window.__arcs.push({ x, y, r });
          return arc.call(this, x, y, r, ...rest);
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
      const details = page.locator("#map-details");

      const failed = [];
      for (const { system, belt } of belts) {
        await openSystem(page, canvas, system.name);
        await page.waitForTimeout(300);
        const centre = await beltCentre(page, Math.max(10, Number(belt.radius) + 5));
        expect(centre, `${system.name}: ${belt.name} is drawn`).toBeTruthy();
        if (system.id === "barnards-star") {
          await canvas.screenshot({ path: path.join(SCREEN_DIR, `ab1344-barnards-star-${viewport.label}.png`) });
        }
        await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
        // A phone is tapped (touch events, then the click the canvas listens for); a desktop is clicked.
        if (viewport.mobile) await canvas.tap({ position: { x: centre.x, y: centre.y } });
        else await canvas.click({ position: { x: centre.x, y: centre.y } });
        await page.waitForTimeout(400);
        const heading = (await details.locator("h3").first().textContent({ timeout: 2000 }).catch(() => "")) || "";
        const scout = await details.locator("#scout-belt-btn").count();
        // The player is docked in Barnard's Star: its belt can be scouted from here, any other says to travel first.
        const home = system.id === "barnards-star";
        const travel = await details.getByText(`Travel to ${system.name} to scout this belt.`).count();
        if (heading.trim() !== `${belt.name} — ${system.name}` || scout !== (home ? 1 : 0) || (!home && travel !== 1)) {
          failed.push(`${system.name} ${belt.name} tapped at (${centre.x.toFixed(0)}, ${centre.y.toFixed(0)}): panel "${heading.trim()}", Scout buttons ${scout}, travel lines ${travel}`);
        } else if (system.id === "barnards-star") {
          await page.screenshot({ path: path.join(SCREEN_DIR, `ab1344-barnards-belt-open-${viewport.label}.png`), fullPage: viewport.mobile });
        }
        // Back to the cluster for the next system: from the belt's view its "Back To Cluster", or from the system view.
        const back = await lastLabel(page, "◂ Back To Cluster");
        if (back) {
          await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
          await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
          await page.waitForTimeout(400);
        }
      }
      expect(failed).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
      await context.close();
    }
  });
}
