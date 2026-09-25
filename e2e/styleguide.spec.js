// ISP-72 (AB#761): the core components at /styleguide in a real browser. At 375 wide every control is at least 44px
// each way (inline links in running text are exempt, as WCAG 2.5.8 has it); at both sizes, pressing Tab lands on each
// control with a visible outline; the tabs move with the arrow keys; Escape closes a tooltip opened by focus.
import { test, expect } from "@playwright/test";

const CONTROLS = "main button, main input, main select, main [role=tab], main a";

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`every control shows a focus ring from the keyboard at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/styleguide");
    const focusable = await page.locator(CONTROLS).evaluateAll((els) => els.filter((e) => !e.disabled && e.tabIndex >= 0).length);
    const stops = [];
    for (let i = 0; i < focusable + 2; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return { name: `${el.tagName} ${el.textContent.trim().slice(0, 20)}`, ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 };
      });
      if (!stop) break;
      stops.push(stop);
    }
    expect(stops.length).toBeGreaterThan(30);
    expect(stops.filter((s) => !s.ring).map((s) => s.name)).toEqual([]);
  });
}

test("at 375 wide every control is at least 44px each way", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/styleguide");
  const small = await page.locator(CONTROLS).evaluateAll((els) =>
    els
      .filter((el) => !el.closest("p"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el.tagName} "${el.textContent.trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  );
  expect(await page.locator(CONTROLS).count()).toBeGreaterThan(30);
  expect(small).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("the tabs move with the arrow keys and show their panel", async ({ page }) => {
  await page.goto("/styleguide");
  await page.locator("#sg-tab-overview").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#sg-tab-inbox")).toBeFocused();
  await expect(page.locator("#sg-tab-inbox")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sg-panel-inbox")).toBeVisible();
  await expect(page.locator("#sg-panel-overview")).toBeHidden();
  await page.keyboard.press("End"); // Starmap is disabled: End lands on the last tab that can be chosen
  await expect(page.locator("#sg-tab-finance")).toBeFocused();
});

test("a tooltip opens on focus and Escape closes it", async ({ page }) => {
  await page.goto("/styleguide");
  const tip = page.locator("#sg-tt-closed");
  await expect(tip).toBeHidden();
  await page.getByRole("button", { name: "Building slots: 2" }).focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
});
