// ISP-185 (AB#879): the Refinery screen's Resource catalog from the running app, at 1440x900 and 390x844, with the
// Tier 4 raws AB#879 adds.
//
// Usage: seed with e2e/seed-idle-refinery.mjs <dataDir> <email> <password> (a verified corporation with a Refinery),
// start a server on that ISP_DATA_DIR, then:
//   node scripts/look-resource-catalog.mjs <baseUrl> <email> <password> <outDir>

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
const skip = page.getByRole("button", { name: "I'll find my own way" });
if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) await skip.click();
await openTab(page, "refinery");

for (const [w, h] of [[1440, 900], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.evaluate(() => {
    const el = document.querySelector("#resource-catalog-title");
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector(".app-header").getBoundingClientRect().height - 12);
  });
  await page.waitForTimeout(200);
  console.log(`${w}x${h}: sideways scroll ${wide}px`);
  await page.screenshot({ path: path.join(outDir, `ab879-resource-catalog-${w}x${h}.png`) });
}
console.log("catalog:", (await page.locator("#resource-catalog").innerText()).replace(/\s+/g, " | "));
console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
