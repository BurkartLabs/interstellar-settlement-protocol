// Bug #4846: on a phone every in-game screen started below the sidebar's three collapsed panels (Corporation Identity,
// Milestones, Quick Actions), so a screen's own title sat a third of the way down (found by the facelift inventory,
// AB#941). Below 768px the screen now comes first and the panels after it. At 375x812: on the Overview and the Station,
// the screen's title is above the panels and the screen starts in the first quarter of the first screenful; the panels are still there and
// still open. At 1280x800 the sidebar stays in its column beside the content. Screenshots: e2e/screenshots/ab-4846/.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4846");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "phone-sidebar-order-fixture-secret-012345";
const PASSWORD = "playtest-password-not-real";

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
const top = (page, sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

for (const [width, height, mobile] of [[375, 812, true], [1280, 800, false]]) {
  test(`the screen before the sidebar's panels on a phone, beside them on a desktop, at ${width}x${height} (Bug #4846)`, async ({ browser }) => {
    test.setTimeout(90_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-phone-sidebar-"));
    const email = `sidebar-${width}-${Date.now()}@example.test`;
    const run = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (run.status !== 0) throw new Error(`seed failed: ${run.stdout}\n${run.stderr}`);
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      for (const tab of ["overview", "station"]) {
        await openTab(page, tab);
        const title = `#${tab} .ui-screen__title, #${tab} h2`;
        await expect(page.locator(title).first()).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(SHOT_DIR, `${tab}-${width}.png`) });
        const titleTop = await top(page, title);
        const sideTop = await top(page, ".side-panel");
        const side = await page.locator(".side-panel").evaluate((el) => ({ left: el.getBoundingClientRect().left, shown: el.getClientRects().length > 0 }));
        const main = await page.locator(".main-panel").evaluate((el) => el.getBoundingClientRect().left);
        expect(side.shown, "the sidebar's panels are still on the page").toBe(true);
        if (mobile) {
          expect.soft(titleTop, `${tab}: the screen's title comes before the sidebar's panels`).toBeLessThan(sideTop);
          // the screen itself starts in the first quarter, right under the header (the Station's title then follows its own art)
          expect.soft(await top(page, `#${tab}`), `${tab}: the screen starts in the first quarter of the first screenful`).toBeLessThan(height / 4);
        } else {
          expect(side.left, "on a desktop the sidebar stays in its column, left of the content").toBeLessThan(main);
        }
      }
      if (mobile) { // the panels are one scroll away, after the screen
        await page.locator(".side-panel").evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(SHOT_DIR, `sidebar-after-screen-${width}.png`) });
      }
    } finally {
      await context.close();
      child.kill();
    }
  });
}
