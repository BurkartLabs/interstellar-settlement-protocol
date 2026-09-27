// ISP-188 (AB#882): the Starmap's resource overlay for the two new Tier 4 body items, at 1440x900 and 390x844: the
// cluster coloured by Platinum-Group Metals, then Epsilon Eridani's bodies with their shares, then Metallic Hydrogen.
//
// Usage: seed with e2e/seed-prospector-account.mjs <dataDir> <email> <password>, start a server on that ISP_DATA_DIR
// with the seed's JWT_SECRET, then:
//   node scripts/look-tier4-overlay.mjs <baseUrl> <email> <password> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { openSystem, recordCanvas } from "../e2e/starmapCanvas.mjs";

const [base, email, password, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
for (const vp of [{ label: "1440x900", width: 1440, height: 900, mobile: false }, { label: "390x844", width: 390, height: 844, mobile: true }]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await recordCanvas(page);
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "starmap");
  const canvas = page.locator("#starmap-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const options = await page.locator("#map-resource option").evaluateAll((els) => els.map((e) => e.value));
  console.log(`${vp.label} picker has PGM: ${options.includes("Platinum-Group Metals")}, MH: ${options.includes("Metallic Hydrogen")}`);

  await page.selectOption("#map-resource", "Platinum-Group Metals");
  await page.waitForTimeout(500);
  await page.locator("#starmap-resource-legend").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, `ab882-pgm-cluster-${vp.label}.png`), fullPage: vp.mobile });
  console.log(`${vp.label} richest: ${(await page.locator("#map-details [data-overlay-richest]").innerText()).replace(/\s+/g, " ")}`);

  await openSystem(page, canvas, "Epsilon Eridani");
  await page.waitForTimeout(400);
  console.log(`${vp.label} Epsilon Eridani: ${(await page.locator("#map-details [data-overlay-bodies]").innerText()).replace(/\s+/g, " ")}`);
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, `ab882-pgm-epsilon-eridani-${vp.label}.png`), fullPage: vp.mobile });

  await page.selectOption("#map-resource", "Metallic Hydrogen");
  await page.waitForTimeout(500);
  console.log(`${vp.label} Metallic Hydrogen: ${(await page.locator("#map-details [data-overlay-bodies]").innerText()).replace(/\s+/g, " ")}`);
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, `ab882-mh-epsilon-eridani-${vp.label}.png`), fullPage: vp.mobile });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${vp.label}: sideways scroll ${wide}px; page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  await context.close();
}
await browser.close();
