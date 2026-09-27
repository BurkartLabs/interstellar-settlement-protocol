// ISP-148 (AB#842): the Finance tab's credit rating card, for a rated corporation and an NR one, at 1440x900 and
// 390x844, from the running app. Two corporations register through the page; each is then given closed daily
// statements the way the server keeps them (a file per account under ISP_DATA_DIR/statements/, as fileStatements
// writes it): 30 days for the rated one, 3 for the NR one. The server's own snapshot tick then rates them and pushes
// the card; nothing is drawn by this script.
//
// Usage, with a server already running (ISP_DEV=1, a scratch ISP_DATA_DIR, ISP_RATE_LIMIT_REGISTER_MAX raised):
//   node scripts/look-rating-card.mjs <baseUrl> <ISP_DATA_DIR> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { verifyAndLogIn } from "../e2e/verification.mjs";

const [base, dataDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const DAY = 86_400_000;
const browser = await chromium.launch();

/** Register a corporation in a fresh page and return the page and its account id. */
async function corporation(name) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `rating-${stamp}@example.test`, password = "look only throwaway password";
  await page.goto(`${base}/register.html`);
  await page.fill("#register-email", email);
  await page.fill("#register-password", password);
  await page.fill("#register-ceo", "Look Ceo");
  await page.fill("#register-corp", `${name} ${stamp.slice(-4)}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, base, email, password);
  await page.waitForURL(/\/\?account=/);
  const accountId = new URL(page.url()).searchParams.get("account"); // read now: the app rewrites the URL after
  if (!accountId) throw new Error(`no account id in ${page.url()}`);
  await page.getByRole("button", { name: "I'll find my own way" }).click({ timeout: 15_000 });
  await page.locator("#dialogue-modal").waitFor({ state: "hidden" });
  return { page, accountId };
}

/** Closed daily statements before today, written where the server files them. */
function writeStatements(accountId, n) {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const list = Array.from({ length: n }, (_, i) => ({
    day: new Date(today - (n - i) * DAY).toISOString().slice(0, 10), dayStart: today - (n - i) * DAY,
    pnl: { income: { exchange: 30_000 }, expenses: { payroll: 26_500 }, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
    cashFlow: { opening: 146_500, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
    balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
  }));
  const dir = path.join(dataDir, "statements");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${encodeURIComponent(accountId)}.json`), JSON.stringify(list));
}

const ratedCorp = await corporation("Rated Holdings");
const nrCorp = await corporation("Newco");
writeStatements(ratedCorp.accountId, 30);
writeStatements(nrCorp.accountId, 3);

for (const [label, c, expectText] of [["rated", ratedCorp, "/ 1,000"], ["nr", nrCorp, "more days of history needed"]]) {
  await openTab(c.page, "finance");
  // the snapshot tick runs every 30 seconds; the card updates when it pushes the new rating
  await c.page.locator("#finance-rating").getByText(expectText).waitFor({ timeout: 75_000 });
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await c.page.setViewportSize({ width: w, height: h });
    await c.page.waitForTimeout(300);
    const card = c.page.locator("#finance-rating");
    await card.scrollIntoViewIfNeeded();
    const text = (await card.innerText()).replace(/\s+/g, " ").trim();
    const wide = await c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${label} ${w}x${h}: "${text}"; sideways scroll ${wide}px`);
    await c.page.screenshot({ path: path.join(outDir, `ab842-rating-${label}-${w}x${h}.png`) });
  }
}

await browser.close();
