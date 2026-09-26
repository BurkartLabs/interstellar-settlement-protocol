// ISP-61 (AB#747, v0.5 release gate): a scripted first hour, played the way a new CEO plays it — register, rent an
// office, hire five, file a mining claim, commission a yard, start a cycle, sell to a standing order, queue
// research, accept a contract. Selectors follow public/scripts/walkthrough.js, which names the exact control for
// each of these steps and is itself asserted to exist by tests/unit/walkthrough.test.js — this script is the same
// sequence played through a real browser instead of read out of the data.
//
// Every assertion is on what the player sees (text, a badge, a row appearing), never on account state read some
// other way: a unit test already owns the state (tests/integration/*), and the reason this script exists is that a
// unit test cannot see a page.
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test` in another. BASE_URL overrides the
// default (playwright.config.js). ISP_RATE_LIMIT_REGISTER_MAX raises the register cap for repeated local runs — the
// production default is 5/address/hour (AB#752), and this script registers one account per viewport.

import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";
import { acknowledgeReceipt } from "./receipt.mjs"; // AB#743

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

/**
 * One screenshot per step per viewport (acceptance #1), the whole page, at the real width. `fullPage: true`
 * scrolls and stitches a page taller than the viewport, and a `position: sticky` header (the top bar) is
 * captured once per stitched segment, so it appears to repeat down the image (P-TOOLS: a screenshot lies when
 * the page is scrolled). Growing the viewport to the page's own height first means one capture, no stitching,
 * no repeat — and the width, which is what this story is actually testing, is untouched.
 */
async function shoot(page, viewportLabel, stepId, width) {
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, `${stepId}-${viewportLabel}.png`) });
  await page.setViewportSize({ width, height: VIEWPORTS.find((v) => v.width === width).height });
}

/** Acceptance #3: at the phone width, no screen may scroll sideways. */
async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.scrollWidth, "document.scrollingElement.scrollWidth <= innerWidth").toBeLessThanOrEqual(overflow.innerWidth);
}

/** The feedback log (#feedback-log) is the one place every gameplay action already reports success in words
 *  (app.js's pushFeedback) — asserting its newest line is asserting what the player sees, not internal state. */
async function expectFeedback(page, pattern) {
  await expect(page.locator("#feedback-log li").first()).toContainText(pattern, { timeout: 10_000 });
}

function uniqueAccount() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `playtest-${stamp}@example.test`,
    password: "playtest-password-not-real",
    ceoName: "Playtest CEO",
    corpName: `Playtest Corp ${stamp}`
  };
}

for (const viewport of VIEWPORTS) {
  test(`first hour at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(80_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const account = uniqueAccount();
    const mobile = viewport.width < 600;

    // ── Register ──────────────────────────────────────────────────────────
    await page.goto("/register.html");
    await page.fill("#register-email", account.email);
    await page.fill("#register-password", account.password);
    await page.fill("#register-ceo", account.ceoName);
    await page.fill("#register-corp", account.corpName);
    await page.click('#register-form button[type="submit"]');
    await verifyAndLogIn(page, "", account.email, account.password); // AB#2288: verify, then log in
    await page.waitForURL(/\/\?account=/);
    await expect(page.locator(".nav-tab.active")).toHaveText("Overview");
    // The coordinator's one-time offer ("Brief me" / "I'll find my own way") — this script plays the actions
    // directly rather than through the walkthrough overlay, so it declines the guided briefing.
    await page.getByRole("button", { name: "I'll find my own way" }).click();
    await expect(page.locator("#dialogue-modal")).toBeHidden();
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "01-registered", viewport.width);

    // ── licence: the inbox (WALKTHROUGH_STEPS "licence") ───────────────────
    await openTab(page, "inbox");
    await expect(page.locator('.nav-tab[data-tab="inbox"]')).toHaveClass(/active/);
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "02-licence", viewport.width);

    // ── station: Earth Station Prime ────────────────────────────────────────
    await openTab(page, "station");
    await expect(page.locator('.nav-tab[data-tab="station"]')).toHaveClass(/active/);
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "03-station", viewport.width);

    // ── office: rent the Orbital Executive Suites for 7 days ───────────────
    await page.click('[data-building-action="building:orbital-executive-suites"]');
    await expect(page.locator("#rent-office-duration")).toBeVisible();
    await page.selectOption("#rent-office-duration", "7");
    await page.click("#rent-office-btn");
    await acknowledgeReceipt(page);
    await expect(page.getByText("Active Lease")).toBeVisible();
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "04-office", viewport.width);

    // ── hire: five employees, the ISA's per-lease minimum ───────────────────
    await page.fill("#office-hire-count", "5");
    await page.click('#office-hire-form button[type="submit"]');
    await acknowledgeReceipt(page);
    await expectFeedback(page, /hire|staff|personnel/i);
    await expect(page.locator("#office-hire-hint")).toContainText("5 / ");
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "05-hire", viewport.width);

    // ── lease: file the Earth Silicate Extraction claim ─────────────────────
    await page.click('#station-back-btn');
    await page.click('[data-building-action="building:isa-claims-leases"]');
    await page.click('[data-action="purchase-lease"][data-body="Earth"]');
    await acknowledgeReceipt(page);
    await expect(page.locator('[data-action="manage-lease"]').first()).toBeVisible();
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "06-lease", viewport.width);

    // ── yard: commission a Basic Extractor Yard on that claim ──────────────
    await page.click('[data-action="manage-lease"]');
    await page.click("#lease-build-extractor-btn");
    await acknowledgeReceipt(page);
    await expect(page.locator(".extractor")).toBeVisible();
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "07-yard", viewport.width);

    // ── cycle: start mining at the top rate, so enough accrues to sell soon ─
    const mineForm = page.locator('[data-form="mine"]');
    await mineForm.locator('[name="amount"]').fill("250");
    await mineForm.locator('[name="hours"]').fill("24");
    await mineForm.locator('button[type="submit"]').click();
    await acknowledgeReceipt(page);
    await expect(page.locator('.extractor [data-role="yard-status"]')).toHaveText("Active");
    // The tick runs every 5s server-side (server/index.js miningTick); at 250 t/h that crosses one whole ton
    // within a few ticks (server/game/mining.js carries the fraction between ticks, so this is a real accrual,
    // not a race). "Mined this cycle" is the same figure the player watches (Bug #1091, data-live="mined"),
    // pushed live over the socket — waiting on it is waiting on what the screen shows, not on a fixed sleep.
    await expect(page.locator('.extractor [data-live="mined"]')).not.toHaveText(/^0( t)?$/, { timeout: 60_000 }); // AB#746: "0 t"
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "08-cycle", viewport.width);

    // ── sell: to a standing buy order, now that some has accrued ────────────
    await openTab(page, "market");
    const sellBtn = page.locator('[data-npc-item="Silicates"]').first();
    await expect(sellBtn).toBeEnabled();
    await sellBtn.click();
    await page.click("#trade-confirm-ok");
    await acknowledgeReceipt(page); // AB#744: the sale's receipt
    await expectFeedback(page, /sold|sale/i);
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "09-sell", viewport.width);

    // ── research: queue Basic Extraction Analytics ─────────────────────────
    await openTab(page, "rnd");
    await page.click('.rnd-enqueue-btn[data-tech-id="tt-basic-extraction"]');
    await acknowledgeReceipt(page); // AB#744: the research receipt
    await expectFeedback(page, /research|queue|analytics/i);
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "10-research", viewport.width);

    // ── bureau: accept a contract from the Contracting & Assignments Bureau ─
    await openTab(page, "missions");
    const agentCard = page.locator("[data-agent-id]").first();
    await expect(agentCard, "FIRST_CONTRACT_ID guarantees a new corporation is offered one (server/game/corporation.js)").toBeVisible();
    await agentCard.click();
    const missionCard = page.locator("[data-mission-id]").first();
    await expect(missionCard).toBeVisible();
    await missionCard.click();
    await page.click("#mission-accept-btn");
    await acknowledgeReceipt(page); // AB#744: the contract's receipt
    await expectFeedback(page, /contract accepted/i);
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "11-contract", viewport.width);
  });
}
