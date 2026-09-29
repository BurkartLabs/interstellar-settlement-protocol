// Bug #4853: a sale at a station whose system has a concession tariff took the tariff, but the Trade History's total read
// "11,570 (1,040 tax)", and the 390 of tariff went unexplained. The seller here (e2e/seed-trade-deductions.mjs) sold 500
// Nickel at 26 under a 3% tariff and 400 Silicates at 20 under none; the history must name the tariff on the first and
// only the tax on the second. Screenshots of the table at 1280 and 375 go to e2e/screenshots/bug-4853/ (SHOT_LABEL names
// them; "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/trade-history-deductions.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openExchangePage } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "bug-4853");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "trade-deductions-e2e-fixture-secret-012345";

let server, url, seeded;
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-trade-deductions-e2e-"));
  const run = spawnSync(process.execPath, ["e2e/seed-trade-deductions.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (run.status !== 0) throw new Error(`seed failed: ${run.stdout}\n${run.stderr}`);
  seeded = JSON.parse(run.stdout.trim().split("\n").at(-1));
  server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
});
test.afterAll(() => server?.kill());

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`the Trade History names a sale's tariff as well as its tax, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", seeded.seller);
    await page.fill("#login-password", PASSWORD);
    await page.click("#credential-login-btn");
    await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });

    await openExchangePage(page, "history");
    const table = page.locator("#trade-history-table");
    await expect(table.locator("tr")).toHaveCount(2, { timeout: 15_000 });
    const panel = table.locator("xpath=ancestor::*[self::section or self::div][1]");

    // the table, whole, in a viewport tall enough to hold it clear of a phone's fixed bars
    await page.evaluate(() => window.scrollTo(0, 0));
    let box = await panel.boundingBox();
    await page.setViewportSize({ width, height: Math.max(height, Math.ceil(box.y + box.height) + 200) });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    box = await panel.boundingBox();
    await page.screenshot({ path: path.join(SHOT_DIR, `history-${LABEL}-${width}.png`), clip: box, animations: "disabled" });
    await page.setViewportSize({ width, height });
    // and as the player sees it, the viewport at the table
    await table.locator("tr").nth(0).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT_DIR, `page-${LABEL}-${width}.png`), animations: "disabled" });
    // Bug #4866: nothing in a row runs past its cell (a long counterparty name was cut off at a phone's card edge)
    const overflowing = await table.evaluate((t) => [...t.querySelectorAll("td")]
      .filter((td) => td.scrollWidth > td.clientWidth + 1)
      .map((td) => `${td.dataset.label || "?"}: ${td.textContent.trim()} (${td.scrollWidth} > ${td.clientWidth})`));
    expect(overflowing, "cells wider than their column").toEqual([]);

    const { withTariff: a, withoutTariff: b } = seeded;
    const money = (n) => `¤${n.toLocaleString("en-US")}`;
    await expect(table.locator("tr").nth(0)).toContainText(`${money(a.proceeds)} (${money(a.taxAmount)} tax, ${money(a.tariffAmount)} tariff)`);
    await expect(table.locator("tr").nth(1)).toContainText(`${money(b.proceeds)} (${money(b.taxAmount)} tax)`);
  });
}
