// AB#911: private messages in the Inbox, in a real browser at 1280x800 and 375x812, with two players in two browser
// contexts. Player A opens the Inbox and writes to player B's corporation (the clicks are counted: four or fewer);
// B, with the Inbox open on another tab, sees the unread count change and the conversation arrive without reloading.
// Then A sends 120 more, and B's thread opens on its latest 50 and loads older pages as B scrolls up, ending with every
// message exactly once. At 375 no visible text in the Inbox is under 14px and every control is at least 44px.
// Screenshots go to e2e/screenshots/ab-911/ (gitignored; the ones the pull request shows are copied to docs/ab-911/).
//
// Run: ISP_DEV=1 NODE_ENV=test npm run dev in one terminal, then `npx playwright test e2e/inbox-conversations.spec.js`.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { openTab } from "./nav.mjs";
import { verifyAndLogIn } from "./verification.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-911");
const SIZES = [[1280, 800], [375, 812]];
const PASSWORD = "playtest-password-not-real";

async function register(page, who) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const corp = `${who} Freight ${stamp.slice(-6)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `inbox-${who}-${stamp}@example.test`.toLowerCase());
  await page.fill("#register-password", PASSWORD);
  await page.fill("#register-ceo", `${who} CEO`);
  await page.fill("#register-corp", corp);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `inbox-${who}-${stamp}@example.test`.toLowerCase(), PASSWORD);
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
  return corp;
}

/** The screen measures at 375: no sideways scroll, no visible text under 14px, no control under 44px. */
async function measure(page, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways scroll").toBe(0);
  if (width !== 375) return;
  const tiny = await page.locator("#inbox").evaluate((panel) => {
    const out = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("[hidden], .sr-only")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
    return out;
  });
  expect(tiny, "text under 14px").toEqual([]);
  const small = await page.locator("#inbox").locator("button:visible, input:visible, textarea:visible").evaluateAll((els) =>
    els.map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el.tagName} "${(el.textContent || el.id).trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`));
  expect(small, "controls under 44px").toEqual([]);
}

for (const [width, height] of SIZES) {
  test(`private messages in the Inbox at ${width}x${height}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const size = { viewport: { width, height } };
    const [ctxA, ctxB] = [await browser.newContext(size), await browser.newContext(size)];
    const [a, b] = [await ctxA.newPage(), await ctxB.newPage()];
    await register(a, "Alpha");
    const bCorp = await register(b, "Beta");

    // B has the Inbox open, and a count of nothing unread from players.
    await openTab(b, "inbox");
    const bTab = b.locator('.nav-tab[data-tab="inbox"]');
    // A new corporation already has an unread welcome letter, so the count is compared with what it was before.
    const countOf = async () => Number((await bTab.textContent()).match(/\((\d+)\)/)?.[1] ?? 0);
    await b.waitForTimeout(500);
    const before = await countOf();

    // A: open the Inbox, then count the clicks it takes to send.
    await openTab(a, "inbox");
    let clicks = 0;
    const click = async (locator) => { await locator.click(); clicks++; };
    await click(a.locator("#inbox-compose-trigger"));
    await a.fill("#compose-to", bCorp);
    await a.fill("#compose-body", "Beta, I have 400 t of silicates at Earth Station Prime. 30 credits a tonne?");
    await a.screenshot({ path: path.join(SHOT_DIR, `composer-${width}x${height}.png`) });
    await measure(a, width);
    await click(a.locator('#inbox-compose-form button[type="submit"]'));
    await expect(a.locator("#inbox-thread-view")).toBeVisible();
    await expect(a.locator("#thread-messages li")).toHaveCount(1);
    expect(clicks, "clicks from an open Inbox to a sent message").toBeLessThanOrEqual(4);

    // B: the count and the conversation arrive live, with no reload.
    await expect.poll(countOf, { timeout: 10_000 }).toBe(before + 1);
    await b.locator('#inbox-subtab-nav [data-subtype="players"]').click();
    await expect(b.locator("#inbox-conversation-list [data-conv-id]")).toHaveCount(1);
    await expect(b.locator("#inbox-conversation-list")).toContainText("30 credits a tonne");

    // A sends 120 more through the app's own client, so B's thread is long enough to page.
    await a.evaluate(async () => {
      const { apiFetch } = await import("/scripts/apiClient.js");
      const { appState } = await import("/scripts/state.js");
      const { convState } = await import("/scripts/views/conversations.js");
      const toCorpId = convState.open.conversation.with.publicId;
      for (let i = 1; i <= 120; i++) {
        await apiFetch(`/api/accounts/${appState.accountId}/conversations/send`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toCorpId, body: `Follow-up ${i}: <b>not bold</b> & still text` })
        });
      }
    });

    // B opens the thread: the latest page only, newest at the bottom, text rendered as text.
    await b.locator("#inbox-conversation-list [data-conv-id]").first().click();
    await expect(b.locator("#inbox-thread-view")).toBeVisible();
    await expect(b.locator("#thread-messages li").last()).toContainText("Follow-up 120: <b>not bold</b> & still text");
    expect(await b.locator("#thread-messages b").count(), "a <b> in a message is text, not markup").toBe(0);
    const firstPage = await b.locator("#thread-messages li").count();
    expect(firstPage).toBeLessThanOrEqual(100);
    await b.screenshot({ path: path.join(SHOT_DIR, `thread-${width}x${height}.png`) });
    await measure(b, width);

    // Scrolling up loads older pages until the start; every message is there exactly once.
    for (let i = 0; i < 10; i++) {
      const status = await b.locator("#thread-older-status").textContent();
      if (status === "The start of this conversation") break;
      await b.locator("#thread-scroll").evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
      await b.waitForTimeout(400);
    }
    await expect(b.locator("#thread-older-status")).toHaveText("The start of this conversation");
    const ids = await b.locator("#thread-messages li").evaluateAll((els) => els.map((e) => e.dataset.messageId));
    expect(ids).toHaveLength(121);
    expect(new Set(ids).size).toBe(121);
    await expect(b.locator("#thread-messages li").first()).toContainText("30 credits a tonne");
    await expect.poll(countOf).toBe(before); // read: back to the welcome letter alone
    console.log(`${width}x${height}: ${clicks} clicks to send; B's thread opened on ${firstPage} of 121 and paged back to all 121`);
    await ctxA.close();
    await ctxB.close();
  });
}
