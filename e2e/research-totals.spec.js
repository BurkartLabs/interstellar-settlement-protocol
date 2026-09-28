// AB#2475: Corporate R&D and CEO Insight each show the time to finish every research item still outstanding, in a real
// browser at 1280x800 and 375x812, for a corporation with research and a CEO program running
// (e2e/seed-industry-account.mjs). The arithmetic is public/scripts/researchTotals.js (unit-tested); this checks each
// page draws it, from the page's own data. Screenshots go to e2e/screenshots/ab-2475/ (gitignored; the PR's are copied
// to docs/ab-2475/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2475");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "research-totals-e2e-fixture-secret-0123456";
const PASSWORD = "playtest-password-not-real";

let server, url, email;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-research-totals-e2e-"));
  email = `research-totals-${Date.now()}@example.test`;
  const seeded = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
  server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
}

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => server?.kill());

    test(`both research pages show the time to finish everything left at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "rnd");
      await expect(page.locator("#rnd-total")).toHaveText(/^Total time to complete all remaining research: \d+ d \d+ h \(\d+ h\) to finish all \d+ remaining technologies, one at a time\.$/, { timeout: 15_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(SHOT_DIR, `rnd-${width}x${height}.png`), animations: "disabled" });
      await openTab(page, "ceo");
      await expect(page.locator("#ceo-total")).toHaveText(/^Total time to complete all remaining programs: .+ remaining program levels, one at a time\.$/);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(SHOT_DIR, `ceo-${width}x${height}.png`), animations: "disabled" });
      if (width === 375) {
        const sizes = await page.evaluate(() => ["rnd-total", "ceo-total"].map((id) => parseFloat(getComputedStyle(document.getElementById(id)).fontSize)));
        for (const s of sizes) expect(s).toBeGreaterThanOrEqual(14);
      }
    });
  });
}
