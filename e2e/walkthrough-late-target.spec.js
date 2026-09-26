// AB#1756: at phone width, a walkthrough target that only appears after its step has rendered (step 3's Execute
// Lease Agreement button, drawn when the player opens the Orbital Executive Suites) must end up clear of the briefing
// card, not under it. The player does no scrolling of their own here; everything visible is the walkthrough's doing.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/walkthrough-late-target.spec.js`.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { WALKTHROUGH_STEPS } from "../public/scripts/walkthrough.js";
import { verifyAndLogIn } from "./verification.mjs";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const TOTAL = WALKTHROUGH_STEPS.length;

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

/** Where the element sits against the briefing card, in viewport pixels. */
async function clearance(page, selector) {
  return page.evaluate((sel) => {
    const target = document.querySelector(sel).getBoundingClientRect();
    const card = document.querySelector("#walkthrough-modal .modal-card").getBoundingClientRect();
    const header = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
    return { top: target.top, bottom: target.bottom, cardTop: card.top, header };
  }, selector);
}

test("step 3's lease button, drawn after the step, is scrolled clear of the briefing card at 375x812", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `late-target-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Late Target Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `late-target-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
  await page.waitForURL(/\/\?account=/);

  await page.getByRole("button", { name: "Brief me" }).click();
  const progress = page.locator("#walkthrough-progress");
  await expect(progress).toHaveText(`1 of ${TOTAL}`);
  await page.click('.tab-btn[data-tab="inbox"]');
  await expect(progress).toHaveText(`2 of ${TOTAL}`, { timeout: 10_000 });
  await page.click('.tab-btn[data-tab="station"]');
  await expect(progress).toHaveText(`3 of ${TOTAL}`, { timeout: 10_000 });

  await page.click('[data-building-action="building:orbital-executive-suites"]');
  const button = page.locator("#rent-office-btn");
  await expect(button).toHaveClass(/walkthrough-focus/, { timeout: 5_000 });
  // The scroll is smooth; give it time to settle before measuring.
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: path.join(SCREEN_DIR, "walkthrough-step3-lease-375x812.png") });

  const at = await clearance(page, "#rent-office-btn");
  expect(at.top, JSON.stringify(at)).toBeGreaterThanOrEqual(at.header);
  expect(at.bottom, JSON.stringify(at)).toBeLessThanOrEqual(at.cardTop);

  // Step 4's target is drawn by the same lease, and must be clear too (the bug report found it was).
  await page.selectOption("#rent-office-duration", "7");
  await button.click();
  await expect(progress).toHaveText(`4 of ${TOTAL}`, { timeout: 10_000 });
  await expect(page.locator("#office-hire-form")).toHaveClass(/walkthrough-focus/, { timeout: 5_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: path.join(SCREEN_DIR, "walkthrough-step4-hire-375x812.png") });
  const hire = await clearance(page, "#office-hire-form");
  expect(hire.bottom, JSON.stringify(hire)).toBeLessThanOrEqual(hire.cardTop);
});
