// ISP-76 (AB#765): the pages before play, rebuilt on the design system, in a real browser at 375x812, 768x1024 and
// 1280x800: no sideways scroll at any width; at 375, no visible text under 14px and every control at least 44px each
// way (a link inside running text is exempt, as WCAG 2.5.8 has it, and as e2e/styleguide.spec.js measures). A
// screenshot of each page at each width goes to e2e/screenshots/ab-765/ (gitignored; the ones the pull request shows
// were copied to docs/ab-765/ by hand).
//
// Run: npm start (or npm run dev) in one terminal, then `npx playwright test e2e/auth-pages.spec.js`.
import { test, expect } from "@playwright/test";
import path from "node:path";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-765");
const PAGES = [
  ["landing", "/"],
  ["login", "/login.html"],
  ["register", "/register.html"],
  ["check-email", "/check-email.html"],
  ["verify-email", "/verify-email.html"],
  ["forgot-password", "/forgot-password.html"],
  ["reset-password", "/reset-password.html"],
  ["how-to-start", "/how-to-start"]
];
const SIZES = [[375, 812], [768, 1024], [1280, 800]];

for (const [name, url] of PAGES) {
  for (const [width, height] of SIZES) {
    test(`${name} at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(url);
      await expect(page.locator("main, #auth-shell").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways scroll").toBe(0);
      if (width === 375) {
        const tiny = await page.evaluate(() => {
          const out = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!n.textContent.trim() || !el.getClientRects().length || el.closest("[hidden], #game-shell")) continue;
            const f = parseFloat(getComputedStyle(el).fontSize);
            if (f < 14) out.push(`${el.tagName.toLowerCase()} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
          }
          return out;
        });
        expect(tiny, "text under 14px").toEqual([]);
        const small = await page.locator("button:visible, input:visible, select:visible, a:visible").evaluateAll((els) =>
          els
            .filter((el) => !el.closest("p, li") && !el.closest("#game-shell"))
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
            .map(({ el, r }) => `${el.tagName} "${(el.textContent || el.id).trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
        );
        expect(small, "controls under 44px").toEqual([]);
      }
      await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: name === "landing" || name === "how-to-start" });
    });
  }
}
