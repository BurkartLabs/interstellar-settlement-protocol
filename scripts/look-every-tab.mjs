// ISP-71 (AB#760): every tab of the game at 1280x800, and the three signed-out pages, for a before-and-after of a
// stylesheet-wide change. A fresh corporation each run, so both runs start from the same state.
//
// Usage, with a server already running (ISP_DEV=1, a scratch ISP_DATA_DIR, ISP_RATE_LIMIT_REGISTER_MAX raised):
//   node scripts/look-every-tab.mjs <baseUrl> <outDir> <prefix>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";

const [base, outDir, prefix = "look"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function shoot(name) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide > 0) console.log(`  !! ${name} scrolls sideways by ${wide}px`);
  await page.screenshot({ path: path.join(outDir, `${prefix}-${name}.png`) });
  console.log(`${prefix}-${name}`);
}

for (const [name, url] of [["landing", "/"], ["login", "/login.html"], ["register", "/register.html"]]) {
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  await shoot(name);
}

const stamp = String(Date.now()).slice(-6);
await page.fill("#register-email", `tabs${stamp}@example.test`);
await page.fill("#register-password", "look only throwaway password");
await page.fill("#register-ceo", "Look Ceo");
await page.fill("#register-corp", `Look Corp ${stamp}`);
await page.click('#register-form button[type="submit"]');
await page.waitForURL(/\/\?account=/);
await page.getByRole("button", { name: "I'll find my own way" }).click({ timeout: 10_000 });
await page.locator("#dialogue-modal").waitFor({ state: "hidden" });

const tabs = await page.locator(".nav-tab[data-tab]").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.dataset.tab));
for (const tab of tabs) {
  await openTab(page, tab);
  await page.waitForTimeout(700);
  await shoot(`tab-${tab}`);
}
console.log(`tabs: ${tabs.join(", ")}; page errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
