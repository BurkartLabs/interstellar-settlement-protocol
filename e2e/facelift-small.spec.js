// Bugs #4842, #4843 and #4844, from the facelift inventory (AB#941), on a busy corporation (e2e/seed-industry-account.mjs):
//   #4842  Operations at 768 scrolled sideways 18px: a row's Open button past the edge. No sideways scroll at 375, 768
//          or 1280, and every row's Open button inside the screen.
//   #4843  The Loan Board's selects (in the Deep Space Development Bank) were styled as text inputs: each is a .ui-select.
//   #4844  The page titles and the header's name used a clamp() written out, not a token: their sizes are what they
//          were (a token now holds the same clamp()); the sizes are recorded for the before-and-after.
// Screenshots go to e2e/screenshots/facelift-small/.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab, openStationOffices } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "facelift-small");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "facelift-small-fixture-secret-0123456789ab";
const PASSWORD = "playtest-password-not-real";
// what the titles measured before #4844 (the clamp() written out): the token must not change them
const TITLE_PX = { 375: { page: 22, header: 18 }, 768: { page: 22, header: 19.968 }, 1280: { page: 22, header: 28.8 } }; // measured before the fix

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}
const px = (page, sel) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

for (const [width, height, mobile] of [[375, 812, true], [768, 1024, false], [1280, 800, false]]) {
  test(`Operations, the Loan Board and the titles at ${width}x${height} (Bugs #4842, #4843, #4844)`, async ({ browser }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-facelift-small-"));
    const email = `small-${width}-${Date.now()}@example.test`;
    const run = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (run.status !== 0) throw new Error(`seed failed: ${run.stdout}\n${run.stderr}`);
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    try {
      // #4844: the login page's title
      await page.goto(`${url}/login.html`);
      const pageTitle = await px(page, "h1");
      await page.locator("h1").first().screenshot({ path: path.join(SHOT_DIR, `title-login-${width}.png`) });
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      const headerTitle = await px(page, ".app-header__title");
      expect.soft(pageTitle, "the login page's title keeps its size").toBeCloseTo(TITLE_PX[width].page, 1);
      expect.soft(headerTitle, "the header's name keeps its size").toBeCloseTo(TITLE_PX[width].header, 1);

      // #4842: Operations
      await openTab(page, "operations");
      await expect(page.locator("#operations-list .ops-row").first()).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const buttonsOut = await page.evaluate(() => [...document.querySelectorAll("#operations-list .ops-row button")].filter((b) => b.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length);
      await page.locator("#operations-list").evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: path.join(SHOT_DIR, `operations-${width}.png`) });
      expect.soft(sideways, "Operations scrolls sideways").toBe(0);
      expect.soft(buttonsOut, "Open buttons past the edge").toBe(0);

      // #4843: the Loan Board's selects, in the Development Bank
      await openTab(page, "station");
      await openStationOffices(page);
      await page.click('[data-building-action="building:deep-space-development-bank"]');
      const board = page.locator('[data-role="loan-board-sort"]').locator("xpath=ancestor::section[1]");
      await expect(page.locator('[data-role="loan-board-sort"]')).toBeVisible();
      const classes = await page.locator("#station-building-view select").evaluateAll((els) => els.map((e) => `${e.name}:${e.className}`));
      await page.locator('[data-role="loan-board-sort"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: path.join(SHOT_DIR, `loan-board-${width}.png`) });
      for (const c of classes) expect.soft(c, "every select in the Bank is the design system's").toMatch(/\bui-select\b/);
      expect(await board.count()).toBeGreaterThan(0);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
