// ISP-190 (AB#884): the Galactic Exchange filtered to Tier 4, from the running app, at 1440x900 and 390x844: the
// player listings of Tier 4 items and the standing bids (the NPC floor rows) under the same filter.
//
// Usage: seed with e2e/seed-exchange-account.mjs <dataDir> <email> <password> tier4, start a server on that
// ISP_DATA_DIR with the seed's JWT_SECRET, then:
//   node scripts/look-tier4-exchange.mjs <baseUrl> <email> <password> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";

const [base, email, password, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/login.html`);
await page.fill("#login-email", email);
await page.fill("#login-password", password);
await page.click('#login-form button[type="submit"]');
await page.waitForURL(/\/\?account=/);
await openTab(page, "market");
await page.selectOption("#exchange-tier-filter", "4");
await page.waitForTimeout(500);

const rows = async (sel) => (await page.locator(`${sel} tr`).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
console.log("sell rows:", await rows("#exchange-buy-table"));
console.log("standing rows:", await rows("#npc-buy-table"));
console.log("pills:", (await page.locator("#exchange-filter-bar").innerText()).replace(/\s+/g, " | "));

async function shoot(name, sel) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.evaluate((s) => {
      const top = document.querySelector(s).getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top - document.querySelector(".app-header").getBoundingClientRect().height - 12);
    }, sel);
    await page.waitForTimeout(200);
    console.log(`${name} ${w}x${h}: sideways scroll ${wide}px`);
    await page.screenshot({ path: path.join(outDir, `ab884-${name}-${w}x${h}.png`) });
  }
}
await shoot("listings", ".exchange__filters");
await shoot("standing", "#exchange-standing-section");
console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
