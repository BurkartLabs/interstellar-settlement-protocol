// ISP-255 slice b (AB#4824): the Credit group in protocol language, in the running game at 1280x800. Two worlds, each
// seeded with the server's own loan and bond code (e2e/seed-loan-board.mjs, e2e/seed-bond-board.mjs):
//   - the Loan Board: the lender's loans (Unsuccessful in default, a recovery Filed, awaiting review), the borrower's
//     warning before its assets are sold, its notice, and an offer larger than the lender's credits (Unfunded);
//   - the Bank: a quote above the facility's limit (Denied), and the Bond Board's badges (Lodged, In force) with a
//     subscription for more units than are left (Denied).
// Shots go to e2e/screenshots/ab-4824/.
import { test, expect } from "@playwright/test";
import { openStationOffices, openTab, toggleNotifications } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4824");
const PASSWORD = "playtest-password-not-real";
const SECRET = "credit-protocol-e2e-fixture-secret-0123456";

async function world(seed) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-credit-protocol-e2e-"));
  const seeded = spawnSync(process.execPath, [seed, dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`${seed} failed: ${seeded.stdout}\n${seeded.stderr}`);
  const logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
  return { logins, url, server };
}

/** Sign in as `email` and enter the Deep Space Development Bank from the Station tab. */
async function openBank(browser, w, email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${w.url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "station");
  await openStationOffices(page); // AB#2471: the Bank is on the Station's Offices subpage
  await page.locator(".station__card", { hasText: "Deep Space Development Bank" }).getByRole("button", { name: "Enter" }).click();
  return { page, errors, close: () => context.close() };
}
/** Scroll `locator`'s section to just under the sticky header, where a player would read it. */
const showUnderHeader = (locator) => locator.evaluate((el) => {
  const header = document.querySelector(".app-header");
  window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - (header ? header.getBoundingClientRect().height : 0) - 12);
});
const shot = (locator, name) => locator.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

test("the Loan Board: the lender's loans, the borrower's warning and notice, and an unfunded offer, at 1280", async ({ browser }) => {
  test.setTimeout(150_000);
  const w = await world("e2e/seed-loan-board.mjs");
  try {
    // 1. Helios, the lender: a loan in default is Unsuccessful, a recovery under way Filed, awaiting review
    const helios = await openBank(browser, w, w.logins.helios);
    const lent = helios.page.locator('[data-role="loans-lent"]');
    await expect(lent.locator(".protocol-line", { hasText: "Unsuccessful" }).first()).toBeVisible({ timeout: 15_000 });
    await expect(lent.locator(".protocol-line", { hasText: "Filed, awaiting review" })).toHaveCount(1);
    const lentSection = lent.locator("xpath=ancestor::section[1]");
    await showUnderHeader(lentSection);
    await shot(lentSection, "1-loans-lent");
    expect(helios.errors).toEqual([]);
    await helios.close();

    // 2. Tessera, in its grace period: the warning, then Filed, awaiting review; and its notice
    const tessera = await openBank(browser, w, w.logins.tessera);
    const warning = tessera.page.locator('[data-role="loan-warning"]');
    await expect(warning.locator(".protocol-line")).toContainText("Filed, awaiting review", { timeout: 15_000 });
    await showUnderHeader(warning);
    await shot(warning, "2-borrower-warning");
    await tessera.page.evaluate(() => window.scrollTo(0, 0));
    await toggleNotifications(tessera.page);
    const note = tessera.page.locator("#notification-list li", { hasText: "Your assets will be sold in 24 hours" });
    await expect(note.locator(".protocol-line")).toContainText("Filed, awaiting review");
    await tessera.page.locator("#notification-panel").screenshot({ path: path.join(SHOT_DIR, "3-notice-sale-scheduled.png") });
    expect(tessera.errors).toEqual([]);
    await tessera.close();

    // 3. Orbital, left with almost nothing after its recovery: an offer larger than its credits is Unfunded
    const orbital = await openBank(browser, w, w.logins.orbital);
    const form = orbital.page.locator('[data-role="loan-post-form"]');
    await form.locator('input[name="principal"]').fill("100000"); // the rules' most: more than Orbital kept after its recovery
    await form.getByRole("button", { name: "Post offer" }).click();
    const line = form.locator('[data-role="loan-post-status"]');
    await expect(line).toContainText(/Offer [\d,]+ or less\./);
    await expect(line.locator(".protocol-line")).toContainText("Unfunded, balance insufficient");
    await showUnderHeader(form);
    await shot(form, "4-offer-unfunded");
    expect(orbital.errors).toEqual([]);
    await orbital.close();
  } finally {
    w.server.kill();
  }
});

test("the Bank: a quote above the limit, and the Bond Board's badges and a subscription refused, at 1280", async ({ browser }) => {
  test.setTimeout(150_000);
  const w = await world("e2e/seed-bond-board.mjs");
  try {
    const { page, errors, close } = await openBank(browser, w, w.logins.viewer);
    // 5. a quote above the facility's limit: the Bank's words, then Denied
    const quote = page.locator('[data-role="bank-quote-form"]');
    await quote.locator('input[name="principal"]').fill("99000000");
    await quote.getByRole("button", { name: "Request a quote" }).click();
    const quoteLine = quote.locator('[data-role="bank-quote-status"]');
    await expect(quoteLine.locator(".protocol-line")).toContainText("Denied", { timeout: 15_000 });
    await showUnderHeader(quote);
    await shot(quote, "5-quote-denied");

    // 6. the Bond Board: Subscribing is Lodged, a held series Current In force; more units than are left, Denied
    await page.locator('[data-role="bank-mode"][data-mode="bonds"]').click();
    const board = page.locator('[data-role="bond-board"]');
    await expect(board.locator(".bond-badge").first()).toBeVisible({ timeout: 15_000 });
    await expect(board.locator(".protocol-line", { hasText: "In force" }).first()).toBeVisible();
    const sub = board.locator('[data-role="bond-subscribe"]').first();
    const left = Number(await sub.locator('input[name="units"]').getAttribute("max"));
    await sub.locator('input[name="units"]').fill(String(left + 1));
    await sub.getByRole("button", { name: "Subscribe" }).click();
    await expect(sub.locator('[data-role="bond-status"] .protocol-line')).toContainText("Denied");
    const series = sub.locator("xpath=ancestor::article[1]");
    await showUnderHeader(series);
    await shot(series, "6-bond-subscribe-denied");
    // 6b. Bug #4799: everything that is left is more than one holder may own (20% of a series): Denied, saying how many more
    await sub.locator('input[name="units"]').fill(String(left));
    await sub.getByRole("button", { name: "Subscribe" }).click();
    await page.getByRole("button", { name: /^Pay [\d,]+ credits$/ }).click(); // the trade confirmation: the server decides after it
    await expect(sub.locator('[data-role="bond-status"]')).toContainText("No holder may own more than 20% of a series");
    await expect(sub.locator('[data-role="bond-status"] .protocol-line')).toContainText("Denied");
    await showUnderHeader(series);
    await shot(series, "6b-bond-subscribe-holder-cap");
    const held = board.locator(".bond-holding").first();
    await showUnderHeader(held);
    await shot(held, "7-bond-holding-current");
    expect(errors).toEqual([]);
    await close();
  } finally {
    w.server.kill();
  }
});
