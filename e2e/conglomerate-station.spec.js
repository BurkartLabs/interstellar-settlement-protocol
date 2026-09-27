// ISP-210 (AB#905): a conglomerate's station on the starmap, from the running app. The seed builds it through the real
// project (found, file at Venus, fund in full, complete); the system view marks it beside the neutral stations, in its
// own colour, and its modal names its owner. At 1440x900 and 390x844; screenshots go to e2e/screenshots/ab-905/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-905");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

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

const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);
const openStation = (page, id) => page.evaluate(async (s) => (await import("/scripts/views/starmap.js")).starmap.openStation(s), id);

for (const viewport of VIEWPORTS) {
  test(`a conglomerate's station on the starmap: marked in Sol, and its modal names the owner, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const email = `cg-station-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-cg-station-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "cg-station"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      const stations = await (await fetch(`${url}/api/stations`)).json();
      expect(stations.stations.find((s) => s.id === "cg-venus")).toMatchObject({ name: "Venus Platform", ownerType: "conglomerate", ownerName: "Venus Builders Guild", jurisdiction: "conglomerate" });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      await openTab(page, "starmap");
      await page.waitForTimeout(800);
      expect(await mapShow(page, { systemId: "sol" })).toBe(true);
      await page.waitForTimeout(500);
      const canvas = page.locator("#starmap-canvas");
      await canvas.scrollIntoViewIfNeeded();
      await canvas.screenshot({ path: path.join(SHOT_DIR, `sol-system-${viewport.label}.png`) });
      await expect(page.locator("#starmap-legend-owned")).toBeVisible();
      await expect(page.locator("#starmap-legend-owned")).toContainText("Conglomerate station");
      await page.locator("#starmap-legend-owned").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `sol-system-page-${viewport.label}.png`) });
      await openStation(page, "cg-venus");
      const modal = page.locator("#starmap-station-modal");
      await expect(modal).toBeVisible();
      await expect(modal).toContainText("Venus Platform");
      await expect(modal).toContainText("In orbit of Venus. Owned by Venus Builders Guild, the conglomerate that built it.");
      await expect(modal).toContainText("SOL-CGL-001");
      await page.screenshot({ path: path.join(SHOT_DIR, `venus-platform-modal-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
