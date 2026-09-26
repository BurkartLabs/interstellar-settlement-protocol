// AB#2046: at desktop width the Logistics summary's Transfer fee tile read "$2 / unit in system, +…" - its value is a
// sentence, and every summary value was one clipped line with an ellipsis. It now wraps, so the per-jump fee shows.
// Every summary value is checked, not only the fee, so a long station name that clips is caught the same way.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/logistics-summary-fit.spec.js`.

import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

for (const vp of [{ label: "1280x800", width: 1280, height: 800 }, { label: "375x812", width: 375, height: 812 }]) {
  test(`every Logistics summary value is shown whole at ${vp.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await page.goto("/register.html");
    await page.fill("#register-email", `logistics-fit-${stamp}@example.test`);
    await page.fill("#register-password", "playtest-password-not-real");
    await page.fill("#register-ceo", "Playtest CEO");
    await page.fill("#register-corp", `Fit Corp ${stamp}`);
    await page.click('#register-form button[type="submit"]');
    await verifyAndLogIn(page, "", `logistics-fit-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
    await page.waitForURL(/\/\?account=/);
    await page.getByRole("button", { name: "I'll find my own way" }).click();
    await openTab(page, "logistics");
    const values = page.locator(".logistics-summary-value");
    await expect(values).toHaveCount(4);

    const fee = page.locator(".logistics-summary-tile", { hasText: "Transfer fee" }).locator(".logistics-summary-value");
    await expect(fee).toContainText("a jump");
    const clipped = await values.evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `${el.textContent} (${el.scrollWidth} > ${el.clientWidth})`)
    );
    expect(clipped, "summary values cut off").toEqual([]);
    await page.locator(".logistics-summary").scrollIntoViewIfNeeded();
    await page.locator(".logistics-summary").screenshot({ path: path.join(SCREEN_DIR, `logistics-summary-${vp.label}.png`) });
  });
}
