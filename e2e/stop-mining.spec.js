// AB#1052 (v0.5): the Stop Cycle control on a running extractor, played through a real browser — a scripted
// first hour up through starting a cycle (mirroring e2e/first-hour.spec.js's own sequence, AB#747), then the new
// step: stop it early, confirm, and see it settle. Assertions are on what the player sees, never on account
// state read some other way (T-030: a unit test already owns the state, tests/integration/mining-cycle-stop.test.js).
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/stop-mining.spec.js`.

import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";
import { acknowledgeReceipt } from "./receipt.mjs"; // AB#743

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

/** Same technique as first-hour.spec.js: grow the viewport to the page's own height so one capture needs no
 *  stitching, and a sticky header does not repeat down the image (P-TOOLS). */
async function shoot(page, viewportLabel, stepId, width) {
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, `${stepId}-${viewportLabel}.png`) });
  await page.setViewportSize({ width, height: VIEWPORTS.find((v) => v.width === width).height });
}

async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.scrollWidth, "document.scrollingElement.scrollWidth <= innerWidth").toBeLessThanOrEqual(overflow.innerWidth);
}

async function expectFeedback(page, pattern) {
  await expect(page.locator("#feedback-log li").first()).toContainText(pattern, { timeout: 10_000 });
}

function uniqueAccount() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `playtest-stop-${stamp}@example.test`,
    password: "playtest-password-not-real",
    ceoName: "Playtest CEO",
    corpName: `Playtest Corp ${stamp}`
  };
}

for (const viewport of VIEWPORTS) {
  test(`stop a running mining cycle at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const account = uniqueAccount();
    const mobile = viewport.width < 600;

    // ── Register, decline the guided briefing (same as first-hour.spec.js) ──
    await page.goto("/register.html");
    await page.fill("#register-email", account.email);
    await page.fill("#register-password", account.password);
    await page.fill("#register-ceo", account.ceoName);
    await page.fill("#register-corp", account.corpName);
    await page.click('#register-form button[type="submit"]');
    await verifyAndLogIn(page, "", account.email, account.password); // AB#2288: verify, then log in
    await page.waitForURL(/\/\?account=/);
    await page.getByRole("button", { name: "I'll find my own way" }).click();
    await expect(page.locator("#dialogue-modal")).toBeHidden();

    // ── office, hire, lease, yard ────────────────────────────────────────────
    await openTab(page, "station");
    await page.click('[data-building-action="building:orbital-executive-suites"]');
    await expect(page.locator("#rent-office-duration")).toBeVisible();
    await page.selectOption("#rent-office-duration", "7");
    await page.click("#rent-office-btn");
    await acknowledgeReceipt(page);
    await expect(page.getByText("Active Lease")).toBeVisible();
    await page.fill("#office-hire-count", "5");
    await page.click('#office-hire-form button[type="submit"]');
    await acknowledgeReceipt(page);
    await expectFeedback(page, /hire|staff|personnel/i);
    await page.click('#station-back-btn');
    await page.click('[data-building-action="building:isa-claims-leases"]');
    await page.click('.purchase-lease-btn[data-body="Earth"]');
    await acknowledgeReceipt(page);
    await expect(page.locator(".lease-manage-btn").first()).toBeVisible();
    await page.click(".lease-manage-btn");
    await page.click("#lease-build-extractor-btn");
    await acknowledgeReceipt(page);
    await expect(page.locator(".extractor-row")).toBeVisible();

    // ── start a cycle, wait for real accrual (same live-data wait as AB#747) ─
    const mineForm = page.locator(".lease-mine-form");
    await mineForm.locator('[name="amount"]').fill("250");
    await mineForm.locator('[name="hours"]').fill("24");
    await mineForm.locator('button[type="submit"]').click();
    await acknowledgeReceipt(page);
    await expect(page.locator(".extractor-row .building-status-badge")).toHaveText("Active");
    await expect(page.locator('.extractor-row [data-live="mined"]')).not.toHaveText(/^0( t)?$/, { timeout: 60_000 }); // AB#746: "0 t"
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "01-running", viewport.width);

    // ── stop it early: click, confirm, watch it settle ──────────────────────
    await page.click(".lease-stop-btn");
    await expect(page.locator("#trade-confirm-modal")).toBeVisible();
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "02-confirm", viewport.width);

    await page.click("#trade-confirm-ok");
    await expectFeedback(page, /stopped/i);
    await expect(page.locator(".extractor-row .building-status-badge")).toHaveText("Idle");
    await expect(page.locator(".lease-stop-btn")).toHaveCount(0);
    await expect(page.locator(".lease-mine-form")).toBeVisible();
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "03-stopped", viewport.width);
  });
}
