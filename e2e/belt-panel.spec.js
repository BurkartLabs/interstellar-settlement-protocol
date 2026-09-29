// AB#2331: the belt panel's three states on the Starmap, at 375, 768 and 1280: a scouted belt (its rarity, a labelled
// composition bar, the reserve left), an unscouted one, and an empty slot (no belt, the next hourly chance); a refused
// launch said in the panel (Bug #2339); and a belt forming anew while its panel is open, shown without a reload.
// Starts its own servers on seeded data dirs (e2e/seed-belt-panel.mjs).
//
// Run: npx playwright test e2e/belt-panel.spec.js (no server needed).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import { backToCluster, beltCentre, openSystem, recordCanvas } from "./starmapCanvas.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "belt-panel-e2e-fixture-secret-0123456789ab";

function startServer(dir, { tickers }) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: tickers ? "" : "1" },
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

/** A seeded server and a signed-in page on its Starmap. */
async function openGame(page, vp, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-belt-panel-e2e-"));
  const email = `belt-panel-${Date.now()}-${vp.width}@example.test`;
  execFileSync(process.execPath, ["e2e/seed-belt-panel.mjs", dir, email, PASSWORD, mode], { cwd: REPO_ROOT, env: { ...process.env, JWT_SECRET: SECRET } });
  const server = await startServer(dir, { tickers: mode === "respawn" });
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await recordCanvas(page);
  await page.goto(`${server.url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "starmap");
  const canvas = page.locator("#starmap-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const done = () => { server.child.kill(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { canvas, url: server.url, done };
}

/** Opens a system and taps (a phone) or clicks its belt; the belt's panel is then #map-details. */
async function openBelt(page, canvas, vp, systemName, radius) {
  await openSystem(page, canvas, systemName);
  await page.waitForTimeout(300);
  const centre = await beltCentre(page, Math.max(10, radius + 5));
  expect(centre, `${systemName}'s belt is drawn`).toBeTruthy();
  await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
  if (vp.mobile) await canvas.tap({ position: centre });
  else await canvas.click({ position: centre });
  await page.waitForTimeout(400);
  const details = page.locator("#map-details");
  await details.scrollIntoViewIfNeeded();
  return details;
}

async function look(page, details, name) {
  await page.screenshot({ path: path.join(SCREEN_DIR, `${name}-page.png`) });
  await details.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`) });
  await test.info().attach(name, { body: await details.screenshot(), contentType: "image/png" });
}

const VIEWPORTS = [
  { label: "375x812", width: 375, height: 812, mobile: true },
  { label: "768x1024", width: 768, height: 1024, mobile: true },
  { label: "1280x800", width: 1280, height: 800, mobile: false }
];

for (const vp of VIEWPORTS) {
  test(`the belt panel's three states, and a refusal in it, at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const { canvas, done } = await openGame(page, vp, "static");
    try {
      // Scouted: the Rift Debris Ring, 37% of its reserve left.
      let details = await openBelt(page, canvas, vp, "Barnard's Star", 11);
      await expect(details.locator(".belt-bar")).toBeVisible();
      await expect(details.locator(".belt-bar__legend li").first()).toBeVisible();
      await expect(details).toContainText(/Material Composition\s*(Common|Uncommon|Rare|Exotic)/);
      await expect(details).toContainText(/[\d,]+ of [\d,]+ units left \(37%\)/);
      await expect(details).toContainText("Generation 1");
      await look(page, details, `ab2331-scouted-${vp.label}`);
      // Bug #4775: the launch price is data/economy.json's, sent by GET /api/bootstrap, not a copy in the page
      await expect(details.locator("#launch-expedition-btn")).toHaveText(/^Launch (Remote )?Expedition \(¤[\d,]+\)$/);

      // Bug #2339: 100 credits, so the launch is refused, and the panel says why.
      await details.locator("#launch-expedition-btn").click();
      const notice = details.locator(".starmap__notice[role=alert]");
      await expect(notice).toBeVisible();
      await expect(notice).toContainText(/Expedition launch/);
      await look(page, details, `ab2331-refused-${vp.label}`);
      await backToCluster(page, canvas);

      // Unscouted: Sol's belt, from Barnard's Star.
      details = await openBelt(page, canvas, vp, "Sol", 13);
      await expect(details).toContainText("Material composition unknown");
      await expect(details).toContainText("Travel to Sol to scout this belt.");
      await expect(details.locator(".belt-bar")).toHaveCount(0);
      await look(page, details, `ab2331-unscouted-${vp.label}`);
      await backToCluster(page, canvas);

      // Empty: the Centauri Belt, mined out.
      details = await openBelt(page, canvas, vp, "Alpha Centauri", 10);
      await expect(details.locator("[data-belt-state=empty]")).toBeVisible();
      await expect(details).toContainText("No belt here");
      await expect(details).toContainText(/20% chance a new one forms here, unscouted by anyone; the next chance is at \d\d:00 UTC\./); // AB#4773: UTC only since AB#945
      await look(page, details, `ab2331-empty-${vp.label}`);

      // Nothing drawn off the panel's edge or clipped (the AB#772 sweep's checks, for this panel).
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      done();
      await context.close();
    }
  });
}

test("a belt that forms anew while its empty panel is open shows, unscouted, without a reload", async ({ browser }) => {
  test.setTimeout(150_000);
  const vp = VIEWPORTS[2];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const { canvas, done } = await openGame(page, vp, "respawn");
  try {
    const details = await openBelt(page, canvas, vp, "Alpha Centauri", 10);
    await expect(details).toContainText("No belt here");
    await look(page, details, "ab2331-respawn-before");
    // The server's belt ticker first runs a minute after it starts, drawing the hours missed; the page hears
    // belts:changed and refetches. No reload, no click.
    await expect(details).toContainText("Material composition unknown", { timeout: 100_000 });
    await expect(details).toContainText("Generation 2");
    await expect(details).not.toContainText("No belt here");
    await look(page, details, "ab2331-respawn-after");
  } finally {
    done();
    await context.close();
  }
});
