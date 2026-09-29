// AB#2484: a mining contract says what is still needed, and it falls as the corporation mines; an offer states its
// target before it is accepted. A real mining cycle runs on the spec's own server ticker (e2e/seed-mission-progress.mjs),
// so the figure moves on the mining:updated event with no reload, as a player sees it. At 1280x800 and 375x812.
// Screenshots go to e2e/screenshots/ab-2484/ (gitignored; the PR's are copied to docs/ab-2484/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2484");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "mission-progress-e2e-fixture-secret-01234";
const PASSWORD = "playtest-password-not-real";

function startServer(dir) {
  // tickers on: the server mines every 5 seconds, which is the progress this checks
  const child = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
  });
}

const remainingOf = async (locator) => Number(((await locator.textContent()) || "").match(/^([\d,]+) Silicates still needed$/)?.[1]?.replace(/,/g, "") ?? NaN);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`a mining contract shows what is still needed, falling as it is mined, and an offer its target, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(180_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-mission-progress-e2e-"));
    const email = `mission-progress-${Date.now()}-${width}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-mission-progress.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { target } = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "missions");

      // the active contract: what remains, 300 or a little less (the server has been mining since the seed)
      const card = page.locator('#active-mission-list [data-state="active"]').first();
      const figure = card.locator(".missions__remaining-figure");
      await expect(figure).toHaveText(/^[\d,]+ Silicates still needed$/, { timeout: 15_000 });
      const first = await remainingOf(figure);
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThanOrEqual(300);
      await expect(card.locator(".missions__remaining-detail")).toHaveText(new RegExp(`^[\\d,]+ of ${target.toLocaleString("en-US")} Silicates in stock$`));
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `active-${width}x${height}.png`), animations: "disabled" });

      // it falls as the corporation mines, on the mining:updated event, with no reload
      await expect.poll(() => remainingOf(figure), { timeout: 100_000, intervals: [2_000] }).toBeLessThan(first);

      // the briefing says the same, and follows it while open
      await card.locator(".ui-card__title").click();
      const brief = page.locator("#mission-quota-text .missions__remaining-figure");
      await expect(brief).toHaveText(/^[\d,]+ Silicates still needed$/);
      await expect(page.locator("#mission-quota-heading")).toHaveText("Quota Progress");
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: path.join(SHOT_DIR, `briefing-active-${width}x${height}.png`), animations: "disabled" });
      await page.click("#mission-modal-close");

      // an offer, before it is accepted: its target on the card and in the briefing
      await page.locator("[data-agent-id]").first().click();
      const offer = page.locator("#agent-mission-list [data-mission-id]").first();
      await expect(offer.locator(".missions__target")).toHaveText("Target: 300 Nickel");
      expect(await noSideScroll(page)).toBe(true);
      await offer.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `offer-${width}x${height}.png`), animations: "disabled" });
      await offer.click();
      await expect(page.locator("#mission-accept-btn")).toBeVisible();
      await expect(page.locator("#mission-quota-heading")).toHaveText("Target");
      await expect(page.locator("#mission-quota-text .missions__remaining-figure")).toHaveText("300 Nickel");
      await expect(page.locator("#mission-quota-text .missions__remaining-detail")).toHaveText("Delivered to Earth Station Prime.");
      await page.screenshot({ path: path.join(SHOT_DIR, `briefing-offer-${width}x${height}.png`), animations: "disabled" });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
