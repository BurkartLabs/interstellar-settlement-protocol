// AB#2471: the Station in subpages and the Operations view, in a real browser at 1280x800 and 375x812, for a busy
// corporation (e2e/seed-industry-account.mjs: two idle yards, a refinery run, research and a CEO program running, a
// shipment in transit). Each Station subpage and each Operations subpage is screenshotted and measured: DOCTRINE P-010 asks that a
// desktop page need little scrolling, so the spec records how far each one's content runs (the PR states it) and holds
// every one to no sideways scroll and, at 375, no text under 14px. Screenshots go to e2e/screenshots/ab-2471/
// (gitignored; the PR's are copied to docs/ab-2471/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2471");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "station-operations-e2e-fixture-secret-012345";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1280, 800], [375, 812]];

let server, url, email;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-station-ops-e2e-"));
  email = `station-ops-${Date.now()}@example.test`;
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
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const tinyText = (page, scope) => page.evaluate((scope) => {
  const out = [];
  for (const root of document.querySelectorAll(scope)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("option, [hidden]")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
  }
  return [...new Set(out)];
}, scope);
/** Where the open panel's content ends, in page pixels, and in screens of the viewport's height. */
const contentEnd = (page, panel) => page.evaluate(({ panel }) => {
  const el = document.querySelector(panel);
  const r = el.getBoundingClientRect();
  return Math.round(r.bottom + window.scrollY);
}, { panel });

const measures = [];
for (const size of SIZES) {
  const [width, height] = size;
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => {
      server?.kill();
      fs.writeFileSync(path.join(SHOT_DIR, `heights-${width}x${height}.txt`), measures.filter((m) => m.width === width).map((m) => `${m.name}: content ends at ${m.end}px, ${(m.end / height).toFixed(2)} screens`).join("\n"));
    });

    test(`the Station's subpages and the Operations view at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "station");
      for (const sub of ["overview", "offices", "construction", "holdings"]) {
        await page.locator(`#station-subtab-${sub}`).click();
        await expect(page.locator(`#station-sub-${sub}`)).toBeVisible();
        await page.waitForTimeout(300);
        measures.push({ width, name: `station/${sub}`, end: await contentEnd(page, "#station") });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(SHOT_DIR, `station-${sub}-${width}x${height}.png`), fullPage: true, animations: "disabled" });
        expect(await sideways(page), `station/${sub} sideways`).toBe(0);
        if (width === 375) expect(await tinyText(page, "#station"), `station/${sub} text under 14px`).toEqual([]);
      }
      await expect(page.locator("#station-sub-offices [data-building-action]").first()).toBeHidden(); // the offices are one subpage, not the page

      await openTab(page, "operations");
      await expect(page.locator("#operations-list .ops-row").first()).toBeVisible({ timeout: 15_000 });
      for (const kind of ["research", "program", "refining", "shipment"]) await expect(page.locator(`#operations-list [data-op-kind="${kind}"]`).first()).toBeVisible(); // the seed's; its yards are idle
      measures.push({ width, name: "operations/all", end: await contentEnd(page, "#operations") });
      await page.screenshot({ path: path.join(SHOT_DIR, `operations-all-${width}x${height}.png`), fullPage: true, animations: "disabled" });
      expect(await sideways(page), "operations sideways").toBe(0);
      if (width === 375) expect(await tinyText(page, "#operations"), "operations text under 14px").toEqual([]);
      await page.locator("#operations-subtab-mining").click();
      await expect(page.locator("#mine-cycle-list > *").first()).toBeVisible(); // each yard's card, idle or running
      measures.push({ width, name: "operations/mining", end: await contentEnd(page, "#operations") });
      await page.screenshot({ path: path.join(SHOT_DIR, `operations-mining-${width}x${height}.png`), fullPage: true, animations: "disabled" });

      // a row's Open takes the player to where the thing is run
      await page.locator("#operations-subtab-all").click();
      await page.locator('#operations-list [data-op-kind="research"] [data-op-tab]').first().click();
      await expect(page.locator("#rnd")).toBeVisible();
    });
  });
}
