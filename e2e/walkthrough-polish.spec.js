// AB#2463 (Board review items 4, 5, 6, 7, 9, 10): the walkthrough card in a real browser at 1280x800 and 375x812. A new
// player accepts the briefing: step 1 starts with the inbox (no second introduction), in paragraphs; the portrait is the
// larger coloured square; the card's width follows the screen (about 600px at 1920x1080); no "Start here" on the
// Station; and step 4's highlight on the hiring form stands off it. Screenshots go to e2e/screenshots/ab-2463/
// (gitignored; the PR's are copied to docs/ab-2463/).
//
// Run against a server started in test mode (BASE_URL), as e2e/walkthrough-run.spec.js does.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openTab, openStationOffices } from "./nav.mjs";
import { verifyAndLogIn } from "./verification.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2463");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`the walkthrough card and step 4's highlight at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height });
    const stamp = `${width}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const email = `walk-polish-${stamp}@example.test`;
    await page.goto("/register.html");
    await page.fill("#register-email", email);
    await page.fill("#register-password", PASSWORD);
    await page.fill("#register-ceo", "Playtest CEO");
    await page.fill("#register-corp", `Polish Corp ${stamp}`);
    await page.click('#register-form button[type="submit"]');
    await verifyAndLogIn(page, "", email, PASSWORD);
    await page.waitForURL(/\/\?account=/);
    await page.getByRole("button", { name: "Brief me" }).click();
    const card = page.locator("#walkthrough-modal .modal-card");
    await expect(card).toBeVisible();

    // step 1: the work, not a second introduction, in paragraphs
    await expect(page.locator("#walkthrough-progress")).toHaveText(/^1 of /);
    const paras = page.locator("#walkthrough-text p");
    await expect(paras.first()).toHaveText(/^Start with your inbox/);
    expect(await paras.count()).toBeGreaterThanOrEqual(2);
    const portrait = await page.locator("#walkthrough-portrait").boundingBox();
    expect(Math.round(portrait.width)).toBe(Math.round(portrait.height)); // a square
    expect(portrait.width).toBeGreaterThanOrEqual(width === 375 ? 60 : 100);
    await page.screenshot({ path: path.join(SHOT_DIR, `step1-${width}x${height}.png`), animations: "disabled" });
    const cardWidth = Math.round((await card.boundingBox()).width);
    if (width === 1280) expect(cardWidth).toBe(400); // 31.25vw at 1280

    // no "Start here" on the Station
    await openTab(page, "inbox");
    await openTab(page, "station");
    await expect(page.locator("#station")).not.toContainText(/start here/i);

    // step 4: the highlight on the hiring form stands off it
    await openStationOffices(page);
    await page.click('[data-building-action="building:orbital-executive-suites"]');
    await page.selectOption("#rent-office-duration", "7");
    await page.click("#rent-office-btn");
    await acknowledgeReceipt(page);
    await expect(page.locator("#walkthrough-progress")).toHaveText(/^4 of /, { timeout: 60_000 });
    const focus = page.locator(".walkthrough__focus").first();
    await expect(focus).toBeVisible();
    expect(await focus.evaluate((el) => getComputedStyle(el).outlineOffset)).toBe("8px");
    await focus.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT_DIR, `step4-highlight-${width}x${height}.png`), animations: "disabled" });

    // the card's width follows the screen: about 600px at 1920x1080
    if (width === 1280) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(300);
      expect(Math.round((await card.boundingBox()).width)).toBe(600);
      await page.screenshot({ path: path.join(SHOT_DIR, `step4-1920x1080.png`), animations: "disabled" });
    }
  });
}
