// ISP-212b (AB#4655): the sales tax at a conglomerate's station, in the running game. At Venus Platform
// (e2e/seed-construction-account.mjs, cg-tax-member and cg-tax-outsider, built through the real project) a sale to a
// standing buyer is quoted with the station's tax: 0% for a member, 8% to the conglomerate's treasury for anyone else,
// in place of the ISA's GEX tax; the confirmation's tax is what the sale then charges. The member also sees the rate
// on the Station screen with the stake vote's options. Shots at 1280 and 375 go to e2e/screenshots/ab-4655/
// (SHOT_LABEL names them; "before" was taken on main's code for the pull request).
//
// Run: `npx playwright test e2e/conglomerate-station-tax.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4655");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.SHOT_LABEL || "after";
const PASSWORD = "playtest-password-not-real";
const SECRET = "station-tax-e2e-fixture-secret-012345678";

async function world(kind, email) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-station-tax-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, kind], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
  const server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
  return { server, url };
}

async function login(page, url, email, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });
}

/** Open the sale of 100 Silicates to the standing buyer, screenshot its confirmation; returns the confirmation's text. */
async function quoteSale(page, shot) {
  await openTab(page, "market");
  await page.waitForLoadState("networkidle"); // GET /tariffs, which carries the station's tax
  const sell = page.locator('[data-npc-item="Silicates"]').first();
  await expect(sell).toBeEnabled({ timeout: 15_000 });
  const orderId = await sell.getAttribute("data-npc-order-id");
  await page.fill(`[data-npc-sell-qty="${orderId}"]`, "100");
  await sell.click();
  const modal = page.locator("#trade-confirm-modal .modal-card, #trade-confirm-modal article").first();
  await expect(page.locator("#trade-confirm-body")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, `${shot}-${LABEL}.png`), animations: "disabled" });
  // every value in sight: the table no wider than its dialog, and the dialog inside the screen (a long label once pushed
  // the values off a phone's screen)
  const fits = await page.evaluate(() => {
    const table = document.querySelector("#trade-confirm-body .trade-confirm-table");
    const card = table?.closest("article, .modal-card") || table?.parentElement;
    return Boolean(table && card) && table.scrollWidth <= card.clientWidth && card.getBoundingClientRect().right <= window.innerWidth;
  });
  expect(fits, "the confirmation fits the screen").toBe(true);
  return (await modal.innerText()).replace(/\s+/g, " ");
}

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`a non-member's sale at a conglomerate's station is quoted and charged the station's 8%, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    const email = `station-tax-out-${Date.now()}-${width}@example.test`;
    const { server, url } = await world("cg-tax-outsider", email);
    try {
      await login(page, url, email, width, height);
      const text = await quoteSale(page, `outsider-quote-${width}`);
      expect(text).toMatch(/Station Tax \(8%\) − ¤[\d,]+ Venus Builders Guild's station: its sales tax, set by its stakeholders' vote, goes to its treasury\./);
      expect(text).not.toMatch(/GEX Sales Tax/);
      await page.click("#trade-confirm-ok");
      await expect(page.locator("#action-receipt-title")).toHaveText("Sale Completed", { timeout: 10_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `outsider-receipt-${width}-${LABEL}.png`), animations: "disabled" });
      const quoted = text.match(/Station Tax \(8%\) − ¤([\d,]+)/)?.[1];
      await expect(page.locator("#action-receipt-body")).toContainText("Station tax");
      await expect(page.locator("#action-receipt-body")).toContainText(`${quoted} credits (8%), to Venus Builders Guild`);
    } finally {
      server.kill();
    }
  });

  test(`a member's sale at its own station is quoted 0%, and the Station screen shows the rate and its options, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    const email = `station-tax-mem-${Date.now()}-${width}@example.test`;
    const { server, url } = await world("cg-tax-member", email);
    try {
      await login(page, url, email, width, height);
      const text = await quoteSale(page, `member-quote-${width}`);
      expect(text).toMatch(/Member Tax \(0%\) − ¤0 Venus Builders Guild's station: members pay no sales tax here\./);
      await page.click("#trade-confirm-cancel, #trade-confirm-close").catch(() => {});
      await page.keyboard.press("Escape");

      await openTab(page, "conglomerate");
      await page.locator('[data-role="cong-tab"][data-tab="station"]').click();
      const gov = page.locator('[data-role="cong-station-governance"]');
      await expect(gov).toContainText("8% for non-members, to the treasury; members pay none", { timeout: 15_000 });
      await expect(gov.locator("#cong-propose-what")).toContainText("Sales tax for non-members: 2%");
      await gov.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await gov.screenshot({ path: path.join(SHOT_DIR, `member-governance-${width}-${LABEL}.png`), animations: "disabled" });
    } finally {
      server.kill();
    }
  });
}
