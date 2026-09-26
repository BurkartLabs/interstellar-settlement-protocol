// AB#1284: a disabled button must look disabled. A new corporation has no employees, so every lease at ISA Claims &
// Leases is disabled (AB#1202 needs 5), and the walkthrough's Previous is disabled on step 1: one .btn inside the
// page and one inside a modal. Each is measured against an enabled button beside it, and every enabled button on the
// screen is checked to be unchanged. Screenshots are taken before the checks, so a failing run still shows the page.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/disabled-buttons.spec.js`.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";
import { acknowledgeReceipt } from "./receipt.mjs"; // AB#743

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

const look = (locator) => locator.evaluate((el) => {
  const s = getComputedStyle(el);
  return { disabled: el.disabled, opacity: s.opacity, cursor: s.cursor, boxShadow: s.boxShadow };
});

/** Every visible, enabled button on the page, with its opacity: none of them may be dimmed. */
const enabledButtons = (page) => page.evaluate(() => [...document.querySelectorAll("button")]
  .filter((b) => !b.disabled && b.offsetParent !== null)
  .map((b) => ({ text: b.textContent.trim().slice(0, 30), opacity: getComputedStyle(b).opacity })));

test("a disabled button is dimmed, shows not-allowed and loses its hover glow; enabled ones are unchanged", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `disabled-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Disabled Look Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `disabled-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
  await page.waitForURL(/\/\?account=/);

  // The walkthrough's first step: Previous is disabled, Next is not.
  await page.getByRole("button", { name: "Brief me" }).click();
  const prev = page.locator("#walkthrough-prev");
  await expect(prev).toBeVisible();
  await page.screenshot({ path: path.join(SCREEN_DIR, "disabled-walkthrough-prev-1280x800.png") });
  const prevLook = await look(prev);
  expect.soft(prevLook.disabled).toBe(true);
  expect.soft(Number(prevLook.opacity)).toBeLessThanOrEqual(0.5);
  expect.soft(prevLook.cursor).toBe("not-allowed");
  expect(Number((await look(page.locator("#walkthrough-next"))).opacity)).toBe(1);
  await page.click("#walkthrough-end");
  await expect(page.locator("#walkthrough-modal")).toBeHidden();

  // ISA Claims & Leases with an office and no employees: every lease button is disabled.
  await page.click('.tab-btn[data-tab="station"]');
  await page.click('[data-building-action="building:orbital-executive-suites"]');
  await page.selectOption("#rent-office-duration", "7");
  await page.click("#rent-office-btn");
  await acknowledgeReceipt(page);
  await expect(page.getByText("Active Lease")).toBeVisible();
  await page.click("#station-back-btn");
  await page.click('[data-building-action="building:isa-claims-leases"]');
  const lease = page.locator('.purchase-lease-btn[data-body="Earth"]');
  await expect(lease).toBeVisible();
  await lease.scrollIntoViewIfNeeded();
  await lease.hover();
  await page.screenshot({ path: path.join(SCREEN_DIR, "disabled-lease-hover-1280x800.png") });
  const leaseLook = await look(lease);
  expect.soft(leaseLook.disabled).toBe(true);
  expect.soft(Number(leaseLook.opacity)).toBeLessThanOrEqual(0.5);
  expect.soft(leaseLook.cursor).toBe("not-allowed");
  expect.soft(leaseLook.boxShadow).toBe("none"); // hovered, and still no glow

  const enabled = await enabledButtons(page);
  expect(enabled.length).toBeGreaterThan(5);
  expect.soft(enabled.filter((b) => b.opacity !== "1")).toEqual([]);

  // What the player does next: hire the five, come back, and the same button is enabled and drawn at full strength.
  await page.click("#station-back-btn");
  await page.click('[data-building-action="building:orbital-executive-suites"]');
  await page.fill("#office-hire-count", "5");
  await page.click('#office-hire-form button[type="submit"]');
  await acknowledgeReceipt(page);
  await expect(page.locator("#office-hire-hint")).toContainText("5 / ");
  await page.click("#station-back-btn");
  await page.click('[data-building-action="building:isa-claims-leases"]');
  await expect(lease).toBeEnabled();
  await lease.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SCREEN_DIR, "enabled-lease-1280x800.png") });
  const ready = await look(lease);
  expect(ready.opacity).toBe("1");
  expect(ready.cursor).toBe("pointer");
});
