// ISP-212 (AB#907): what membership is worth at the conglomerate's own station, from the running app. The member,
// docked at Venus Platform, sees the Suites at the member rate and leases at it; the Logistics tab quotes goods from
// Earth to Venus Platform (the same system) as free and moves them for nothing; the starmap modal says the rate is the
// member's. At 1440x900 and 390x844; e2e/screenshots/ab-907/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-907");
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

const openStation = (page, id) => page.evaluate(async (s) => (await import("/scripts/views/starmap.js")).starmap.openStation(s), id);
const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);
const corpNow = (page) => page.evaluate(async () => (await import("/scripts/state.js")).appState.data?.corp);

for (const viewport of VIEWPORTS) {
  test(`a member at its own station: the office at the member rate, and free logistics in the system, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const email = `cg-member-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-cg-member-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "cg-station-member"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      await expect.poll(() => page.evaluate(async () => (await import("/scripts/state.js")).appState.conglomerate?.station?.id)).toBe("cg-venus");

      // the Suites at Venus Platform: the member rate, quoted and charged
      await openTab(page, "station");
      await page.click('[data-building-action="building:orbital-executive-suites"]');
      const suite = page.locator("#lease-suite-box");
      await expect(suite).toContainText("Member rate: your conglomerate's station, so the rent is 50% of the standard $1,000 credits a day.");
      await expect(suite).toContainText("Lease Cost$500 credits a day");
      await expect(page.locator("#rent-office-duration option").first()).toHaveText("7 days — $3,500");
      await suite.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `suites-member-rate-${viewport.label}.png`) });
      const before = (await corpNow(page)).finances.credits;
      await page.selectOption("#rent-office-duration", "7");
      await page.click("#rent-office-btn");
      await expect(page.locator("#action-receipt-modal")).toBeVisible();
      await expect(page.locator("#action-receipt-modal")).toContainText("3,500");
      await page.screenshot({ path: path.join(SHOT_DIR, `suites-member-receipt-${viewport.label}.png`) });
      expect(before - (await corpNow(page)).finances.credits).toBe(3_500);
      await page.locator("#action-receipt-close").click();

      // Logistics: Earth to Venus Platform is in Sol, so free for a member; moved for nothing
      await openTab(page, "logistics");
      const earth = page.locator(".logistics__station", { hasText: "Earth Station Prime" });
      await expect(earth.locator(".logistics__route-fee")).toContainText("free for members");
      await earth.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `logistics-member-free-${viewport.label}.png`) });
      const credits = (await corpNow(page)).finances.credits;
      await earth.locator("button", { hasText: /Move/ }).first().click();
      await expect.poll(async () => ((await corpNow(page)).shipments || []).length).toBeGreaterThan(0);
      const shipment = (await corpNow(page)).shipments[0];
      expect(shipment.fee).toBe(0);
      expect((await corpNow(page)).finances.credits).toBe(credits);

      // the starmap modal says the rent is the member's
      await openTab(page, "starmap");
      await page.waitForTimeout(600);
      expect(await mapShow(page, { systemId: "sol" })).toBe(true);
      await openStation(page, "cg-venus");
      await expect(page.locator("#starmap-station-modal")).toContainText("¤500 a day, for 7 to 28 days (member rate)");
      await page.screenshot({ path: path.join(SHOT_DIR, `starmap-member-rate-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
