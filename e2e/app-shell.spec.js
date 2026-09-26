// ISP-74 (AB#763): the app shell in a real browser. At 1280x800 the navigation is a column on the left above the
// corporation panel and the content is beside it; at 375x812 the navigation is a bar fixed to the bottom of the screen,
// every tab in it at least 44px tall, the content full width, nothing scrolling sideways, and the last thing on the
// page can still be scrolled clear of the bar. Every tab in the navigation shows the focus ring from the keyboard, and
// with reduced motion emulated its transitions finish at once. Screenshots of the Overview at both sizes go to
// e2e/screenshots/ab-763/ (gitignored; the ones the pull request shows were copied to docs/ab-763/ by hand).
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/app-shell.spec.js`.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-763");
const RING = { style: "solid", width: "2px" };

async function register(page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `shell-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Shell CEO");
  await page.fill("#register-corp", `Shell Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `shell-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
}

const box = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, position: getComputedStyle(el).position };
});

test.describe("at 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test("the navigation is a column on the left, above the corporation panel, with the content beside it", async ({ page }) => {
    await register(page);
    const nav = await box(page.locator(".app-nav"));
    const side = await box(page.locator(".side-panel"));
    const main = await box(page.locator(".main-panel"));
    expect(nav.position).toBe("static");
    expect(nav.right).toBeLessThanOrEqual(main.left);
    expect(side.top).toBeGreaterThanOrEqual(nav.bottom);
    const tabs = await page.locator(".app-nav .tab-btn:visible").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    expect(new Set(tabs.map(Math.round)).size, "one column, every tab at the same left edge").toBe(1);
    await page.screenshot({ path: path.join(SHOT_DIR, "overview-1280x800.png") });
  });
});

test.describe("at 375x812", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test("the navigation is a bar along the bottom, the content full width, and nothing hides under the bar", async ({ page }) => {
    await register(page);
    const nav = await box(page.locator(".app-nav"));
    expect(nav.position).toBe("fixed");
    expect(Math.round(nav.bottom)).toBe(812);
    expect(Math.round(nav.left)).toBe(0);
    expect(Math.round(nav.width)).toBe(375);
    const main = await box(page.locator(".main-panel"));
    expect(main.width).toBeGreaterThan(375 - 2 * 16 - 1);
    const short = await page.locator(".app-nav .tab-btn:visible").evaluateAll((els) =>
      els.map((e) => ({ t: e.textContent.trim(), h: e.getBoundingClientRect().height })).filter((x) => x.h < 44).map((x) => `${x.t} ${x.h}`)
    );
    expect(short).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({ path: path.join(SHOT_DIR, "overview-375x812.png") });

    // Scrolled to the end, the last of the content ends above the bar, not under it.
    const last = await page.evaluate(() => {
      // #game-shell is 100vh and the grid overflows it, so the page is what scrolls; scroll both to their end.
      for (const el of [document.getElementById("game-shell"), document.scrollingElement]) el.scrollTop = el.scrollHeight;
      const panel = document.querySelector(".tab-panel.active");
      return panel.getBoundingClientRect().bottom;
    });
    expect(last).toBeLessThanOrEqual(nav.top + 1);
    await page.screenshot({ path: path.join(SHOT_DIR, "overview-375x812-end.png") });

    // A tab pressed in the bar opens its panel.
    await page.locator('.app-nav .tab-btn[data-tab="station"]').click();
    await expect(page.locator("#station")).toHaveClass(/active/);
  });
});

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`every tab in the navigation shows the focus ring from the keyboard, at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await register(page);
    // Arrive by the keyboard, so :focus-visible applies as it does for a player: onto Inbox and back to Overview.
    await page.locator('.app-nav .tab-btn[data-tab="overview"]').focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const count = await page.locator(".app-nav .tab-btn:visible:not(:disabled)").count();
    const bad = [];
    for (let i = 0; i < count; i += 1) {
      const f = await page.evaluate(() => {
        const el = document.activeElement;
        const s = getComputedStyle(el);
        return { nav: Boolean(el.closest(".app-nav")), text: el.textContent.trim(), style: s.outlineStyle, width: s.outlineWidth };
      });
      if (!f.nav) break;
      if (f.style !== RING.style || f.width !== RING.width) bad.push(`${f.text}: ${f.style} ${f.width}`);
      await page.keyboard.press("Tab");
    }
    expect(bad).toEqual([]);
  });
}

test("with reduced motion, the navigation's transitions finish at once, and without it they do not", async ({ page }) => {
  await register(page);
  const duration = () => page.locator(".app-nav .tab-btn").first().evaluate((el) => getComputedStyle(el).transitionDuration);
  // The global reduced-motion rule sets 0.01ms on every element (styles.css, "Focus and motion"); the control shows
  // the rule is what set it, so this cannot pass on a button that simply has no transition.
  expect(await duration()).not.toBe("1e-05s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await duration()).toBe("1e-05s");
});
