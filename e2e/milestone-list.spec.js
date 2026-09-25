// AB#1752: the milestone roadmap used to render into #milestone-list, an element no page had, so the sidebar
// never showed it. This registers a fresh corporation and looks at the sidebar directly.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/milestone-list.spec.js`.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

test("a fresh corporation sees its milestone roadmap in the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const stamp = Date.now();
  await page.goto("/register.html");
  await page.fill("#register-email", `ab1752-${stamp}@example.test`);
  await page.fill("#register-password", "password123!");
  await page.fill("#register-ceo", "AB1752 Test CEO");
  await page.fill("#register-corp", `AB1752 Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');

  await page.waitForSelector("#milestone-list");
  const items = page.locator("#milestone-list .milestone-item");
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  // The first two milestones (rent an office, hire 5) are not done yet for a fresh corporation.
  await expect(items.nth(0).locator(".milestone-state")).toHaveText("Open");

  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, "milestone-list-sidebar.png") });
});
