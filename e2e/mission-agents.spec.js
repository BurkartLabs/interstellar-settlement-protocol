// AB#1051: the Assignments tab shows the agent registry and contract offers from data/missions.json (via GET
// /api/mission-agents and the server's own contractOfferings), not a client-side literal. Real browser, following
// the pattern in e2e/first-hour.spec.js (AB#747) and e2e/stop-mining.spec.js (AB#1052).
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/mission-agents.spec.js`.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";

const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

async function shoot(page, viewportLabel, stepId, width) {
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, `${stepId}-${viewportLabel}.png`) });
  await page.setViewportSize({ width, height: VIEWPORTS.find((v) => v.width === width).height });
}

async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.scrollWidth, "document.scrollingElement.scrollWidth <= innerWidth").toBeLessThanOrEqual(overflow.innerWidth);
}

function uniqueAccount() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `playtest-agents-${stamp}@example.test`,
    password: "playtest-password-not-real",
    ceoName: "Playtest CEO",
    corpName: `Playtest Corp ${stamp}`
  };
}

for (const viewport of VIEWPORTS) {
  test(`Assignments tab shows agents and offers from data at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const account = uniqueAccount();
    const mobile = viewport.width < 600;

    await page.goto("/register.html");
    await page.fill("#register-email", account.email);
    await page.fill("#register-password", account.password);
    await page.fill("#register-ceo", account.ceoName);
    await page.fill("#register-corp", account.corpName);
    await page.click('#register-form button[type="submit"]');
    await verifyAndLogIn(page, "", account.email, account.password); // AB#2288: verify, then log in
    await page.waitForURL(/\/\?account=/);
    await page.getByRole("button", { name: "I'll find my own way" }).click();
    await expect(page.locator("#dialogue-modal")).toBeHidden();

    await page.click('.tab-btn[data-tab="missions"]');
    const agentCard = page.locator("[data-agent-id]").first();
    await expect(agentCard, "the agent registry (data/missions.json's agents, GET /api/mission-agents) must render at least one").toBeVisible();
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "01-agents", viewport.width);

    await agentCard.click();
    const missionCard = page.locator("[data-mission-id]").first();
    await expect(missionCard, "a contract offer (materializeOffer from the template pool) must render").toBeVisible();
    // AB#1781: a 5px reading here was once seen and skipped. It did not reproduce in 16 runs of this spec (current
    // main, and the commit it was found at) nor in 8 frame-by-frame probes, so the check guards this step again.
    if (mobile) await assertNoHorizontalScroll(page);
    await shoot(page, viewport.label, "02-offers", viewport.width);

    await missionCard.click();
    await expect(page.locator("#mission-accept-btn")).toBeVisible();
    if (mobile) await assertNoHorizontalScroll(page); // AB#1781: asserted again, as at the step above
    await shoot(page, viewport.label, "03-mission-detail", viewport.width);
  });
}
