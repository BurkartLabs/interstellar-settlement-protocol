// Bug #4856: after a jump, the sidebar's Corporation Identity read "Location: sol", the system's id, until the corporation
// docked. The corporation here (e2e/seed-jump-arrival.mjs) has just arrived in Sol from Alpha Centauri, undocked; its
// Location must read "Sol". Screenshots of the identity block at 1280 and 375 go to e2e/screenshots/bug-4856/ (SHOT_LABEL
// names them; "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/jump-location.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gameDrawn } from "./nav.mjs"; // AB#2468: the header is a sheet on a phone

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "bug-4856");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "jump-location-e2e-fixture-secret-01234567";

let server, url, seeded;
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-jump-location-e2e-"));
  const run = spawnSync(process.execPath, ["e2e/seed-jump-arrival.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (run.status !== 0) throw new Error(`seed failed: ${run.stdout}\n${run.stderr}`);
  seeded = JSON.parse(run.stdout.trim().split("\n").at(-1));
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
  test(`the sidebar names the system a jump landed in, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", seeded.email);
    await page.fill("#login-password", PASSWORD);
    await page.click("#credential-login-btn");
    await gameDrawn(page);

    const toggle = page.locator('.side-panel__toggle[aria-controls="sidebar-identity"]');
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const identity = page.locator("#sidebar-identity");
    await expect(identity).toBeVisible();
    await expect(identity).toContainText("Location");
    const block = identity.locator("xpath=..");
    await block.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await block.screenshot({ path: path.join(SHOT_DIR, `identity-${LABEL}-${width}.png`), animations: "disabled" });
    await page.screenshot({ path: path.join(SHOT_DIR, `page-${LABEL}-${width}.png`), animations: "disabled" });

    await expect(identity.locator("dt", { hasText: "Location" }).locator("xpath=following-sibling::dd[1]")).toHaveText("Sol");
  });
}
