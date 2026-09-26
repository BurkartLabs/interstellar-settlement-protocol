// ISP-81 (AB#770): Comms (chat), the Forums and the Assignments Bureau with its contract briefing, rebuilt on the design
// system, in a real browser at 375x812, 768x1024 and 1280x800: no sideways scroll; at 375, no visible text under 14px
// and every control at least 44px each way (a link inside running text is exempt). A player sends a chat line, starts
// a thread and replies to it, and opens an agent's office, reads a briefing and accepts the contract. Screenshots go to
// e2e/screenshots/ab-770/ (gitignored; the ones the pull request shows were copied to docs/ab-770/ by hand).
//
// Run: npm start (or npm run dev) with ISP_DEV=1 in one terminal, then `npx playwright test e2e/comms-screens.spec.js`.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { openTab } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import { verifyAndLogIn } from "./verification.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-770");
const SIZES = [[375, 812], [768, 1024], [1280, 800]];
const PASSWORD = "playtest-password-not-real";

async function register(page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `comms-${stamp}@example.test`);
  await page.fill("#register-password", PASSWORD);
  await page.fill("#register-ceo", "Comms CEO");
  await page.fill("#register-corp", `Comms Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `comms-${stamp}@example.test`, PASSWORD); // AB#2288
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
}

/** The measures every screen is held to, inside `root`. */
async function measure(page, root, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${root}: sideways scroll`).toBe(0);
  if (width !== 375) return;
  const tiny = await page.locator(root).evaluate((panel) => {
    const out = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("[hidden], canvas, option, .sr-only")) continue; // .sr-only: read aloud, never seen
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
    return out;
  });
  expect(tiny, `${root}: text under 14px`).toEqual([]);
  const small = await page.locator(root).locator("button:visible, input:visible, select:visible, textarea:visible, a:visible").evaluateAll((els) =>
    els
      .filter((el) => !el.closest("p, li:not(:has(> button))"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el.tagName} "${(el.textContent || el.id).trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  );
  expect(small, `${root}: controls under 44px`).toEqual([]);
}

for (const [width, height] of SIZES) {
  test(`Comms, the Forums and the Assignments Bureau at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height });
    await register(page);
    const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });

    // Comms: a line on Global, then the Local channel.
    await openTab(page, "chat");
    const line = `Hello from ${width} wide, ${Date.now()}`; // chat is shared: a line from an earlier run is still there
    await page.fill("#chat-input", line);
    await page.click('#chat-form button[type="submit"]');
    await expect(page.locator("#chat-log .chat__line", { hasText: line })).toBeVisible();
    await expect(page.locator('[data-chat-channel-tab="global"]')).toHaveAttribute("aria-selected", "true");
    await measure(page, "#chat", width);
    await shot("chat");
    await page.click('[data-chat-channel-tab="local"]');
    await expect(page.locator('[data-chat-channel-tab="local"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-chat-channel-tab="local"]')).toContainText("Local —");

    // The Forums: start a thread, open it, reply.
    await openTab(page, "forums");
    await expect(page.locator("#forum-categories .ui-tab").first()).toHaveAttribute("aria-selected", "true");
    await measure(page, "#forums", width);
    await shot("forums");
    await page.click("#forum-new-thread-btn");
    const title = `Ore prices at ${width} wide, ${Date.now()}`;
    await page.fill("#forum-new-thread-title", title);
    await page.fill("#forum-new-thread-body", "Silicates are steady at Earth this week.\n\nAnyone seeing better at Luna?");
    await measure(page, "#forums", width);
    await shot("forums-new-thread");
    await page.click('#forum-new-thread-form button[type="submit"]');
    const card = page.locator(".forums__thread-card", { hasText: title });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator("#forum-thread-view")).toBeVisible();
    await page.fill("#forum-reply-content", "Luna is two credits higher.");
    await page.click('#forum-reply-form button[type="submit"]');
    await expect(page.locator(".forums__replies .forums__post")).toHaveCount(1);
    await measure(page, "#forums", width);
    await shot("forum-thread");
    await page.click("#forum-back-btn-inline");
    await expect(page.locator("#forum-overview-view")).toBeVisible();

    // The Assignments Bureau: an agent's office, a briefing, accepting it.
    await openTab(page, "missions");
    await expect(page.locator("[data-agent-id]").first()).toBeVisible();
    await measure(page, "#missions", width);
    await shot("missions");
    await page.locator("[data-agent-id]").first().click();
    await expect(page.locator("#agent-office-view")).toBeVisible();
    await expect(page.locator("#agent-portrait")).toBeVisible();
    await measure(page, "#missions", width);
    await shot("agent-office");
    await page.locator("#agent-mission-list [data-mission-id]").first().click();
    await expect(page.locator("#mission-detail-modal")).toBeVisible();
    await expect(page.locator("#mission-detail-risk-badge")).toHaveClass(/ui-badge/);
    await measure(page, "#mission-detail-modal", width);
    await page.screenshot({ path: path.join(SHOT_DIR, `briefing-${width}x${height}.png`) });
    await page.click("#mission-accept-btn");
    await acknowledgeReceipt(page); // AB#744
    await page.click("#agent-back-btn");
    await expect(page.locator('#active-mission-list [data-state="active"]')).toHaveCount(1);
    await measure(page, "#missions", width);
    await shot("missions-active");
  });
}
