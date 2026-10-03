// AB#2468 slice 2: at 375x812 Corporation Identity, Milestones and Quick Actions are three buttons pinned along the
// bottom of the screen: Profile, Milestones, Quick Actions. Each opens its block as a sheet above the bar and closes it
// again, by touch and by keyboard (Enter or Space, then Escape, which hands focus back to the button). A tap outside,
// a Quick Action or the ☰ closes it. The page scrolls clear of the bar: at the end of every screen its last control
// is above the bar, not under it. At 1280x800 nothing changes: no bar, the column beside the content. Screenshots of the
// bar and of each sheet open go to e2e/screenshots/ab-2468/ (gitignored; the ones the pull request shows are copied to
// docs/ab-2468/).
//
// Run against a server you started (playwright.config.js): `npx playwright test e2e/pinned-panels.spec.js`.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openTab } from "./nav.mjs";
import { verifyAndLogIn } from "./verification.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2468");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PANELS = [
  ["sidebar-identity", "Profile"],
  ["sidebar-milestones", "Milestones"],
  ["sidebar-actions", "Quick Actions"]
];

async function register(page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `pinned-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Pinned CEO");
  await page.fill("#register-corp", `Pinned Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `pinned-${stamp}@example.test`, "playtest-password-not-real");
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
}

const button = (page, id) => page.locator(`.pinned-bar__button[data-panel="${id}"]`);
const box = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; });

test.describe("at 375x812", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test("Profile, Milestones and Quick Actions are pinned along the bottom; each opens its block and closes it, by touch", async ({ page }) => {
    await register(page);
    const bar = page.locator(".pinned-bar");
    await expect(bar).toBeVisible();
    await expect(page.locator(".side-panel")).toBeHidden();
    await expect(bar.locator(".pinned-bar__button")).toHaveText(PANELS.map(([, name]) => name));
    const barBox = await box(bar);
    expect(Math.round(barBox.bottom), "the bar sits on the bottom edge").toBe(812);
    for (const [id] of PANELS) expect((await box(button(page, id))).height, id).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOT_DIR, "bar-375x812.png") });

    const navBottom = await page.locator(".app-nav").evaluate((el) => Math.max(...[el, ...el.querySelectorAll(".nav-group__tabs")].map((e) => e.getBoundingClientRect().bottom)));
    for (const [id, name] of PANELS) {
      await button(page, id).tap();
      await expect(button(page, id)).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(`#${id}`)).toBeVisible();
      for (const [other] of PANELS) if (other !== id) await expect(page.locator(`#${other}`), `${name} shows only its own block`).toBeHidden();
      await expect(page.locator(".side-panel")).toHaveAttribute("aria-label", name);
      const sheet = await box(page.locator(".side-panel"));
      expect(sheet.bottom, `${name}: the sheet ends where the bar starts`).toBeLessThanOrEqual(barBox.top + 1);
      expect(sheet.top, `${name}: the sheet starts below the navigation`).toBeGreaterThanOrEqual(navBottom - 1);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOT_DIR, `${id.replace("sidebar-", "")}-open-375x812.png`) });
      await button(page, id).tap();
      await expect(button(page, id)).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".side-panel")).toBeHidden();
    }
  });

  test("each opens and closes by keyboard, and Escape hands focus back to its button", async ({ page }) => {
    await register(page);
    for (const [id, name] of PANELS) {
      for (const key of ["Enter", " "]) {
        await button(page, id).focus();
        await page.keyboard.press(key);
        await expect(page.locator(`#${id}`), `${name} opens with ${JSON.stringify(key)}`).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".side-panel"), `${name} closes with Escape`).toBeHidden();
        await expect(button(page, id)).toHaveAttribute("aria-expanded", "false");
        expect(await button(page, id).evaluate((el) => el === document.activeElement), `${name} has the focus back`).toBe(true);
      }
    }
    // the sheet comes next in the keyboard's order, so Tab from the button reaches its controls
    await button(page, "sidebar-actions").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("#sidebar-actions") !== null), "Tab goes into the open sheet").toBe(true);
  });

  test("a tap outside, a Quick Action or the ☰ closes the sheet, and the ☰ sheet and a pinned one never show together", async ({ page }) => {
    await register(page);
    await button(page, "sidebar-identity").tap();
    await expect(page.locator("#sidebar-identity")).toBeVisible();
    await page.locator(".main-panel").tap({ position: { x: 20, y: 200 } });
    await expect(page.locator(".side-panel")).toBeHidden();

    await button(page, "sidebar-actions").tap();
    await page.locator('#sidebar-actions [data-jump="finance"]').tap();
    await expect(page.locator(".side-panel")).toBeHidden();
    await expect(page.locator("#finance")).toBeVisible();

    await button(page, "sidebar-milestones").tap();
    await page.locator("#phone-menu-toggle").tap();
    await expect(page.locator("#app-header")).toBeVisible();
    await expect(page.locator(".side-panel")).toBeHidden();
    await button(page, "sidebar-milestones").tap();
    await expect(page.locator("#sidebar-milestones")).toBeVisible();
    await expect(page.locator("#phone-menu-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#app-header")).toBeHidden();
  });

  test("the page scrolls clear of the bar: at the end of every screen its last control is above the bar", async ({ page }) => {
    await register(page);
    const barTop = (await box(page.locator(".pinned-bar"))).top;
    for (const tab of ["overview", "station", "market", "finance", "inbox", "starmap", "chat"]) {
      await openTab(page, tab);
      await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight));
      await page.waitForTimeout(150);
      const last = await page.evaluate(() => {
        const controls = [...document.querySelectorAll(".main-panel :is(button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1']))")]
          .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
        const rects = controls.map((el) => ({ bottom: el.getBoundingClientRect().bottom, name: el.id || el.textContent.trim().slice(0, 30) }));
        return rects.sort((a, b) => b.bottom - a.bottom)[0] || null;
      });
      // the page itself ends above the bar (its last control is often well up the screen, so this is what catches a page running under it)
      const end = await page.locator(".main-panel").evaluate((el) => el.getBoundingClientRect().bottom);
      expect(end, `${tab}: the page ends above the bar`).toBeLessThanOrEqual(barTop);
      if (!last) continue;
      expect(last.bottom, `${tab}: its last control (${last.name}) ends above the bar`).toBeLessThanOrEqual(barTop);
      if (tab === "overview") await page.screenshot({ path: path.join(SHOT_DIR, "overview-end-375x812.png") });
    }
  });
});

test.describe("at 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test("no pinned bar: the sidebar is its column beside the content", async ({ page }) => {
    await register(page);
    await expect(page.locator(".pinned-bar")).toBeHidden();
    await expect(page.locator(".side-panel")).toBeVisible();
    const side = await page.locator(".side-panel").evaluate((el) => getComputedStyle(el).position);
    expect(side).not.toBe("fixed");
    await page.screenshot({ path: path.join(SHOT_DIR, "overview-1280x800.png") });
  });
});
