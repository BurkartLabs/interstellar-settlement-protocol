// ISP-70 (AB#759): look at the design tokens where they show. The specimen at /styleguide/tokens at both viewports
// (the acceptance's screenshots), and the game's own pages, since the old palette names now resolve to the new tokens
// and every font is Inter: the landing page, the register form, and a new corporation's Overview and Station.
//
// Usage, with a server already running (npm start, ISP_DEV=1 and a scratch ISP_DATA_DIR):
//   node scripts/look-design-tokens.mjs <baseUrl> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

async function shoot(page, name, { fullPage = false } = {}) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide > 0) console.log(`  !! ${name} scrolls sideways by ${wide}px`);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log(`${name} -> ${file}`);
}

for (const [width, height] of [[1280, 800], [375, 812]]) {
  const size = `${width}x${height}`;
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${base}/styleguide/tokens`, { waitUntil: "networkidle" });
  await page.locator("[data-contrast] tbody tr").first().waitFor();
  console.log(`specimen ${size}:`, await page.locator("[data-contrast-summary]").innerText());
  console.log(`  fonts in use: ${await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`).join(", "))}`);
  await shoot(page, `isp70-tokens-${size}`);
  await shoot(page, `isp70-tokens-${size}-full`, { fullPage: true });

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await shoot(page, `isp70-landing-${size}`);

  await page.goto(`${base}/register.html`, { waitUntil: "networkidle" });
  await shoot(page, `isp70-register-${size}`);
  const stamp = `${Date.now()}${width}`;
  await page.fill("#register-email", `look${stamp}@example.test`);
  await page.fill("#register-password", "look only throwaway password");
  await page.fill("#register-ceo", "Look Ceo");
  await page.fill("#register-corp", `Look Corp ${stamp.slice(-5)}`);
  await page.click('#register-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  // The first-visit dialogue opens a moment after the page does; the e2e playtest dismisses it the same way.
  const skip = page.getByRole("button", { name: "I'll find my own way" });
  await skip.click({ timeout: 10_000 });
  await page.locator("#dialogue-modal").waitFor({ state: "hidden" });
  await shoot(page, `isp70-overview-${size}`);
  await openTab(page, "station");
  await page.waitForTimeout(500);
  await shoot(page, `isp70-station-${size}`);

  console.log(`  console errors at ${size}: ${errors.length ? errors.join(" | ") : "none"}`);
  await page.close();
}

await browser.close();
