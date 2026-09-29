// ISP-211 (AB#906): a conglomerate's station whose stakeholders voted it members-only, from an outsider's seat. The
// seed builds Venus Platform through the real project for another corporation and passes the vote; the player, docked
// at Earth, is refused at Venus Platform's dock with the reason. At 1440x900 and 390x844; e2e/screenshots/ab-906/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-906");
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
  test(`an outsider is refused at a members-only conglomerate station, with the reason, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const email = `cg-closed-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-cg-closed-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "cg-station-closed"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      const stations = await (await fetch(`${url}/api/stations`)).json();
      expect(stations.stations.find((s) => s.id === "cg-venus")).toMatchObject({ ownerType: "conglomerate", jurisdiction: "conglomerate" });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      await openTab(page, "starmap");
      await page.waitForTimeout(800);
      expect(await mapShow(page, { systemId: "sol" })).toBe(true);
      await openStation(page, "cg-venus");
      const modal = page.locator("#starmap-station-modal");
      await expect(modal).toContainText("Owned by Venus Builders Guild, the conglomerate that built it.");
      await modal.locator("[data-role=starmap-station-dock]").click();
      // Bug #4651: the refusal is said in the modal, where the order was given
      await expect(modal.locator(".starmap__dock-refused")).toContainText("Venus Platform admits members only, by the vote of Venus Builders Guild's stakeholders. Dock at another station in this system.");
      await expect(modal.locator(".starmap__dock-refused .protocol-line")).toContainText("Denied"); // ISP-255 (AB#4831)
      await expect(modal.locator(".starmap__dock-refused")).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `dock-refused-${viewport.label}.png`) });
      const me = await page.evaluate(async () => (await import("/scripts/state.js")).appState.data?.corp);
      expect(me.currentStationId).toBe("earth-station-prime"); // still docked where it was
      expect(me.travel ?? null).toBeNull();
      // and an order the server takes still closes the modal as the ship leaves (Bug #4651's other half)
      await page.locator("#starmap-station-modal .starmap__close").click();
      await openStation(page, "luna-gateway");
      await page.locator("#starmap-station-modal [data-role=starmap-station-dock]").click();
      await expect(page.locator("#starmap-station-modal")).toHaveCount(0);
      await expect.poll(async () => (await page.evaluate(async () => (await import("/scripts/state.js")).appState.data?.corp?.travel?.toStationId))).toBe("luna-gateway");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
