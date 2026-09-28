// Bug #4647: the balance sheet with debt as a liability and loans lent as an asset, in a real browser at 1440x900 and
// 390x844. The data comes from e2e/seed-balance-sheet.mjs (the server's own loan code): a borrower with a Development
// Bank loan, and a lender with a loan to another corporation and an offer in escrow. Starts its own server on the seeded
// data directory. Screenshots go to e2e/screenshots/bug-4647/ (gitignored; the ones the pull request shows are copied
// to docs/bug-4647/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "bug-4647");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "balance-sheet-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1440, 900], [390, 844]];

let server, url, logins;
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-balance-sheet-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-balance-sheet.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-balance-sheet.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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

async function openSheet(page, who, [width, height]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", logins[who]);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "finance");
  await page.locator('#finance-subnav [data-finance-sub="daily"]').click(); // AB#2470: each closed day's books are their own page
  const sheet = page.locator(".finance__statement", { hasText: "Balance Sheet" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await sheet.scrollIntoViewIfNeeded();
  return sheet;
}
/** The whole sheet in one picture: a viewport tall enough to hold it, so the phone's fixed nav sits clear of it. */
async function shot(page, sheet, name, [width, height]) {
  const tall = Math.ceil((await sheet.boundingBox()).height) + 400;
  await page.setViewportSize({ width, height: Math.max(height, tall) });
  await sheet.scrollIntoViewIfNeeded();
  await sheet.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), animations: "disabled" });
  await page.setViewportSize({ width, height });
}
const figure = (sheet, key) => sheet.locator(`[data-figure="${key}"]`).getAttribute("data-value");

for (const size of SIZES) {
  const [width, height] = size;
  test(`the borrower's and the lender's balance sheets at ${width}x${height}`, async ({ page }) => {
    let sheet = await openSheet(page, "borrower", size);
    expect(await figure(sheet, "balanceSheet.debt")).toBe("20000");
    expect(await figure(sheet, "balanceSheet.netWorth")).toBe("49500"); // 50,000 less the 500 origination fee
    await shot(page, sheet, "borrower", size);

    sheet = await openSheet(page, "lender", size);
    expect(await figure(sheet, "balanceSheet.receivables")).toBe("65000"); // 40,000 lent and 25,000 in escrow
    expect(await figure(sheet, "balanceSheet.netWorth")).toBe("200000"); // what it started with
    await shot(page, sheet, "lender", size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways scroll").toBe(0);
  });
}
