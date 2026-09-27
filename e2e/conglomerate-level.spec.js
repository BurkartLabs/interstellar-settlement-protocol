// ISP-203 (AB#897): the conglomerate's level panel and the level-up overlay, in a real browser at 1280x800 and 375x812.
// The data comes from e2e/seed-conglomerate-level.mjs (the server's own conglomerate code): a level-1 conglomerate ready
// for level 2, its founder docked at the Bureau and a member away from it. The founder reads the requirements, buys the
// level through the confirmation, and sees the overlay once; after a reload it is not shown again. The member sees the
// panel with the button disabled and the reasons, and the overlay once too. Each size starts its own freshly seeded
// server. Screenshots go to e2e/screenshots/ab-897/ (gitignored; the PR's are copied to docs/ab-897/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-897");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "conglomerate-level-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1280, 800], [375, 812]];

let server, url, logins;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-conglomerate-level-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-conglomerate-level.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-conglomerate-level.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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

async function signIn(page, who, [width, height]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", logins[who]);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
}
async function openLevel(page, who, size) {
  if (who) await signIn(page, who, size);
  await openTab(page, "conglomerate");
  const panel = page.locator('[data-role="cong-level"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}
/** The whole panel in one picture: a viewport tall enough to hold it, so the phone's fixed nav sits clear of it. */
async function shot(page, el, name, [width, height]) {
  await page.waitForLoadState("networkidle"); // a register read in flight redraws the panel
  await expect(el).toBeVisible();
  const tall = Math.ceil((await el.boundingBox()).height) + 400;
  await page.setViewportSize({ width, height: Math.max(height, tall) });
  await page.waitForLoadState("networkidle");
  await expect(el).toBeVisible();
  await el.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), animations: "disabled" });
  await page.setViewportSize({ width, height });
}
const overlay = (page) => page.locator("#action-receipt-modal");
/** At 375, the level panel's own text under 14px (the phone rule the Company screens are held to), as a list. */
const tinyText = (page) => page.evaluate(() => {
  const out = [];
  const root = document.querySelector('[data-role="cong-level"]');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el.getClientRects().length) continue;
    const f = parseFloat(getComputedStyle(el).fontSize);
    if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
  }
  return [...new Set(out)];
});
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const size of SIZES) {
  const [width, height] = size;
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => server?.kill());

    test(`the founder buys level 2 and sees the overlay once at ${width}x${height}`, async ({ page }) => {
      const panel = await openLevel(page, "founder", size);
      await expect(panel).toContainText("Level 1 · room for 5 members, 4 now");
      await expect(panel).toContainText("Level 2 makes room for 10. It costs 50,000 credits from the treasury, which must keep 4,200 more for upkeep.");
      await expect(panel.locator('[data-requirement="members"]')).toContainText("4 of 4 · met");
      await expect(panel.locator(".cong-level__req--met")).toHaveCount(4);
      const buy = panel.locator('[data-role="cong-level-buy"]');
      await expect(buy).toBeEnabled();
      await shot(page, panel, "panel-ready", size);
      expect(await sideways(page), "sideways scroll").toBe(0);

      await buy.click();
      await expect(page.locator("#trade-confirm-title")).toHaveText(/Buy level 2 for /);
      await expect(page.locator("#trade-confirm-body")).toContainText("50,000 credits, leaving 18,800") // 68,800 in the treasury: the charter deposit and 60,000 less the custody fee;
      await page.locator("#trade-confirm-ok").click();
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("#action-receipt-title")).toHaveText(/reached level 2$/);
      await expect(page.locator("#action-receipt-body")).toContainText("room for 10 members");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOT_DIR, `overlay-${width}x${height}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(panel).toContainText("Level 2 · room for 10 members, 4 now");

      await page.reload();
      await openTab(page, "conglomerate");
      await expect(page.locator('[data-role="cong-level"]')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1_000);
      await expect(overlay(page)).toBeHidden(); // once per member per level, not again on reload
    });

    test(`a member sees the overlay once and the disabled upgrade with its reasons at ${width}x${height}`, async ({ page }) => {
      await signIn(page, "member", size);
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 }); // the founder's purchase reached every member, at sign-in
      await expect(page.locator("#action-receipt-title")).toHaveText(/reached level 2$/);
      await page.keyboard.press("Escape");
      const panel = await openLevel(page, null, size);
      await expect(panel).toContainText("Level 2 · room for 10 members, 4 now");
      await expect(panel.locator('[data-role="cong-level-buy"]')).toBeDisabled();
      await expect(panel.locator("#cong-level-why")).toContainText("Only the founder buys a level");
      await expect(panel.locator("#cong-level-why")).toContainText("Earth Station Prime");
      await expect(panel.locator("#cong-level-why")).toContainText("not met yet");
      await shot(page, panel, "panel-member", size);
      expect(await sideways(page), "sideways scroll").toBe(0);
      if (width === 375) expect(await tinyText(page), "text under 14px at 375").toEqual([]);
      await page.reload();
      await openTab(page, "conglomerate");
      await expect(page.locator('[data-role="cong-level"]')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1_000);
      await expect(overlay(page)).toBeHidden();
    });
  });
}
