// ISP-191 (AB#885): Tier 4's locks from the running app, at 1440x900 and 390x844: the Refinery screen's Resource
// catalog by tier and a locked chain naming its research as a link; following that link to its card on the R&D tab;
// the Tier 4 nodes there; and Kestrel's lease panel on the Starmap naming the research its Platinum-Group Metals need.
//
// Usage: seed with e2e/seed-idle-refinery.mjs <dataDir> <email> <password>, start a server on that ISP_DATA_DIR
// with the seed's JWT_SECRET, then:
//   node scripts/look-tier4-locks.mjs <baseUrl> <email> <password> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { openSystem, recordCanvas, lastLabel } from "../e2e/starmapCanvas.mjs";

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
  const skip = page.getByRole("button", { name: "I'll find my own way" });
  if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) await skip.click();
  const shot = async (name) => page.screenshot({ path: path.join(outDir, `ab885-${name}-${vp.label}.png`) });
  const top = async (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector(".app-header").getBoundingClientRect().height - 12);
  }, sel);

  await openTab(page, "refinery");
  await page.waitForTimeout(600);
  await top("#resource-catalog-title");
  await shot("catalog");
  console.log(vp.label, "catalog:", (await page.locator("#resource-catalog").innerText()).replace(/\s+/g, " "));

  const locked = page.locator(".refinery__chain", { has: page.locator("[data-research-link]") }).first();
  await locked.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -140));
  await shot("locked-chain");
  const link = locked.locator("[data-research-link]").first();
  const target = await link.getAttribute("data-research-link");
  console.log(vp.label, "locked chain:", (await locked.locator(".ui-card__title").innerText()), "->", (await locked.locator("[data-research-link]").allInnerTexts()).join(", "));
  await link.click();
  await page.waitForTimeout(600);
  const landed = await page.evaluate((id) => ({ tab: document.querySelector("#rnd")?.classList.contains("active"), focused: document.activeElement?.id, want: `research-node-${id}` }), target);
  console.log(vp.label, "link landed:", JSON.stringify(landed));
  await shot("link-landed");

  await page.locator("#research-node-tt-deep-core-extraction").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await shot("tier4-nodes");

  await openTab(page, "starmap");
  const canvas = page.locator("#starmap-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await openSystem(page, canvas, "Epsilon Eridani");
  await page.waitForTimeout(400);
  const label = await lastLabel(page, vp.mobile ? "Kestrel" : "Kestrel");
  let opened = false;
  for (const [dx, dy] of [[-14, -1], [-18, -1], [-10, -1], [-22, 0], [label?.w / 2, -18]]) {
    if (!label) break;
    await canvas.click({ position: { x: label.x + dx, y: label.y + dy } });
    await page.waitForTimeout(400);
    if ((await page.locator("#map-details .ui-panel__title").textContent())?.includes("Kestrel")) { opened = true; break; }
  }
  console.log(vp.label, "Kestrel opened:", opened);
  if (opened) {
    await page.locator("#map-details [data-unrecovered]").scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => window.scrollBy(0, -200));
    console.log(vp.label, "Kestrel:", (await page.locator("#map-details [data-unrecovered]").innerText().catch(() => "(none)")).replace(/\s+/g, " "));
    await shot("kestrel");
  }
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${vp.label}: sideways scroll ${wide}px; page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  await context.close();
}
await browser.close();
