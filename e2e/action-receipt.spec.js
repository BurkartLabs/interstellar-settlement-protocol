// AB#743 (ISP-57): the confirmation modal after a committing action, and the Level 1 milestone. A new corporation
// rents an office, hires four, then hires the fifth, which reaches Level 1. Each modal is closed a different way
// (Escape, its button, the backdrop), and focus must land back on the control the player was using.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/action-receipt.spec.js`.

import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "375x812", width: 375, height: 812, mobile: true }
];

const activeId = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.closest("form")?.id ? ` in #${el.closest("form").id}` : ""}` : "";
});

for (const vp of VIEWPORTS) {
  test.describe(`action receipts at ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });

    test("rent, hire four, hire the fifth: a receipt each, then the Level 1 milestone", async ({ page }) => {
      test.setTimeout(90_000);
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await page.goto("/register.html");
      await page.fill("#register-email", `receipt-${stamp}@example.test`);
      await page.fill("#register-password", "playtest-password-not-real");
      await page.fill("#register-ceo", "Playtest CEO");
      await page.fill("#register-corp", `Receipt Corp ${stamp}`);
      await page.click('#register-form button[type="submit"]');
      await verifyAndLogIn(page, "", `receipt-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
      await page.waitForURL(/\/\?account=/);
      await page.getByRole("button", { name: "I'll find my own way" }).click();

      const modal = page.locator("#action-receipt-modal");
      const card = modal.locator(".action-receipt-card");

      // Rent: the receipt; Escape closes it; the rent button is gone, so focus goes to where the flow continues.
      await openTab(page, "station");
      await page.click('[data-building-action="building:orbital-executive-suites"]');
      await page.selectOption("#rent-office-duration", "7");
      await page.click("#rent-office-btn");
      await expect(modal).toBeVisible();
      await expect(page.locator("#action-receipt-title")).toHaveText("Office Lease Confirmed");
      await expect(card).toContainText("Charged");
      await expect(card).toContainText("Next");
      await expect(page.locator("#action-receipt-close")).toBeFocused();
      await page.screenshot({ path: path.join(SCREEN_DIR, `receipt-rent-${vp.label}.png`) });
      await page.keyboard.press("Escape");
      await expect(modal).toBeHidden();
      expect(await activeId(page)).toBe("input#office-hire-count in #office-hire-form");

      // Hire four: the receipt names the employees from the server's answer; the button closes it; focus returns.
      await page.fill("#office-hire-count", "4");
      await page.click('#office-hire-form button[type="submit"]');
      await expect(modal).toBeVisible();
      await expect(page.locator("#action-receipt-title")).toHaveText("Hiring Order Confirmed");
      await expect(card).toContainText("4 employees added to the payroll.");
      await expect(card).toContainText("4 / 8");
      await expect(card).not.toHaveClass(/milestone/);
      await page.screenshot({ path: path.join(SCREEN_DIR, `receipt-hire-${vp.label}.png`) });
      await page.click("#action-receipt-close");
      await expect(modal).toBeHidden();
      expect(await activeId(page)).toBe("button in #office-hire-form");

      // Hire the fifth: Level 1, every unlock milestones.json gives it, and the hiring order under it.
      await page.fill("#office-hire-count", "1");
      await page.click('#office-hire-form button[type="submit"]');
      await expect(modal).toBeVisible();
      await expect(card).toHaveClass(/action-receipt-card--milestone/);
      await expect(page.locator("#action-receipt-title")).toHaveText("Corporation Level 1");
      for (const t of ["reached Level 1 of", "Employee cap", "20", "Building slots", "Fleet cap", "8", "Market sectors opened", "Raw Materials", "Hiring Order Confirmed"]) {
        await expect(card).toContainText(t);
      }
      const text = await card.innerText();
      expect(text).not.toMatch(/!|congratulat/i);
      await page.screenshot({ path: path.join(SCREEN_DIR, `receipt-level1-${vp.label}.png`) });
      // The backdrop, not the card: a corner of the viewport.
      await page.mouse.click(4, vp.height - 4);
      await expect(modal).toBeHidden();
      expect(await activeId(page)).toBe("button in #office-hire-form");

      // It never blocks the next action: with a receipt still open, pressing Hire again closes it and hires, and the
      // next receipt is the new one (6, then 7).
      await page.fill("#office-hire-count", "1");
      await page.click('#office-hire-form button[type="submit"]');
      await expect(card).toContainText("6 / 20");
      await page.click('#office-hire-form button[type="submit"]');
      await expect(card).toContainText("7 / 20");
      await expect(modal).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(modal).toBeHidden();
    });
  });
}
