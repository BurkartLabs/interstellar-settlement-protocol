// ISP-75 (AB#764): the navigation in six groups, in a real browser. At 375x812 the six group buttons are the bar, the
// bar does not scroll, every control in it is at least 44px and no text in it is under 14px, and every tab is reachable
// from it; at 768x1024 and 1280x800 every group and tab is in the column. A new corporation's briefing shows a group
// once a step reaches it, and anyone else sees all six. Screenshots go to e2e/screenshots/ab-764/ (gitignored; the
// ones the pull request shows were copied to docs/ab-764/ by hand).
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/nav-groups.spec.js`.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { openTab } from "./nav.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-764");
const GROUPS = ["Company", "Station", "Industry", "Market", "Comms", "Map"];
const TABS = ["overview", "inbox", "finance", "ceo", "missions", "station", "rnd", "refinery", "logistics", "market", "assets", "chat", "forums", "starmap"];

async function register(page, { briefing = false } = {}) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `nav-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Nav CEO");
  await page.fill("#register-corp", `Nav Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: briefing ? "Brief me" : "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
}

/** Screenshots wait for the page to stop scrolling: the briefing scrolls what it points at into view. */
async function settled(page) {
  await expect.poll(async () => {
    const a = await page.evaluate(() => scrollY);
    await page.waitForTimeout(150);
    return a === (await page.evaluate(() => scrollY));
  }).toBe(true);
}

const shownGroups = (page) => page.locator(".nav-group__button:visible").evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));

test.describe("at 375x812", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test("the six groups are the bar, which does not scroll; every control 44px, no text under 14px", async ({ page }) => {
    await register(page);
    expect(await shownGroups(page)).toEqual(GROUPS);
    const bar = await page.locator(".app-nav").evaluate((nav) => ({ over: nav.scrollWidth - nav.clientWidth, bottom: nav.getBoundingClientRect().bottom }));
    expect(bar.over, "the bar does not scroll").toBe(0);
    expect(Math.round(bar.bottom)).toBe(812);
    for (const group of GROUPS) {
      await page.locator(".nav-group__button", { hasText: group }).click();
      const small = await page.locator(".app-nav button:visible").evaluateAll((els) =>
        els
          .map((e) => ({ t: e.textContent.trim(), r: e.getBoundingClientRect(), f: parseFloat(getComputedStyle(e).fontSize) }))
          .filter(({ r, f }) => r.height < 44 || r.width < 44 || f < 14)
          .map(({ t, r, f }) => `${t} ${Math.round(r.width)}x${Math.round(r.height)} ${f}px`)
      );
      expect(small, group).toEqual([]);
      const tiny = await page.locator(".app-nav").evaluate((nav) => {
        const out = [];
        const walker = document.createTreeWalker(nav, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement;
          if (!n.textContent.trim() || !el.getClientRects().length) continue;
          const f = parseFloat(getComputedStyle(el).fontSize);
          if (f > 0 && f < 14) out.push(`${n.textContent.trim()} ${f}px`);
        }
        return out;
      });
      expect(tiny, `${group}: text under 14px`).toEqual([]);
      const overlap = await page.locator(".nav-group__button:visible").evaluateAll((els) => {
        const r = els.map((e) => e.getBoundingClientRect());
        return r.slice(1).filter((b, i) => b.left < r[i].right - 0.5).length;
      });
      expect(overlap, `${group}: group buttons overlap`).toBe(0);
      await settled(page);
    await page.screenshot({ path: path.join(SHOT_DIR, `${group.toLowerCase()}-375x812.png`) });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test("every tab is reachable from the bar", async ({ page }) => {
    await register(page);
    for (const tab of TABS) {
      await openTab(page, tab);
      await expect(page.locator(`#${tab}`), tab).toHaveClass(/active/);
      await expect(page.locator(`.nav-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
    }
  });

  test("unread mail shows on the Company button while Company is closed", async ({ page }) => {
    await register(page);
    await openTab(page, "station");
    await expect(page.locator(".nav-group__button[data-group='company'] .nav-count")).toBeVisible();
    await expect(page.locator(".nav-group__button[data-group='company']")).toHaveAttribute("aria-label", /^Company \(\d+\)$/);
  });
});

for (const [width, height] of [[768, 1024], [1280, 800]]) {
  test(`every group and every tab is in the column at ${width}x${height}, with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await register(page);
    expect(await shownGroups(page)).toEqual(GROUPS);
    const tabs = await page.locator(".nav-tab:visible").evaluateAll((els) => els.map((e) => e.dataset.tab));
    expect(tabs.sort()).toEqual([...TABS].sort());
    const nav = await page.locator(".app-nav").boundingBox();
    const main = await page.locator(".main-panel").boundingBox();
    expect(nav.x + nav.width).toBeLessThanOrEqual(main.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await settled(page);
    await page.screenshot({ path: path.join(SHOT_DIR, `overview-${width}x${height}.png`) });
  });
}

test.describe("the briefing reveals a group when it first becomes relevant", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test("a new corporation's briefing starts with Company alone, adds Station when a step reaches it, and ending it shows all", async ({ page }) => {
    await register(page, { briefing: true });
    await expect(page.locator("#walkthrough-modal")).toBeVisible();
    expect(await shownGroups(page)).toEqual(["Company"]);
    await settled(page);
    await page.screenshot({ path: path.join(SHOT_DIR, "briefing-company-only-375x812.png") });
    await page.locator("#walkthrough-next").click(); // Skip the licence step: the next is the Station
    await expect.poll(() => shownGroups(page)).toEqual(["Company", "Station"]);
    await settled(page);
    await page.screenshot({ path: path.join(SHOT_DIR, "briefing-station-revealed-375x812.png") });
    await page.locator("#walkthrough-end").click();
    await expect.poll(() => shownGroups(page)).toEqual(GROUPS);
  });

  test("a player who finds their own way sees all six at once", async ({ page }) => {
    await register(page);
    expect(await shownGroups(page)).toEqual(GROUPS);
  });
});
