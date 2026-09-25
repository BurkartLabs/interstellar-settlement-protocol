// AB#1781: a modal card fits inside its backdrop's padding at phone width, at every frame of its entrance.
//
// The contract briefing card was `min(640px, 94vw)`: 352.5px at 375 wide, inside a backdrop that leaves 343px once
// its 1rem padding is taken. At rest that only ate into the padding, but during `modalSlideIn` the card reached
// 380px, past the viewport - a 5px horizontal overflow that lasted as long as the 0.25s animation, so a check that
// happened to land inside it failed and one a moment later did not. AB#585 had already fixed the same thing for
// `.modal-card` (`min(760px, 100%)`); the trade confirmation's card overrode that back to 94vw.
//
// Deterministic rather than timing-dependent: the entrance animation is frozen at its first frame, measured, then
// finished and measured again. Run against a server you started: `npx playwright test e2e/modal-fit.spec.js`.

import { test, expect } from "@playwright/test";

const WIDTH = 375;

async function register(page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.setViewportSize({ width: WIDTH, height: 812 });
  await page.goto("/register.html");
  await page.fill("#register-email", `playtest-modal-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Playtest CEO");
  await page.fill("#register-corp", `Playtest Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
}

/** The card's box against its backdrop's padded area and the viewport, with every animation at `at`. */
async function measure(page, card, at) {
  return page.evaluate(
    ({ selector, at }) => {
      for (const a of document.getAnimations()) {
        // The page's own background loops never end; only an entrance has a first and a last frame.
        if (a.effect?.getComputedTiming().endTime === Infinity) continue;
        a.pause();
        if (at === "start") a.currentTime = 0;
        else a.finish();
      }
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(el.parentElement).paddingLeft);
      return { left: r.left, right: r.right, pad, innerWidth: window.innerWidth, scrollWidth: document.scrollingElement.scrollWidth };
    },
    { selector: card, at }
  );
}

function expectFits(m, label) {
  expect(m.scrollWidth, `${label}: no horizontal overflow`).toBeLessThanOrEqual(m.innerWidth);
  expect(m.left, `${label}: inside the backdrop's left padding`).toBeGreaterThanOrEqual(m.pad - 0.5);
  expect(m.right, `${label}: inside the backdrop's right padding`).toBeLessThanOrEqual(m.innerWidth - m.pad + 0.5);
}

test(`the contract briefing card fits at ${WIDTH}px, from its first frame to its last`, async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  await page.click('.tab-btn[data-tab="missions"]');
  await page.locator("[data-agent-id]").first().click();
  await page.locator("[data-mission-id]").first().click();
  await expect(page.locator("#mission-accept-btn")).toBeVisible();
  expectFits(await measure(page, "#mission-detail-modal .mission-modal-card", "start"), "first frame");
  expectFits(await measure(page, "#mission-detail-modal .mission-modal-card", "end"), "at rest");
});

test(`the trade confirmation card fits at ${WIDTH}px`, async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  // Opening it for real needs a filled order; its size is the stylesheet's alone, so it is shown as the app shows it.
  await page.evaluate(() => { document.getElementById("trade-confirm-modal").hidden = false; });
  expectFits(await measure(page, "#trade-confirm-modal .trade-confirm-card", "end"), "trade confirmation");
});
