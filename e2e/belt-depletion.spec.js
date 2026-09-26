// AB#2330: a belt that runs out brings its probes home early, and says so; the empty slot refuses a scout, saying
// when a belt may next form there. Starts its own server on a seeded data dir (e2e/seed-depleting-belt.mjs): a probe on
// Barnard's Rift Debris Ring, which has 2 units left, so the first expedition tick mines it out.
//
// Run: npx playwright test e2e/belt-depletion.spec.js (no server needed).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "belt-depletion-e2e-fixture-secret-0123456789";

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

// The canvas helpers of e2e/starmap-belt-tap.spec.js (AB#1344): labels and arcs as the map draws them.
const lastLabel = (page, text) => page.evaluate((t) => window.__labels.filter((l) => l.t === t).pop(), text);
const backShown = (page) => page.evaluate(() => window.__labels.some((l) => l.t.endsWith("Back To Cluster")));

/**
 * Taps a cluster star by its label: a star sits 10px plus its radius before its label or after it, or (ISP-82, AB#771:
 * a phone's 14px names move clear of each other) above or below it. A tap that opens another system, whose star sits
 * near this label, goes back and tries the next place: the details panel names the system that opened.
 */
async function openSystem(page, canvas, name) {
  const label = await lastLabel(page, name);
  expect(label, `${name} is drawn on the cluster view`).toBeTruthy();
  const spots = [[-17, -1], [-20, -1], [label.w + 17, -1], [label.w + 20, -1], [label.w / 2, -26], [label.w / 2, 20]];
  // The map's back button is at its top edge, which a phone's fixed header can cover: tap with the map centred.
  await canvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await canvas.boundingBox();
  const onMap = ([dx, dy]) => label.x + dx >= 0 && label.x + dx <= box.width && label.y + dy >= 0 && label.y + dy <= box.height;
  for (const [dx, dy] of spots.filter(onMap)) {
    await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
    await canvas.click({ position: { x: label.x + dx, y: label.y + dy } });
    await page.waitForTimeout(400);
    if (!(await backShown(page))) continue;
    if ((await page.locator("#map-details .ui-panel__title").textContent()) === name) return;
    const back = await lastLabel(page, "◂ Back To Cluster");
    await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
    await canvas.click({ position: { x: back.x + back.w / 2, y: back.y - 3 } });
    await page.waitForTimeout(400);
  }
  throw new Error(`could not open ${name}`);
}

async function beltCentre(page, radius) {
  return page.evaluate((r) => {
    const arcs = window.__arcs;
    for (let i = 0; i + 1 < arcs.length; i += 1) {
      const [glow, ring] = [arcs[i], arcs[i + 1]];
      if (glow.x === ring.x && glow.y === ring.y && Math.abs(ring.r - r) < 0.01 && Math.abs(glow.r - r - 8) < 0.01) return { x: ring.x, y: ring.y };
    }
    return null;
  }, radius);
}

for (const vp of [{ label: "1280x800", width: 1280, height: 800 }, { label: "375x812", width: 375, height: 812 }]) {
  test(`a mined-out belt ends its expedition early and refuses a scout, at ${vp.label}`, async ({ page, request }) => {
    test.setTimeout(90_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-belt-depletion-e2e-"));
    const email = `depletion-${Date.now()}-${vp.width}@example.test`;
    execFileSync(process.execPath, ["e2e/seed-depleting-belt.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, env: { ...process.env, JWT_SECRET: SECRET } });
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.setViewportSize({ width: vp.width, height: vp.height });
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

      // The expedition tick runs every 10 seconds: the notification says the probe came home early, and why.
      await page.click("#notification-toggle");
      const item = page.locator("#notification-list li", { hasText: "Expedition Ended Early" }).first();
      await expect(item).toBeVisible({ timeout: 30_000 });
      await expect(item).toContainText(/The belt was mined out, so the probe came home \d+ minutes early\. The launch fee is not refunded\./);
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab2330-ended-early-${vp.label}.png`) });
      await test.info().attach(`ended-early-${vp.label}`, { body: await page.screenshot(), contentType: "image/png" });
      await page.click("#notification-toggle");

      // The ring on the Starmap: no longer scouted, and a scout is refused with when the next chance is.
      const systems = (await (await request.get(`${url}/api/bootstrap`)).json()).world.systems;
      const ring = systems.find((s) => s.id === "barnards-star").bodies.find((b) => b.id === "bn-rift");
      await openTab(page, "starmap");
      const canvas = page.locator("#starmap-canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await openSystem(page, canvas, "Barnard's Star");
      await page.waitForTimeout(300);
      const centre = await beltCentre(page, Math.max(10, Number(ring.radius) + 5));
      expect(centre, "the Rift Debris Ring is drawn").toBeTruthy();
      await canvas.click({ position: centre });
      const scout = page.locator("#map-details #scout-belt-btn");
      await expect(scout).toBeVisible();
      await scout.click();
      await page.waitForTimeout(500);
      await test.info().attach(`starmap-after-scout-${vp.label}`, { body: await page.screenshot({ fullPage: vp.width < 500 }), contentType: "image/png" });
      // A Starmap refusal is written to the Overview's Command Feedback, not beside the button (Bug #2339, filed
      // with AB#2330): read it there.
      await openTab(page, "overview");
      const refusal = page.locator("#feedback-log li", { hasText: "This belt has been mined out." }).first();
      await expect(refusal).toBeVisible();
      await expect(refusal).toContainText(/An empty belt has a 20% chance of forming anew each hour on the hour; the next chance is at \d\d:00 UTC\./);
      await refusal.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab2330-scout-refused-${vp.label}.png`) });
      await test.info().attach(`scout-refused-${vp.label}`, { body: await page.screenshot(), contentType: "image/png" });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
