// Bug AB#4745: the Starmap's GDP Index, Activity Level and Pirate Density overlays, in the running game at 1440x900 and
// 390x844, for a corporation that can reach only Sol (e2e/seed-docked-account.mjs). Choosing one used to leave the
// map as it was: every system it could not reach stayed the locked grey. This reads each star's colour from the canvas
// before and after choosing each overlay, and checks most stars change and the overlay's legend shows. Screenshots
// go to e2e/screenshots/ab-4745/ (gitignored; the PR's are copied to docs/ab-4745/).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-4745");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "field-overlays-e2e-fixture-secret-012345";
const SYSTEMS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "systems.json"), "utf8"));
const OVERLAYS = [["gdp", "GDP Index"], ["activity", "Activity Level"], ["pirates", "Pirate Density"]];

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" }, stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
  });
}

/** Each system's star colour as drawn: a pixel in its core, 4 CSS px right of the centre (the centre is white). */
const starColours = (page) => page.evaluate((systems) => {
  const canvas = document.getElementById("starmap-canvas");
  const ctx = canvas.getContext("2d");
  const kx = canvas.width / canvas.clientWidth, ky = canvas.height / canvas.clientHeight;
  return Object.fromEntries(systems.map((s) => {
    const x = Math.round((s.mapPosition.x * canvas.clientWidth + 4) * kx), y = Math.round(s.mapPosition.y * canvas.clientHeight * ky);
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    return [s.id, [r, g, b]];
  }));
}, SYSTEMS.map((s) => ({ id: s.id, mapPosition: s.mapPosition })));
const differs = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30;

test.describe.configure({ mode: "serial" });

for (const vp of [{ label: "1440x900", width: 1440, height: 900, mobile: false }, { label: "390x844", width: 390, height: 844, mobile: true }]) {
  test(`the GDP, Activity and Pirates overlays recolour the map and show their scale, at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const email = `field-overlays-${Date.now()}-${vp.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-field-overlays-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-docked-account.mjs", dir, email, PASSWORD, "earth-station-prime"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-docked-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "starmap");
      const canvas = page.locator("#starmap-canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      const before = await starColours(page);
      const legend = page.locator("#starmap-dominance-legend");
      await expect(legend).toBeHidden();

      for (const [value, label] of OVERLAYS) {
        await page.selectOption("#map-overlay", value);
        await page.waitForTimeout(400);
        const after = await starColours(page);
        const changed = SYSTEMS.filter((s) => differs(before[s.id], after[s.id])).length;
        expect(changed, `${label}: stars recoloured of ${SYSTEMS.length}`).toBeGreaterThan(SYSTEMS.length / 2);
        await expect(legend).toBeVisible();
        await expect(legend).toContainText(`${label}: each system coloured by its ${label}`);
        await expect(legend.locator(`[data-field-legend="${value}"] li`)).toHaveCount(5);
        if (value === "gdp") {
          await canvas.screenshot({ path: path.join(SHOT_DIR, `cluster-gdp-${vp.label}.png`) });
          await legend.screenshot({ path: path.join(SHOT_DIR, `legend-gdp-${vp.label}.png`) });
        }
      }
      // back to none: the plain map again, and no legend
      await page.selectOption("#map-overlay", "none");
      await expect(legend).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
