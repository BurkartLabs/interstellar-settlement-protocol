// Bug #4854: after a concession holder changed its lease discount, the Galactic Arbitration Council read the concession
// as not granted, so a lawful tariff showed as a full overcharge ("Lawful rate 0%") that any trader could reclaim. The
// seller here (e2e/seed-tariff-discount.mjs) paid the 2% in force at Alpha Centauri after the holder's discount change;
// the Council's evidence must read the lawful rate as 2% and the excess as nothing. Screenshots of the evidence at 1280
// and 375 go to e2e/screenshots/bug-4854/ (SHOT_LABEL names them; "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/tariff-case-discount.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gameDrawn, openStationOffices, openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "bug-4854");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "tariff-discount-e2e-fixture-secret-0123456";

let server, url, logins;
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-tariff-discount-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-tariff-discount.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
  logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
  server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
});
test.afterAll(() => server?.kill());

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`the Council reads a lawful tariff as lawful after the holder's discount change, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", logins.seller);
    await page.fill("#login-password", PASSWORD);
    await page.click("#credential-login-btn");
    await gameDrawn(page);

    await openTab(page, "station");
    await openStationOffices(page);
    await page.click('[data-building-action="building:galactic-arbitration-council"]');
    const filing = page.locator("[data-gac-filing]");
    await filing.locator('input[value="tariff-overcharge"]').check();
    await filing.locator('[data-role="gac-record"]').first().check();
    const evidence = filing.locator("[data-gac-evidence]");
    await expect(evidence).toBeVisible({ timeout: 15_000 });

    // the evidence, whole, in a viewport tall enough to hold it clear of a phone's fixed bars
    await page.evaluate(() => window.scrollTo(0, 0));
    let box = await filing.boundingBox();
    await page.setViewportSize({ width, height: Math.max(height, Math.ceil(box.y + box.height) + 200) });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    box = await filing.boundingBox();
    await page.screenshot({ path: path.join(SHOT_DIR, `evidence-${LABEL}-${width}.png`), clip: box, animations: "disabled" });
    await page.setViewportSize({ width, height });

    await expect(evidence).toContainText(/Holders' rates then\s*2% \(granted\)/);
    await expect(evidence).toContainText(/Lawful rate\s*2%/);
    await expect(evidence).toContainText(/Excess\s*0 credits/);
  });
}
