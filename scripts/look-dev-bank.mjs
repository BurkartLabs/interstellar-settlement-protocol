// ISP-151 (AB#845): the Deep Space Development Bank's view with one active loan and one quote open, at 1440x900 and
// 390x844, from the running app. A corporation registers through the page and is given 30 closed daily statements the
// way the server keeps them (a file per account under ISP_DATA_DIR/statements/), so the Bank will lend to it. Then the
// script plays it as a player would: open the Bank, ask for a quote, accept it through the confirmation, read the
// receipt, and ask for a second quote, which is left open. Nothing is drawn by this script.
//
// Usage, with a server already running (ISP_DEV=1, a scratch ISP_DATA_DIR, ISP_RATE_LIMIT_REGISTER_MAX raised):
//   node scripts/look-dev-bank.mjs <baseUrl> <ISP_DATA_DIR> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { verifyAndLogIn } from "../e2e/verification.mjs";

const [base, dataDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const DAY = 86_400_000;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = (name) => page.screenshot({ path: path.join(outDir, `ab845-${name}.png`) });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const email = `bank-${stamp}@example.test`, password = "look only throwaway password";
await page.goto(`${base}/register.html`);
await page.fill("#register-email", email);
await page.fill("#register-password", password);
await page.fill("#register-ceo", "Look Ceo");
await page.fill("#register-corp", `Borrower ${stamp.slice(-4)}`);
await page.click('#register-form button[type="submit"]');
await verifyAndLogIn(page, base, email, password);
await page.waitForURL(/\/\?account=/);
const accountId = new URL(page.url()).searchParams.get("account"); // read now: the app rewrites the URL after
if (!accountId) throw new Error(`no account id in ${page.url()}`);
await page.getByRole("button", { name: "I'll find my own way" }).click({ timeout: 15_000 });
await page.locator("#dialogue-modal").waitFor({ state: "hidden" });

const today = Math.floor(Date.now() / DAY) * DAY;
const statements = Array.from({ length: 30 }, (_, i) => ({
  day: new Date(today - (30 - i) * DAY).toISOString().slice(0, 10), dayStart: today - (30 - i) * DAY,
  pnl: { income: { exchange: 30_000 }, expenses: { payroll: 26_500 }, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
  cashFlow: { opening: 146_500, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
  balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
}));
fs.mkdirSync(path.join(dataDir, "statements"), { recursive: true });
fs.writeFileSync(path.join(dataDir, "statements", `${encodeURIComponent(accountId)}.json`), JSON.stringify(statements));

// the Station tab, then the Bank's card
await openTab(page, "station");
await page.locator('[data-building-action="building:deep-space-development-bank"]').click();
const view = page.locator("#station-building-content");
await view.locator('[data-role="bank-quote-form"]').waitFor({ timeout: 15_000 });
await shot("offers-1440x900");

async function quote(productLabel, principal) {
  await view.locator('[data-role="bank-product"]').selectOption({ label: productLabel });
  await view.locator('[data-role="bank-principal"]').fill(String(principal));
  await view.getByRole("button", { name: "Request a quote" }).click();
  await view.locator('[data-role="bank-quote"]').waitFor();
}

// borrow 63,000 for 30 days: quote, confirm, receipt
await quote(await view.locator('[data-role="bank-product"] option', { hasText: "30-day" }).innerText(), 63_000);
await view.locator('[data-role="bank-accept"]').click();
await page.locator("#trade-confirm-modal").waitFor({ state: "visible" });
await shot("confirm-1440x900");
await page.click("#trade-confirm-ok");
await page.locator("#action-receipt-modal").waitFor({ state: "visible" });
console.log("receipt:", (await page.locator("#action-receipt-modal").innerText()).replace(/\s+/g, " ").trim());
await shot("receipt-1440x900");
await page.keyboard.press("Escape");
await page.locator("#action-receipt-modal").waitFor({ state: "hidden" });

// a second quote, left open, beside the active loan
await view.locator('[data-role="bank-loans"] [data-role="bank-payoff"]').waitFor();
await quote(await view.locator('[data-role="bank-product"] option', { hasText: "90-day" }).innerText(), 120_000);

for (const [w, h] of [[1440, 900], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(300);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${w}x${h}: sideways scroll ${wide}px`);
  // the Bank's panels just under the sticky header; on a phone the whole page, since the quote and the loan are taller
  // than one screen
  await page.evaluate(() => {
    const top = document.querySelector(".bank-panel").getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - document.querySelector(".app-header").getBoundingClientRect().height - 16);
  });
  await page.waitForTimeout(200);
  await shot(`quote-and-loan-${w}x${h}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  // both of the Bank's panels, whole, cut from the full page
  const clip = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".bank-panel")].map((el) => el.getBoundingClientRect());
    const top = Math.min(...boxes.map((b) => b.top)) + window.scrollY - 8, bottom = Math.max(...boxes.map((b) => b.bottom)) + window.scrollY + 8;
    const left = Math.min(...boxes.map((b) => b.left)) - 8, right = Math.max(...boxes.map((b) => b.right)) + 8;
    return { x: Math.max(0, left), y: top, width: right - Math.max(0, left), height: bottom - top };
  });
  await page.screenshot({ path: path.join(outDir, `ab845-panels-${w}x${h}.png`), fullPage: true, clip });
}
console.log("quote:", (await view.locator('[data-role="bank-quote"]').innerText()).replace(/\s+/g, " ").trim());
console.log("loans:", (await view.locator('[data-role="bank-loans"]').innerText()).replace(/\s+/g, " ").trim());
await browser.close();
