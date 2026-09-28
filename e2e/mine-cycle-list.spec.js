// AB#1806: renderMiningCyclePanel used to write into document.getElementById("mine-cycle-list"), guarded by
// if (!list) return - no page has ever had that element, so the whole Active Mining Cycles panel was silently
// never rendered, the same shape and root cause as AB#1752. This registers a fresh corporation, follows
// e2e/first-hour.spec.js's own path to a running extractor cycle, then looks at the Station overview.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/mine-cycle-list.spec.js`.

import { test, expect } from "@playwright/test";
import { openTab, openStationOffices, openMiningCycles } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";
import { acknowledgeReceipt } from "./receipt.mjs"; // AB#743

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

test("an idle extractor yard shows up in Active Mining Cycles before any cycle is started", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const stamp = Date.now();
  await page.goto("/register.html");
  await page.fill("#register-email", `ab1806-${stamp}@example.test`);
  await page.fill("#register-password", "password123!");
  await page.fill("#register-ceo", "AB1806 Test CEO");
  await page.fill("#register-corp", `AB1806 Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `ab1806-${stamp}@example.test`, "password123!"); // AB#2288: verify, then log in
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();

  await openTab(page, "station");
  await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
  await page.click('[data-building-action="building:orbital-executive-suites"]');
  await page.selectOption("#rent-office-duration", "7");
  await page.click("#rent-office-btn");
  await acknowledgeReceipt(page);
  await page.fill("#office-hire-count", "5");
  await page.click('#office-hire-form button[type="submit"]');
  await acknowledgeReceipt(page);
  await expect(page.locator("#office-hire-hint")).toContainText("5 / ");

  await page.click("#station-back-btn");
  await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
  await page.click('[data-building-action="building:isa-claims-leases"]');
  await page.click('[data-action="purchase-lease"][data-body="Earth"]');
  await acknowledgeReceipt(page);
  await page.click('[data-action="manage-lease"]');
  await page.click("#lease-build-extractor-btn");
  await acknowledgeReceipt(page);
  await expect(page.locator(".extractor")).toBeVisible();

  // AB#2471: Active Mining Cycles lives on Operations, on its Mining cycles subpage.
  await page.click("#station-back-btn");
  await openMiningCycles(page);
  await expect(page.locator("#mine-cycle-list")).toBeVisible();
  const items = page.locator("#mine-cycle-list .ui-card");
  await expect(items.first()).toBeVisible();
  await expect(items.first()).toContainText("Ready for next cycle");

  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, "mine-cycle-list-station.png") });
});
