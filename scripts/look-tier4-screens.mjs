// ISP-191 (AB#885) part 2: the Tier 4 chains on the Refinery Chains tab from the running app, at 1440x900 and 390x844:
// an Antimatter run started from its card by the player and running in the Synthesis Array, a Tier 4 chain locked by
// research beside it, a corporation without an Array seeing the building and its research as links (followed to the
// Station's construction entry), and the Tier 4 nodes on the R&D tab.
//
// Usage: seed with e2e/seed-synthesis-account.mjs <dataDir> <email> <password>, start a server on that ISP_DATA_DIR with
// the seed's JWT_SECRET, then:
//   node scripts/look-tier4-screens.mjs <baseUrl> <email> <password> <outDir>

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";

const [base, email, password, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const oneLine = (s) => s.replace(/\s+/g, " ").trim();

async function signIn(who, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", who);
  await page.fill("#login-password", password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  return { context, page, errors };
}
async function showCard(page, sel) {
  await page.locator(sel).waitFor();
  await page.evaluate((s) => { // in the page: the view redraws every few seconds, so a held element goes stale
    document.querySelector(s).scrollIntoView({ block: "start" });
    const el = document.querySelector(s);
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector(".app-header").getBoundingClientRect().height - 12);
  }, sel);
  await page.waitForTimeout(300);
}

const VPS = [{ label: "1440x900", width: 1440, height: 900, mobile: false }, { label: "390x844", width: 390, height: 844, mobile: true }];
for (const [i, vp] of VPS.entries()) {
  const { context, page, errors } = await signIn(email, vp);
  const shot = (name) => page.screenshot({ path: path.join(outDir, `ab885-${name}-${vp.label}.png`) });
  await openTab(page, "refinery");
  await page.waitForTimeout(600);
  // The first size starts the run as a player; the second finds it running.
  if (i === 0 && await page.locator("#chain-antimatter-chain .refinery__start").count()) {
    const start = page.locator("#chain-antimatter-chain .refinery__start");
    console.log("Antimatter start button:", oneLine(await start.innerText()), (await start.isDisabled()) ? "(disabled)" : "(enabled)");
    await start.click();
    await page.waitForTimeout(1_500);
    const receipt = page.locator("#action-receipt-modal");
    if (await receipt.isVisible().catch(() => false)) {
      console.log("receipt:", oneLine(await receipt.innerText()).slice(0, 200));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  }
  await showCard(page, "#refinery-active-runs");
  console.log(vp.label, "active runs:", oneLine(await page.locator("#refinery-active-runs").innerText()).slice(0, 200));
  await shot("running");
  await showCard(page, "#chain-breeder-core-chain");
  console.log(vp.label, "locked Tier 4:", oneLine(await page.locator("#chain-breeder-core-chain").innerText()).slice(0, 240));
  await shot("locked-tier4");
  await showCard(page, "#chain-antimatter-chain");
  console.log(vp.label, "antimatter card:", oneLine(await page.locator("#chain-antimatter-chain").innerText()).slice(0, 240));
  await shot("antimatter-card");
  await openTab(page, "rnd");
  await page.waitForTimeout(500);
  await showCard(page, "#research-node-tt-actinide-handling");
  await shot("tier4-nodes");
  console.log(`${vp.label} with Array: page errors ${errors.length ? errors.join(" | ") : "none"}`);
  await context.close();

  const other = await signIn(`noarray-${email}`, vp);
  await openTab(other.page, "refinery");
  await other.page.waitForTimeout(600);
  await showCard(other.page, "#chain-antimatter-chain");
  console.log(vp.label, "no Array:", oneLine(await other.page.locator("#chain-antimatter-chain").innerText()).slice(0, 300));
  await other.page.screenshot({ path: path.join(outDir, `ab885-no-array-${vp.label}.png`) });
  await other.page.locator("#chain-antimatter-chain [data-building-link]").click();
  await other.page.waitForTimeout(600);
  const landed = await other.page.evaluate(() => ({ station: document.querySelector("#station")?.classList.contains("active"), focusedIn: document.activeElement?.closest("[data-building-row]")?.dataset.buildingRow || null }));
  console.log(vp.label, "building link landed:", JSON.stringify(landed));
  await other.page.screenshot({ path: path.join(outDir, `ab885-array-entry-${vp.label}.png`) });
  const wide = await other.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${vp.label}: sideways scroll ${wide}px; page errors ${other.errors.length ? other.errors.join(" | ") : "none"}`);
  await other.context.close();
}
await browser.close();
