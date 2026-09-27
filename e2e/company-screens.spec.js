// ISP-77 (AB#766): the Company group's screens - Overview, Inbox and the Financial Core with its daily statements -
// rebuilt on the design system, in a real browser at 375x812, 768x1024 and 1280x800: no sideways scroll; at 375, no
// visible text under 14px and every control at least 44px each way (a link inside running text is exempt); below
// 768px, every table row is a card. Screenshots of each screen, an open message and the compose form go to
// e2e/screenshots/ab-766/ (gitignored; the ones the pull request shows were copied to docs/ab-766/ by hand).
//
// Run: npm start (or npm run dev) with ISP_DEV=1 in one terminal, then `npx playwright test e2e/company-screens.spec.js`.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { openTab } from "./nav.mjs";
import { verifyAndLogIn } from "./verification.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-766");
const SIZES = [[375, 812], [768, 1024], [1280, 800]];

async function register(page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `company-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Company CEO");
  await page.fill("#register-corp", `Company Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `company-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
}

/** The measures every screen is held to, inside its own panel. */
async function measure(page, id, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${id}: sideways scroll`).toBe(0);
  if (width !== 375) return;
  const tiny = await page.locator(`#${id}`).evaluate((panel) => {
    const out = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("[hidden], canvas, option")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
    return out;
  });
  expect(tiny, `${id}: text under 14px`).toEqual([]);
  const small = await page.locator(`#${id}`).locator("button:visible, input:visible, select:visible, textarea:visible, a:visible").evaluateAll((els) =>
    els
      .filter((el) => !el.closest("p, li:not(:has(> button))"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el.tagName} "${(el.textContent || el.id).trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  );
  expect(small, `${id}: controls under 44px`).toEqual([]);
}

for (const [width, height] of SIZES) {
  test(`Overview, Inbox and the Financial Core at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await register(page);
    const shot = (name, full = true) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: full });

    await openTab(page, "overview");
    await expect(page.locator("#overview-cards .ui-card").first()).toBeVisible();
    await measure(page, "overview", width);
    await shot("overview");

    await openTab(page, "inbox");
    await expect(page.locator("#inbox-message-list .inbox__message").first()).toBeVisible();
    await measure(page, "inbox", width);
    await shot("inbox");
    await page.locator("#inbox-message-list .inbox__message").first().click();
    await expect(page.locator("#inbox-detail-view")).toBeVisible();
    await expect(page.locator("#inbox-detail-subject")).not.toBeEmpty();
    await measure(page, "inbox", width);
    await shot("inbox-message");
    await page.click("#inbox-back-btn");
    await page.click("#inbox-compose-trigger");
    await expect(page.locator("#inbox-compose-view")).toBeVisible();
    await measure(page, "inbox", width);
    await shot("inbox-compose");
    await page.click("#inbox-compose-back-btn");

    await openTab(page, "finance");
    await expect(page.locator("#finance-pnl-table tbody tr").first()).toBeAttached();
    await expect(page.locator("#statement-body")).not.toContainText("Loading");
    // AB#2470: the Financial Core is four pages; each is measured and shot on its own
    for (const sub of ["summary", "trends", "statements", "daily"]) {
      await page.locator(`#finance-subnav [data-finance-sub="${sub}"]`).click();
      await expect(page.locator(`#finance-sub-${sub}`)).toBeVisible();
      await measure(page, "finance", width);
      if (sub === "statements") {
        const rowDisplay = await page.locator("#finance-pnl-table tbody tr:not(.ui-table__group)").first().evaluate((r) => getComputedStyle(r).display);
        expect(rowDisplay, "a table row below 768px is a card").toBe(width < 768 ? "grid" : "table-row");
      }
      await shot(`finance-${sub}`);
    }
  });
}
