// ISP-74 (AB#763): the app shell in a real browser. At 1280x800 the navigation is a column on the left above the
// corporation panel and the content is beside it; at 375x812 the navigation is two rows fixed to the top of the screen
// (AB#2468; it was a bar along the bottom), every tab in it at least 44px tall, the content full width, nothing
// scrolling sideways, and the first thing on the page starts clear of the rows. The header is not shown on a phone: the
// ☰ at the right of the second row opens it as a sheet, with Notifications, Replay Onboarding and Log Out in it. Every tab in the navigation shows the focus ring from the keyboard, and
// with reduced motion emulated its transitions finish at once. Screenshots of the Overview at both sizes go to
// e2e/screenshots/ab-763/ (gitignored; the ones the pull request shows were copied to docs/ab-763/ by hand).
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/app-shell.spec.js`.
import { test, expect } from "@playwright/test";
import { closeHeaderSheet, openHeaderSheet, openTab } from "./nav.mjs";
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
    const tabs = await page.locator(".app-nav .nav-tab:visible").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    expect(new Set(tabs.map(Math.round)).size, "one column, every tab at the same left edge").toBe(1);
    await page.screenshot({ path: path.join(SHOT_DIR, "overview-1280x800.png") });
  });
});

test.describe("at 375x812", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test("the navigation is two rows along the top, the content full width, and nothing hides under them", async ({ page }) => {
    await register(page);
    const nav = await box(page.locator(".app-nav"));
    expect(nav.position).toBe("fixed");
    expect(Math.round(nav.top)).toBe(0);
    expect(Math.round(nav.left)).toBe(0);
    expect(Math.round(nav.width)).toBe(375);
    // AB#2468: the header is not shown; the ☰ sits at the right end of the second row, under the bar.
    await expect(page.locator(".app-header")).toBeHidden();
    const menu = await box(page.locator("#phone-menu-toggle"));
    expect(menu.position).toBe("fixed");
    expect(menu.top).toBeGreaterThanOrEqual(nav.bottom - 1);
    expect(Math.round(menu.right)).toBeGreaterThan(375 - 16);
    expect(menu.height).toBeGreaterThanOrEqual(44);
    expect(menu.width).toBeGreaterThanOrEqual(44);
    // At the top of the page the content starts below the two rows, not under them.
    await page.evaluate(() => { for (const el of [document.getElementById("game-shell"), document.scrollingElement]) el.scrollTop = 0; });
    const first = await box(page.locator(".tab-panel.active"));
    expect(first.top).toBeGreaterThanOrEqual(menu.bottom);
    const main = await box(page.locator(".main-panel"));
    expect(main.width).toBeGreaterThan(375 - 2 * 16 - 1);
    const short = await page.locator(".app-nav .nav-tab:visible").evaluateAll((els) =>
      els.map((e) => ({ t: e.textContent.trim(), h: e.getBoundingClientRect().height })).filter((x) => x.h < 44).map((x) => `${x.t} ${x.h}`)
    );
    expect(short).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({ path: path.join(SHOT_DIR, "overview-375x812.png") });

    // Scrolled to the end, the last of the content is still on the screen: nothing fixed covers the bottom any more.
    const last = await page.evaluate(() => {
      // #game-shell is 100vh and the grid overflows it, so the page is what scrolls; scroll both to their end.
      for (const el of [document.getElementById("game-shell"), document.scrollingElement]) el.scrollTop = el.scrollHeight;
      return { bottom: document.querySelector(".tab-panel.active").getBoundingClientRect().bottom, height: window.innerHeight };
    });
    expect(last.bottom).toBeLessThanOrEqual(last.height + 1);
    await page.screenshot({ path: path.join(SHOT_DIR, "overview-375x812-end.png") });
    await page.evaluate(() => { for (const el of [document.getElementById("game-shell"), document.scrollingElement]) el.scrollTop = 0; });

    // AB#2468: the ☰ opens the header as a sheet under the rows: Notifications, Replay Onboarding and Log Out are in it,
    // the notification list opens inside it, and Escape closes it again.
    await openHeaderSheet(page);
    await expect(page.locator("#phone-menu-toggle")).toHaveAttribute("aria-expanded", "true");
    for (const id of ["#notification-toggle", "#replay-onboarding-btn", "#logout-btn"]) await expect(page.locator(id)).toBeVisible();
    const sheet = await box(page.locator(".app-header"));
    expect(sheet.top).toBeGreaterThanOrEqual(menu.bottom);
    await page.click("#notification-toggle");
    await expect(page.locator("#notification-panel")).toBeVisible();
    // in place, inside the sheet, which grows (and scrolls) with it; placed below the sheet, the sheet cut it off
    const list = await page.locator("#notification-panel").evaluate((el) => ({ position: getComputedStyle(el).position, inSheet: Boolean(el.closest(".app-header")) }));
    expect(list, "the list opens inside the sheet, not below it").toEqual({ position: "static", inSheet: true });
    await page.screenshot({ path: path.join(SHOT_DIR, "menu-375x812.png") });
    await page.keyboard.press("Escape");
    await closeHeaderSheet(page);
    await expect(page.locator(".app-header")).toBeHidden();

    // A tab pressed in the bar opens its panel.
    await openTab(page, "station");
    await expect(page.locator("#station")).toHaveClass(/active/);
  });
});

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`every group and tab in the navigation shows the focus ring from the keyboard, at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await register(page);
    // Arrive by the keyboard, so :focus-visible applies as it does for a player: onto Overview and back to Company.
    await page.locator('.app-nav .nav-group__button[data-group="company"]').focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const count = await page.locator(".app-nav button:visible:not(:disabled)").count();
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
  const duration = () => page.locator(".app-nav .nav-tab").first().evaluate((el) => getComputedStyle(el).transitionDuration);
  // The global reduced-motion rule sets 0.01ms on every element (styles.css, "Focus and motion"); the control shows
  // the rule is what set it, so this cannot pass on a button that simply has no transition.
  expect(await duration()).not.toBe("1e-05s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await duration()).toBe("1e-05s");
});
