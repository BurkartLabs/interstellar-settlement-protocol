// AB#2349 (the Director's ruling on AB#811): the cluster view badges a system's station count only where it exceeds the
// baseline of one (today Sol, 3), and the legend says every system has at least one. From the running game at 1440x900
// and 390x844, with what a phone can read counted: the system names drawn, and how many of them a badge overlaps.
// Starts its own server on a seeded data dir (e2e/seed-expedition-account.mjs: a corporation docked in Sol).
//
// Run: npx playwright test e2e/station-badges.spec.js (no server needed).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import { openSystem, recordCanvas } from "./starmapCanvas.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "expedition-e2e-fixture-secret-0123456789ab";
const SYSTEMS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/systems.json"), "utf8"));
const STATIONS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/stations.json"), "utf8")).stations;
const NAMES = new Set(SYSTEMS.map((s) => s.name));

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

/**
 * The last frame's names and badges, as the canvas wrote them. A badge is its count (digits, drawn after a diamond); its
 * box runs from the diamond (13px left of the count) to the count's end. A name's box is its text, 14px tall on a phone.
 */
async function frame(page, fontPx) {
  // A resize can draw the same frame twice: count each text at each place once.
  const seenAt = new Set();
  const labels = (await page.evaluate(() => window.__labels)).filter((l) => {
    const key = `${l.t}@${Math.round(l.x)},${Math.round(l.y)}`;
    if (seenAt.has(key)) return false;
    seenAt.add(key);
    return true;
  });
  // The text's own extent: an ascent of about 0.8 of the font and a descent of about 0.25 (a badge's pill adds 2px).
  const box = (l, left = 0) => ({ left: l.x - left, right: l.x + l.w + 2, top: l.y - fontPx * 0.8 - (left ? 2 : 0), bottom: l.y + fontPx * 0.25 + (left ? 2 : 0) });
  const names = labels.filter((l) => NAMES.has(l.t));
  const badges = labels.filter((l) => /^\d+$/.test(l.t));
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const covered = names.filter((n) => badges.some((b) => overlaps(box(n), box(b, 13))));
  return { names: names.map((n) => n.t), covered: covered.map((n) => n.t), badges: badges.map((b) => b.t) };
}

for (const vp of [{ label: "1440x900", width: 1440, height: 900, mobile: false, fontPx: 11 }, { label: "390x844", width: 390, height: 844, mobile: true, fontPx: 14 }]) {
  test(`station badges on the cluster, and what can be read, at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-badges-e2e-"));
    const email = `badges-${Date.now()}-${vp.width}@example.test`;
    execFileSync(process.execPath, ["e2e/seed-expedition-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, env: { ...process.env, JWT_SECRET: SECRET } });
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
      // One frame at the page's own size: clear the recorder and redraw with Reset View (a resize draws a frame at
      // another height first, whose names differ).
      await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
      await page.click("#map-reset");
      await page.waitForTimeout(400);
      const seen = await frame(page, vp.fontPx);
      const legible = seen.names.filter((n) => !seen.covered.includes(n));
      await test.info().attach(`reading-${vp.label}`, {
        body: `names drawn ${seen.names.length} of ${SYSTEMS.length}: ${seen.names.join(", ")}\n` +
          `names a badge overlaps ${seen.covered.length}: ${seen.covered.join(", ") || "none"}\n` +
          `legible ${legible.length}: ${legible.join(", ")}\nbadges ${seen.badges.length}: ${seen.badges.join(", ")}`,
        contentType: "text/plain"
      });
      console.log(`[${vp.label}] names ${seen.names.length}/${SYSTEMS.length}, overlapped ${seen.covered.length} (${seen.covered.join(", ")}), legible ${legible.length} (${legible.join(", ")}), badges ${seen.badges.length}`);
      await canvas.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab2349-cluster-${vp.label}.png`), fullPage: vp.mobile });
      await test.info().attach(`cluster-${vp.label}`, { body: await page.screenshot({ fullPage: vp.mobile }), contentType: "image/png" });
      await canvas.screenshot({ path: path.join(SCREEN_DIR, `ab2349-canvas-${vp.label}.png`) });

      // The rule: a badge only where a system has more stations than the baseline of one.
      const perSystem = new Map();
      for (const s of STATIONS) perSystem.set(s.systemId, (perSystem.get(s.systemId) || 0) + 1);
      const expected = [...perSystem.values()].filter((n) => n > 1).map(String).sort();
      expect(seen.badges.sort()).toEqual(expected);
      expect(expected).toEqual(["3"]); // Sol
      expect(seen.covered).toEqual([]);
      const legend = page.locator("#starmap-legend");
      await expect(legend).toContainText("Every system has at least one neutral station");

      // The system view is unchanged: a marker per station (Sol: Earth's, Luna's on Earth, Mars').
      await openSystem(page, canvas, "Barnard's Star");
      await expect(page.locator("#map-details")).toContainText("Barnard's Star");
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
      await context.close();
    }
  });
}
