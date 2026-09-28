// AB#2058: a cleared Head Count box hired one employee - the client read it as Math.max(1, Number(x || 1)), the clamp
// AB#1164 removed from the Exchange. Now the box is required, so the browser stops a blank before it is sent; and when
// the form is submitted without the browser's check, the page sends what was typed and shows the server's refusal
// (gameplayInput.js, AB#731) next to the form. Either way nobody is hired and nothing is spent.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/hire-blank-count.spec.js`.

import { test, expect } from "@playwright/test";
import { openTab, openStationOffices } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

async function withOffice(page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `hire-blank-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Hire Blank ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `hire-blank-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await openTab(page, "station");
  await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
  await page.click('[data-building-action="building:orbital-executive-suites"]');
  await page.selectOption("#rent-office-duration", "7");
  await page.click("#rent-office-btn");
  await expect(page.locator("#action-receipt-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#office-hire-form")).toBeVisible();
}

const staffing = (page) => page.locator("#office-hire-hint").innerText();

for (const vp of VIEWPORTS) {
  test(`a cleared Head Count hires nobody at ${vp.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await withOffice(page);
    const hires = [];
    page.on("request", (r) => { if (r.url().includes("/gameplay/hire")) hires.push(r.postData()); });
    const before = await staffing(page);
    expect(before).toContain("Staffing: 0 /");

    // Pressing Hire with the box cleared: the browser's own check stops it, and no hire is sent.
    await page.fill("#office-hire-count", "");
    await page.click('#office-hire-form button[type="submit"]');
    await page.waitForTimeout(500);
    expect(hires, "no hire request for a cleared box").toEqual([]);
    expect(await page.locator("#office-hire-count").evaluate((el) => el.validity.valueMissing)).toBe(true);
    await expect(page.locator("#action-receipt-modal")).toBeHidden();

    // The form submitted without the browser's check: the page sends the blank as typed, not 1, and says why it failed.
    await page.locator("#office-hire-form").evaluate((form) => form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })));
    await expect(page.locator("#office-hire-status")).toHaveText(/^Enter the number of employees to hire/);
    expect(hires.map((b) => JSON.parse(b))).toEqual([{ count: "" }]);
    await expect(page.locator("#action-receipt-modal")).toBeHidden();
    expect(await staffing(page)).toBe(before);
    await page.locator("#office-hire-form").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREEN_DIR, `hire-blank-count-${vp.label}.png`) });
  });
}
