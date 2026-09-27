// ISP-156 (AB#850): the bond board with two open series, the issue form and a holdings list, at 1440x900 and 390x844,
// from the running app; and the board as a corporation that cannot issue sees it. The world is seeded before the
// server starts (e2e/seed-bond-board.mjs); the script signs in and plays the page. Nothing is drawn by this script.
//
// Usage, with a server running on the seeded ISP_DATA_DIR (ISP_DEV=1):
//   node scripts/look-bond-board.mjs <baseUrl> <accounts.json from the seed> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";

const [base, accountsFile, outDir] = process.argv.slice(2);
const accounts = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
const password = "look only throwaway password";
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

async function signIn(email) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  return page;
}

async function openBonds(page) {
  await openTab(page, "station");
  await page.locator('[data-building-action="building:deep-space-development-bank"]').click();
  await page.locator('[data-role="bank-mode"][data-mode="bonds"]').click();
  await page.locator('[data-role="bond-board"] h3').first().waitFor({ timeout: 15_000 });
}

/** Both views of the board at one size: the screen from the Bank's switch down, and every panel clipped from the page. */
async function shots(page, label, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${label} ${w}x${h}: sideways scroll ${wide}px`);
  await page.evaluate(() => {
    const top = document.querySelector(".bank-modes").getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - document.querySelector(".app-header").getBoundingClientRect().height - 16);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `ab850-${label}-${w}x${h}.png`) });
  await page.evaluate(() => window.scrollTo(0, 0));
  const clip = await page.evaluate(() => {
    const boxes = [document.querySelector(".bank-modes"), ...document.querySelectorAll('[data-role="bond-board"] .bank-panel')].map((el) => el.getBoundingClientRect());
    const top = Math.min(...boxes.map((b) => b.top)) + window.scrollY - 8, bottom = Math.max(...boxes.map((b) => b.bottom)) + window.scrollY + 8;
    const left = Math.max(0, Math.min(...boxes.map((b) => b.left)) - 8), right = Math.max(...boxes.map((b) => b.right)) + 8;
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
  await page.screenshot({ path: path.join(outDir, `ab850-${label}-panels-${w}x${h}.png`), fullPage: true, clip });
}

// the eligible viewer: two open series, the issue form with its preview, and its holdings
const viewer = await signIn(accounts.viewer);
await openBonds(viewer);
await viewer.locator('[data-role="bond-preview"] dd[data-term="coupons"]').waitFor({ timeout: 15_000 });
const board = viewer.locator('[data-role="bond-board"]');
console.log("open series:", await board.locator(".bond-series").count(), "holdings:", await board.locator(".bond-holdings .bond-holding").count());
console.log("issue form:", (await board.locator('[data-role="bond-issue"]').innerText()).replace(/\s+/g, " ").trim());
// a player changes the coupon: the preview follows
await board.locator('#bond-coupon').fill("7");
await viewer.waitForTimeout(1_200);
console.log("preview at 7%:", (await board.locator('[data-role="bond-preview"]').innerText()).replace(/\s+/g, " ").trim());
console.log("holdings:", (await board.locator(".bond-holdings").first().innerText()).replace(/\s+/g, " ").trim());
for (const [w, h] of [[1440, 900], [390, 844]]) await shots(viewer, "board", w, h);

// the viewer subscribes to the other open series through the confirmation and reads the receipt
await viewer.setViewportSize({ width: 1440, height: 900 });
const kestrel = board.locator(".bond-series", { hasText: "Kestrel" });
await kestrel.locator('input[name="units"]').fill("12");
await kestrel.getByRole("button", { name: "Subscribe" }).click();
await viewer.locator("#trade-confirm-modal").waitFor({ state: "visible" });
await viewer.screenshot({ path: path.join(outDir, "ab850-subscribe-confirm-1440x900.png") });
await viewer.click("#trade-confirm-ok");
await viewer.locator("#action-receipt-modal").waitFor({ state: "visible" });
console.log("receipt:", (await viewer.locator("#action-receipt-modal").innerText()).replace(/\s+/g, " ").trim());
await viewer.screenshot({ path: path.join(outDir, "ab850-subscribe-receipt-1440x900.png") });
await viewer.keyboard.press("Escape");

// a corporation that cannot issue sees why
const newco = await signIn(accounts.newco);
await openBonds(newco);
await newco.locator('[data-role="bond-ineligible"]').waitFor();
console.log("ineligible:", (await newco.locator('[data-role="bond-ineligible"]').innerText()).replace(/\s+/g, " ").trim());
await newco.locator('[data-role="bond-ineligible"]').scrollIntoViewIfNeeded();
await newco.screenshot({ path: path.join(outDir, "ab850-ineligible-1440x900.png") });

await browser.close();
