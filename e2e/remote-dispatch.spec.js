// Bug #4656: a member launches to a belt its partner scouted, from Sol, in a real browser at 1280x800 and 375x812. The
// data comes from e2e/seed-remote-dispatch.mjs: the founder scouted the Centauri Belt in Alpha Centauri; the member is
// docked in Sol with the research to reach it. The member opens the belt on the Starmap, reads the remote launch and
// its share of the yield, and launches. Each size starts its own freshly seeded server. Screenshots go to
// e2e/screenshots/bug-4656/ (gitignored; the PR's are copied to docs/bug-4656/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";
import { beltCentre, openSystem, recordCanvas } from "./starmapCanvas.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "bug-4656");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "remote-dispatch-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1280, 800], [375, 812]];

let server, url, logins;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-remote-dispatch-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-remote-dispatch.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-remote-dispatch.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
  server = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
}

for (const size of SIZES) {
  const [width, height] = size;
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => server?.kill());

    test(`a member launches to its partner's belt from Sol at ${width}x${height}`, async ({ page }) => {
      await recordCanvas(page);
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", logins.member);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "starmap");
      const canvas = page.locator("#starmap-canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await openSystem(page, canvas, "Alpha Centauri");
      const centre = await beltCentre(page, 15); // the Centauri Belt: radius 10, drawn at max(10, 10 + 5)
      expect(centre, "the Centauri Belt is drawn").toBeTruthy();
      await canvas.click({ position: centre });
      const details = page.locator("#map-details");
      await expect(details.locator("[data-belt-shared]")).toBeVisible({ timeout: 15_000 });
      const remote = details.locator("[data-belt-remote]");
      await expect(remote).toContainText("brings home 50% of what it mines");
      const button = details.locator("#launch-expedition-btn");
      await expect(button).toHaveText(/Launch Remote Expedition/);
      await button.scrollIntoViewIfNeeded();
      await details.screenshot({ path: path.join(SHOT_DIR, `remote-launch-${width}x${height}.png`), animations: "disabled" });
      await button.click();
      await expect(page.locator("#action-receipt-modal")).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `remote-receipt-${width}x${height}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(details.locator("[data-role=starmap-expedition]").first()).toBeVisible({ timeout: 15_000 });
      // the whole panel in one picture: a viewport tall enough to hold it, so the phone's fixed nav sits clear of it
      await page.setViewportSize({ width, height: Math.max(height, Math.ceil((await details.boundingBox()).height) + 400) });
      await details.scrollIntoViewIfNeeded();
      await details.screenshot({ path: path.join(SHOT_DIR, `remote-launched-${width}x${height}.png`), animations: "disabled" });
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways scroll").toBe(0);
    });
  });
}
