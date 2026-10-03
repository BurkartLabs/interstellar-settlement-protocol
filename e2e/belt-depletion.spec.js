// AB#2330: a belt that runs out brings its probes home early, and says so; since AB#2331 its Starmap panel says there
// is no belt, and when one may next form there (the server's refusal of a scout there is tests/integration's). Starts its own server on a seeded data dir (e2e/seed-depleting-belt.mjs): a probe on
// Barnard's Rift Debris Ring, which has 2 units left, so the first expedition tick mines it out.
//
// Run: npx playwright test e2e/belt-depletion.spec.js (no server needed).
import { test, expect } from "@playwright/test";
import { openTab, toggleNotifications } from "./nav.mjs";
import { beltCentre, openSystem, recordCanvas } from "./starmapCanvas.mjs"; // AB#2331
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
      await recordCanvas(page);
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);

      // The expedition tick runs every 10 seconds: the notification says the probe came home early, and why.
      await toggleNotifications(page);
      const item = page.locator("#notification-list li", { hasText: "Expedition Ended Early" }).first();
      await expect(item).toBeVisible({ timeout: 30_000 });
      await expect(item).toContainText(/The belt was mined out, so the probe came home \d+ minutes early\. The launch fee is not refunded\./);
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab2330-ended-early-${vp.label}.png`) });
      await test.info().attach(`ended-early-${vp.label}`, { body: await page.screenshot(), contentType: "image/png" });
      await toggleNotifications(page);

      // The ring on the Starmap: no belt, no Scout, and when the next chance is (AB#2331).
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
      const details = page.locator("#map-details");
      await expect(details).toContainText("No belt here");
      await expect(details).toContainText(/20% chance a new one forms here, unscouted by anyone; the next chance is at \d\d:00 UTC/);
      await expect(details.locator("#scout-belt-btn")).toHaveCount(0);
      await details.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab2330-empty-slot-${vp.label}.png`) });
      await test.info().attach(`empty-slot-${vp.label}`, { body: await details.screenshot(), contentType: "image/png" });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
