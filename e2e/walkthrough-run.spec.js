// AB#738 (ISP-52): the walkthrough played start to finish in a real browser, through the briefing card itself.
// e2e/first-hour.spec.js plays the same actions but declines the briefing ("I'll find my own way"), so it never runs
// the walkthrough — this one accepts it ("Brief me") and checks the card moves through every step on what the player
// does, then that the page logged no error at any point. It is the check for the app.js split, whose moved code (the
// dialogue card, the walkthrough, the API client) is exactly what this path runs.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/walkthrough-run.spec.js`.

import { test, expect } from "@playwright/test";
import { openTab, openStationOffices } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";
import { WALKTHROUGH_STEPS } from "../public/scripts/walkthrough.js";
import { verifyAndLogIn } from "./verification.mjs";
import { acknowledgeReceipt } from "./receipt.mjs"; // AB#743

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const TOTAL = WALKTHROUGH_STEPS.length;

test("the walkthrough runs start to finish with no console error, at 1280x800", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console: ${msg.text()}`); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `walkthrough-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Walkthrough Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `walkthrough-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
  await page.waitForURL(/\/\?account=/);

  // The coordinator's offer is the dialogue card (dialogue.js); accepting it starts the walkthrough (walkthroughUi.js).
  await page.getByRole("button", { name: "Brief me" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
  const card = page.locator("#walkthrough-modal");
  const progress = page.locator("#walkthrough-progress");
  await expect(card).toBeVisible();

  /** The card is on step `n` (1-based) and names that step, before the player does it. */
  async function atStep(n) {
    await expect(progress).toHaveText(`${n} of ${TOTAL}`, { timeout: 70_000 });
    await expect(page.locator("#walkthrough-title")).toHaveText(WALKTHROUGH_STEPS[n - 1].title);
  }

  await atStep(1); // licence: open the inbox
  await openTab(page, "inbox");

  await atStep(2); // station
  await openTab(page, "station");

  await atStep(3); // office
  await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
  await page.click('[data-building-action="building:orbital-executive-suites"]');
  await page.selectOption("#rent-office-duration", "7");
  await page.click("#rent-office-btn");
  await acknowledgeReceipt(page);

  await atStep(4); // hire
  await page.fill("#office-hire-count", "5");
  await page.click('#office-hire-form button[type="submit"]');
  await acknowledgeReceipt(page);

  await atStep(5); // lease
  await page.click("#station-back-btn");
  await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
  await page.click('[data-building-action="building:isa-claims-leases"]');
  await page.click('[data-action="purchase-lease"][data-body="Earth"]');
  await acknowledgeReceipt(page);

  await atStep(6); // yard
  await page.click('[data-action="manage-lease"]');
  await page.click("#lease-build-extractor-btn");
  await acknowledgeReceipt(page);

  await atStep(7); // cycle
  const mineForm = page.locator('[data-form="mine"]');
  await mineForm.locator('[name="amount"]').fill("250");
  await mineForm.locator('[name="hours"]').fill("24");
  await mineForm.locator('button[type="submit"]').click();
  await acknowledgeReceipt(page);

  await atStep(8); // sell, once something has been mined (the 5s server tick, pushed live over the socket)
  await expect(page.locator('.extractor [data-live="mined"]')).not.toHaveText(/^0( t)?$/, { timeout: 60_000 }); // AB#746: "0 t"
  await openTab(page, "market");
  const sellBtn = page.locator('[data-npc-item="Silicates"]').first();
  await expect(sellBtn).toBeEnabled();
  await sellBtn.click();
  await page.click("#trade-confirm-ok");
  await acknowledgeReceipt(page); // AB#744

  await atStep(9); // research
  await openTab(page, "rnd");
  await page.click('.research__enqueue[data-tech-id="tt-basic-extraction"]');
  await acknowledgeReceipt(page); // AB#744

  await atStep(10); // bureau
  await openTab(page, "missions");

  await atStep(11); // overview
  await openTab(page, "overview");

  await atStep(12); // starmap
  await openTab(page, "starmap");

  // Every step done: the card stays on the handoff, marked complete, and its one button closes it.
  await expect(progress).toHaveText("Briefing complete", { timeout: 10_000 });
  await expect(page.locator("#walkthrough-next")).toHaveText("Close");
  await page.screenshot({ path: path.join(SCREEN_DIR, "walkthrough-complete-1280x800.png") });
  await page.click("#walkthrough-next");
  await expect(card).toBeHidden();

  // The Overview tab after the split, at 1280x800: the viewport as the player sees it, and the whole page.
  await openTab(page, "overview");
  await expect(page.locator('.nav-tab[data-tab="overview"]')).toHaveClass(/active/);
  await page.screenshot({ path: path.join(SCREEN_DIR, "overview-1280x800.png") });
  await page.screenshot({ path: path.join(SCREEN_DIR, "overview-1280x800-full.png"), fullPage: true });

  expect(errors, "the page logged no error from registration to the end of the walkthrough").toEqual([]);
});

// Finishing through Close never leaves the tab the player is on. End briefing does: it moves to R&D through the
// walkthrough module's setTab hook (connectWalkthroughUi in app.js), the one call back into app.js the full run above
// never makes.
test("End briefing closes the card and lands on R&D, with no console error", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console: ${msg.text()}`); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `walkthrough-end-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `End Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `walkthrough-end-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
  await page.waitForURL(/\/\?account=/);

  await page.getByRole("button", { name: "Brief me" }).click();
  await expect(page.locator("#walkthrough-progress")).toHaveText(`1 of ${TOTAL}`);
  await page.click("#walkthrough-end");
  await expect(page.locator("#walkthrough-modal")).toBeHidden();
  await expect(page.locator('.nav-tab[data-tab="rnd"]')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});
