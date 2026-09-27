// ISP-186 (AB#880): the Corporate R&D tab from the running app, at 1440x900 and 390x844, scrolled to a node by name
// (the Tier 4 nodes AB#880 adds). Signs in as a seeded corporation.
//
// Usage: seed with e2e/seed-idle-refinery.mjs <dataDir> <email> <password>, start a server on that ISP_DATA_DIR, then:
//   node scripts/look-research-tree.mjs <baseUrl> <email> <password> <outDir> "<node name>" [prefix]

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";

const [base, email, password, outDir, nodeName, prefix = "ab880-research"] = process.argv.slice(2);
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
await openTab(page, "rnd");

const node = page.getByText(nodeName, { exact: true }).first();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await node.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(200);
  console.log(`${w}x${h}: sideways scroll ${wide}px`);
  await page.screenshot({ path: path.join(outDir, `${prefix}-${w}x${h}.png`) });
}
console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
