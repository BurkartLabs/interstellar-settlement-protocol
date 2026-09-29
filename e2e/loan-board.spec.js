// ISP-153 (AB#847): the loan board in the Deep Space Development Bank, in a real browser at 1440x900 and 390x844. The
// data comes from e2e/seed-loan-board.mjs (the server's own loan code): four open offers from three lenders, and Helios
// Freight holding a loan in arrears, one in default that was recovered, and one whose borrower is in its grace period.
// Helios sees the board and its lender view; Tessera Works sees the warning and the date before its assets are sold.
// Starts its own server on the seeded data directory. Screenshots go to e2e/screenshots/ab-847/ (gitignored; the ones
// the pull request shows are copied to docs/ab-847/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab, openStationOffices } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-847");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "loan-board-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1440, 900], [390, 844]];

let server, url, logins;
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-loan-board-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-loan-board.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-loan-board.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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
});
test.afterAll(() => server?.kill());

async function openBank(page, who, [width, height]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", logins[who]);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "station");
  await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
  // each of the station's buildings is a card with an Enter button
  await page.locator(".station__card", { hasText: "Deep Space Development Bank" }).getByRole("button", { name: "Enter" }).click();
  await expect(page.locator('[data-role="loan-board"] [data-offer-card]').first()).toBeVisible({ timeout: 15_000 });
}

/** Scroll the section holding `role` to just under the sticky header, where a player would read it. */
const showSection = (page, role) => page.evaluate((r) => {
  const section = document.querySelector(`[data-role="${r}"]`).closest("section");
  const header = document.querySelector(".app-header");
  window.scrollTo(0, window.scrollY + section.getBoundingClientRect().top - (header ? header.getBoundingClientRect().height : 0) - 12);
}, role);
/** At 390, the loan board's own text under 14px (the phone rule the rebuilt screens are held to), as a list. */
const tinyText = (page) => page.evaluate(() => {
  const out = [];
  for (const role of ["loan-board", "loan-post", "loans-lent", "loans-borrowed"]) {
    const root = document.querySelector(`[data-role="${role}"]`)?.closest("section");
    if (!root) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("option")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
  }
  return [...new Set(out)];
});
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const size of SIZES) {
  const [width, height] = size;
  test(`the loan board and the lender's view at ${width}x${height}`, async ({ page }) => {
    await openBank(page, "helios", size);
    const offers = page.locator('[data-role="loan-board"] [data-offer-card]');
    expect(await offers.count()).toBeGreaterThanOrEqual(3);
    const board = page.locator('[data-role="loan-board"]');
    await expect(board).toContainText("Kestrel Capital");
    await expect(board).toContainText("2.75% per 30 days");
    await expect(board).toContainText("Withdraw your offer"); // Helios's own
    await showSection(page, "loan-board");
    await page.screenshot({ path: path.join(SHOT_DIR, `board-${width}x${height}.png`) });

    // sorting by rate, highest first, and the grade filter
    await page.selectOption('[data-role="loan-board-sort"]', "rate-desc");
    await expect(offers.first()).toContainText("6.5% per 30 days");
    await page.check('[data-role="loan-board-only"]');
    await expect(page.locator('[data-role="loan-board"]')).toContainText(/No offers match your grade|Borrow|Withdraw/);
    await page.uncheck('[data-role="loan-board-only"]');

    const lent = page.locator('[data-role="loans-lent"]');
    await expect(lent.locator("[data-player-loan]")).toHaveCount(3);
    await expect(lent).toContainText("Nadir Mining");
    await expect(lent.locator('[data-role="loan-state"]', { hasText: "In arrears" })).toHaveCount(1);
    await expect(lent.locator('[data-role="borrower-grade"]').first()).toBeVisible();
    await expect(lent).toContainText("credits recovered");
    await expect(lent).toContainText("from force-sold assets (Refinery for 30,000");
    await expect(lent).toContainText("from credits"); // Orbital's 2,000 were taken first
    await showSection(page, "loans-lent");
    await page.screenshot({ path: path.join(SHOT_DIR, `lender-${width}x${height}.png`) });

    // posting shows the escrow that will be held before anything is
    await page.evaluate(() => document.querySelector('[data-role="loan-post-form"]').scrollIntoView({ block: "center" }));
    await page.click('[data-role="loan-post-form"] button[type="submit"]');
    await expect(page.getByText(/Held in escrow now/)).toBeVisible();
    await expect(page.getByText(/10,000 credits, leaving you \d/)).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, `post-confirm-${width}x${height}.png`) });
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await sideways(page), "sideways scroll").toBe(0);
    if (width === 390) expect(await tinyText(page), "text under 14px at 390").toEqual([]);
  });

  test(`the borrower's warning before a sale at ${width}x${height}`, async ({ page }) => {
    await openBank(page, "tessera", size);
    const warning = page.locator('[data-role="loans-borrowed"] [data-role="loan-warning"]');
    await expect(warning).toContainText(/Your assets will be sold on \d{4}-\d\d-\d\d \d\d:\d\d UTC\./); // AB#945: one timestamp format
    await showSection(page, "loans-borrowed");
    await page.screenshot({ path: path.join(SHOT_DIR, `borrower-${width}x${height}.png`) });

    // in the grace period it cannot offer loans (the server refuses too), and the page says so instead of a form
    await expect(page.locator('[data-role="loan-post-held"]')).toContainText("grace period");
    expect(await sideways(page), "sideways scroll").toBe(0);
  });
}
