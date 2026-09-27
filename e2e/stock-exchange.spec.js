// ISP-161 (AB#855): the Intergalactic Stock Exchange, in a real browser at 1440x900 and 390x844. The data comes from
// e2e/seed-stock-exchange.mjs (the server's own equity code): three offerings open, Helios Freight holding shares in two
// issuers (one up, one down) with two weeks of dividends, and Aurora Dynamics' cap table with two investors and the
// market maker. Helios sees the offerings and its portfolio, buys and sells; Aurora sees its cap table and payout
// ratio. Starts its own server on the seeded data directory. Screenshots go to e2e/screenshots/ab-855/ (gitignored;
// the ones the pull request shows are copied to docs/ab-855/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-855");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "stock-exchange-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1440, 900], [390, 844]];

let server, url, logins;
// Each size gets its own freshly seeded server, so the second size starts from the same book the first did.
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-stock-exchange-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-stock-exchange.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-stock-exchange.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
  server = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
}

async function openExchange(page, who, [width, height]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", logins[who]);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  const stationTab = page.locator('.nav-tab[data-tab="station"]');
  if (!(await stationTab.isVisible())) await page.click('.nav-group__button[data-group="station"]');
  if (await stationTab.isVisible()) await stationTab.click();
  await page.locator(".station__card", { hasText: "Intergalactic Stock Exchange" }).getByRole("button", { name: "Enter" }).click();
  await expect(page.locator('[data-role="igsx"] .igsx-offering').first()).toBeVisible({ timeout: 15_000 });
}
const desk = (page, name) => page.locator('[data-role="igsx-mode"]', { hasText: name }).click();

/** Scroll the Exchange's panel to just under the sticky header, where a player would read it. */
const showPanel = (page) => page.evaluate(() => {
  const section = document.querySelector('[data-role="igsx"] section');
  const header = document.querySelector(".app-header");
  window.scrollTo(0, window.scrollY + section.getBoundingClientRect().top - (header ? header.getBoundingClientRect().height : 0) - 12);
});
/** At 390, the Exchange's own text under 14px (the phone rule the rebuilt screens are held to), as a list. */
const tinyText = (page) => page.evaluate(() => {
  const out = [];
  const root = document.querySelector('[data-role="igsx"]');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el.getClientRects().length || el.closest("option")) continue;
    const f = parseFloat(getComputedStyle(el).fontSize);
    if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
  }
  return [...new Set(out)];
});
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const checkPhone = async (page, width) => {
  expect(await sideways(page), "sideways scroll").toBe(0);
  if (width === 390) expect(await tinyText(page), "text under 14px at 390").toEqual([]);
};

for (const size of SIZES) {
  const [width, height] = size;
  test.describe(`${width}x${height}`, () => {
  test.beforeAll(start);
  test.afterAll(() => server?.kill());
  test(`offerings and the portfolio at ${width}x${height}`, async ({ page }) => {
    await openExchange(page, "helios", size);
    const offerings = page.locator('[data-role="igsx"] .igsx-offering');
    await expect(offerings).toHaveCount(3);
    const aurora = offerings.filter({ hasText: "Aurora Dynamics" });
    await expect(aurora).toContainText("132 credits"); // 1,320,000 / 10,000
    await expect(aurora).toContainText("1,320,000 ÷ 10,000 = 132");
    await expect(aurora.locator(".bond-grade")).toHaveText(/^(AAA|AA|A|BBB)$/);
    await expect(aurora).toContainText("Net income, last 30 days");
    await expect(aurora).toContainText("25% of net income");
    await expect(aurora).toContainText("500 of 1,500"); // 1,000 sold to Helios and Kestrel
    await showPanel(page);
    await page.screenshot({ path: path.join(SHOT_DIR, `offerings-${width}x${height}.png`), animations: "disabled" });
    await checkPhone(page, width);

    // buying shows the price and the cost before anything moves
    await aurora.locator('input[name="quantity"]').fill("10");
    await aurora.getByRole("button", { name: "Buy shares" }).click();
    await expect(page.locator("#trade-confirm-title")).toHaveText(/Buy 10 shares of Aurora Dynamics/);
    await expect(page.locator("#trade-confirm-body")).toContainText("1,320 credits");
    await page.screenshot({ path: path.join(SHOT_DIR, `buy-confirm-${width}x${height}.png`), animations: "disabled" });
    await page.locator("#trade-confirm-ok").click();
    await expect(page.locator("#action-receipt-modal")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    await desk(page, "Portfolio");
    const holdings = page.locator('[data-role="igsx"] .igsx-holding');
    await expect(holdings).toHaveCount(2);
    const up = holdings.filter({ hasText: "Aurora Dynamics" }), down = holdings.filter({ hasText: "Nadir Mining" });
    await expect(up).toContainText("610 shares");
    await expect(up).toContainText("139 a share"); // yesterday's 1,540,000 over the 11,010 shares now out
    await expect(up.locator(".igsx-gain")).toBeVisible();
    await expect(down.locator(".igsx-loss")).toBeVisible();
    await expect(page.locator('[data-role="igsx-total"]')).toContainText("Dividends received");
    await showPanel(page);
    await page.screenshot({ path: path.join(SHOT_DIR, `portfolio-${width}x${height}.png`), animations: "disabled" });
    await page.locator('[data-role="igsx"] section').screenshot({ path: path.join(SHOT_DIR, `portfolio-panel-${width}x${height}.png`), animations: "disabled" }); // the whole panel
    await checkPhone(page, width);

    // the exit to the market maker, at the server's price
    await down.locator('input[name="quantity"]').fill("5");
    await down.getByRole("button", { name: "Sell to the market maker" }).click();
    await expect(page.locator("#trade-confirm-title")).toHaveText(/Sell 5 shares of Nadir Mining/);
    await expect(page.locator("#trade-confirm-body")).toContainText("less 5%");
    await page.screenshot({ path: path.join(SHOT_DIR, `exit-confirm-${width}x${height}.png`), animations: "disabled" });
    await page.locator("#trade-confirm-ok").click();
    await expect(page.locator("#action-receipt-modal")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(holdings.filter({ hasText: "Nadir Mining" })).toContainText("495 shares", { timeout: 10_000 });
  });

  test(`the issuer's cap table and payout ratio at ${width}x${height}`, async ({ page }) => {
    await openExchange(page, "aurora", size);
    await expect(page.locator('[data-role="igsx"] .igsx-offering').filter({ hasText: "Aurora Dynamics" })).toContainText("Your own offering");
    await desk(page, "Your shares");
    const table = page.locator('[data-role="igsx-cap-table"]');
    await expect(table).toBeVisible({ timeout: 10_000 });
    await expect(table).toContainText("Helios Freight");
    await expect(table).toContainText("Kestrel Capital");
    await expect(table).toContainText("Intergalactic Stock Exchange"); // the market maker, from Kestrel's sale
    await expect(table.locator("tbody tr")).toHaveCount(4);
    await expect(page.locator('[data-role="igsx-payout-now"]')).toHaveText("25%");
    await expect(page.locator('[data-role="igsx-payout"]')).toContainText("0–80%, in steps of 5");
    await showPanel(page);
    await page.screenshot({ path: path.join(SHOT_DIR, `issuer-${width}x${height}.png`), animations: "disabled" });
    await page.locator('[data-role="igsx"] section').screenshot({ path: path.join(SHOT_DIR, `issuer-panel-${width}x${height}.png`), animations: "disabled" }); // the whole panel
    await checkPhone(page, width);
  });
  });
}
