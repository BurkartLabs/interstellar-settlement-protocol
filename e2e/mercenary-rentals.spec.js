// ISP-177 (AB#871): Mercenary Rentals on the Galactic Exchange, from the running app: two fleets on offer from another
// corporation and one the player has already hired, a hire through its confirmation and receipt, and an offer of the
// player's own fleet with the form's preview. At 1440x900 and 390x844; screenshots go to e2e/screenshots/ab-871/.
import { test, expect } from "@playwright/test";
import { openExchangePage, openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-871");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900, mobile: false },
  { label: "390x844", width: 390, height: 844, mobile: true }
];

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

for (const viewport of VIEWPORTS) {
  test(`Mercenary Rentals: two offers and an active contract, a hire with its receipt, and an offer of your own, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const email = `mercs-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-mercs-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "mercs"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}
${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      await openExchangePage(page, "mercs"); // AB#2472: its own subpage
      const panel = page.locator("#exchange-mercenary-section");
      await expect(panel).toBeVisible();
      // two open offers, each with its units by type, attack and defense, term, price, collateral and allowed use
      const rows = panel.locator("[data-merc-offer]");
      await expect(rows).toHaveCount(2);
      const corsair = rows.filter({ hasText: "Corsair" });
      await expect(corsair).toContainText("12 Light Fighters, 2 Destroyers");
      await expect(corsair).toContainText(/[\d,]+\s+ATK \/ [\d,]+\s+DEF/);
      await expect(corsair).toContainText("100%"); // the owner's readiness
      await expect(corsair).toContainText("1 day");
      await expect(corsair).toContainText("¤6,500");
      await expect(corsair).toContainText("¤12,000");
      await expect(corsair).toContainText("Defense only");
      await expect(rows.filter({ hasText: "Halberd" })).toContainText("Raids, PvE and defense");
      // the contract already under way: time left and the escrow
      const lancer = panel.locator("[data-merc-contract]", { hasText: "Lancer" });
      await expect(lancer).toContainText(/From Vega Freight Syndicate/);
      await expect(lancer).toContainText(/Under contract: (167|168) h( \d+ min)? left\. Escrow holds ¤28,000/);
      await panel.scrollIntoViewIfNeeded();
      await panel.screenshot({ path: path.join(SHOT_DIR, `mercenary-rentals-${viewport.label}.png`) });
      await page.screenshot({ path: path.join(SHOT_DIR, `mercenary-rentals-page-${viewport.label}.png`), fullPage: true });
      // the form previews what an offer earns and what a renter posts
      const form = panel.locator("[data-merc-form]");
      await form.locator("[data-merc-term]").selectOption("72");
      await form.locator("[data-merc-price]").fill("9000");
      await form.locator("[data-merc-collateral]").fill("8000");
      await expect(form.locator("[data-merc-preview]")).toContainText("You earn ¤9,000 when the term ends (¤3,000 a day). A renter posts ¤17,000");
      await form.screenshot({ path: path.join(SHOT_DIR, `mercenary-offer-form-${viewport.label}.png`) });
      // hire Corsair: a confirmation, then the receipt, then it is in My contracts
      await corsair.locator("[data-merc-hire]").click();
      const confirm = page.locator("#trade-confirm-modal");
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText("¤18,500");
      await page.screenshot({ path: path.join(SHOT_DIR, `mercenary-hire-confirm-${viewport.label}.png`) });
      await page.locator("#trade-confirm-ok").click();
      const receipt = page.locator("#action-receipt-modal");
      await expect(receipt).toBeVisible();
      await expect(receipt).toContainText("Mercenary Fleet Hired");
      await expect(receipt).toContainText("Defense only");
      await page.screenshot({ path: path.join(SHOT_DIR, `mercenary-hire-receipt-${viewport.label}.png`) });
      await page.locator("#action-receipt-close").click();
      await expect(panel.locator("[data-merc-offer]")).toHaveCount(1);
      await expect(page.locator("#merc-status")).toHaveText("1 fleet for hire.");
      await expect(panel.locator("[data-merc-contract]", { hasText: "Corsair" })).toContainText("Escrow holds ¤18,500");
      // offer the player's own fleet: it shows on both lists as the player's, with no Hire on it
      await form.locator("[data-merc-offer-submit]").click();
      await expect(panel.locator("[data-merc-contract]", { hasText: "Aegis" })).toContainText("On offer");
      await expect(panel.locator("[data-merc-offer]", { hasText: "Aegis" })).toContainText("Your offer");
      await expect(panel.locator('[data-merc-offer] [data-merc-hire]')).toHaveCount(1);
      await panel.screenshot({ path: path.join(SHOT_DIR, `mercenary-rentals-after-${viewport.label}.png`) });
      const ox = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ox).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
