// ISP-181 (AB#875): the raid screens from the running app, at 1440x900 and 390x844: the incoming-raid alert on the
// Overview, the Fleet tab's garrison and target picker, and a battle report. The world is seeded before the server
// starts (e2e/seed-raids.mjs); the script signs in as the raided corporation and plays the page. Nothing is drawn here.
//
// Usage, with a server running on the seeded ISP_DATA_DIR:
//   node scripts/look-raids.mjs <baseUrl> <accounts.json from the seed> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";

const [base, accountsFile, outDir] = process.argv.slice(2);
const { viewer } = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/login.html`);
await page.fill("#login-email", viewer);
await page.fill("#login-password", "look only throwaway password");
await page.click('#login-form button[type="submit"]');
await page.waitForURL(/\/\?account=/);

const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
async function shoot(name, sel) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    await page.evaluate((s) => {
      const top = document.querySelector(s).getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top - document.querySelector(".app-header").getBoundingClientRect().height - 12);
    }, sel);
    await page.waitForTimeout(200);
    console.log(`${name} ${w}x${h}: sideways scroll ${wide}px`);
    await page.screenshot({ path: path.join(outDir, `ab875-${name}-${w}x${h}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

// 1. the Overview: the incoming raid, with its countdown and the route to the garrison
await page.locator("#overview-raid-alert .raid-alert").waitFor({ timeout: 20_000 });
console.log("alert:", await text("#overview-raid-alert"));
await shoot("overview-alert", "#overview-raid-alert");

// 2. one click to the garrison on the Fleet tab
await page.locator("#overview-raid-alert [data-raid-defend]").click();
await page.locator("#fleet-raids [data-garrison]").first().waitFor();
console.log("garrison:", await text("#fleet-raids [data-garrison]"));
await shoot("garrison", "#fleet-raids [data-garrison]");

// 3. the target picker: the fleet waits at Luna Gateway; the player picks Earth Station Prime to see who may be raided
await page.locator('#fleet-raids [data-raid-picker] select[name="stationId"]').selectOption("earth-station-prime");
await page.locator("#fleet-raids .raid-targets").waitFor({ timeout: 15_000 });
console.log("targets:", await text("#fleet-raids .raid-targets"));
await shoot("target-picker", "#raid-picker-title");

// 4. the battle report of the raid already fought
await page.locator('#fleet-raids [data-raid-report]').first().click();
await page.locator("[data-raid-report-view]").waitFor();
await page.locator(".raid-rounds summary").click();
console.log("report:", (await text("[data-raid-report-view]")).slice(0, 400));
await shoot("report", "[data-raid-report-view]");

await browser.close();
