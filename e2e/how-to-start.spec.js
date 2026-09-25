// AB#748 (ISP-62): /how-to-start, reached the way a playtester reaches it, from the landing page and from the login
// page, with no account. Screenshots of each screenful go to test-results/isp-62/ (not into the tree: copy the ones a
// pull request needs by hand). Viewport screenshots at several scroll positions, not fullPage, because the page has a
// fixed starfield behind it (P-TOOLS: fullPage composites fixed elements into the stitched image).
//
// Run: ISP_DEV=1 npm run dev, then BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/how-to-start.spec.js
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SHOT_DIR = path.join(process.cwd(), "test-results", "isp-62");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

for (const vp of VIEWPORTS) {
  test(`how to start, from the landing page and the login page, at ${vp.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/");
    const fromLanding = page.getByRole("link", { name: "how to start" });
    await expect(fromLanding).toBeVisible();
    await fromLanding.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT_DIR, `landing-link-${vp.label}.png`) });
    await fromLanding.click();
    await page.waitForURL(/\/how-to-start$/);
    await expect(page.getByRole("heading", { level: 1, name: "How to Start" })).toBeVisible();
    await expect(page.locator("ol > li")).toHaveCount(8);

    // Each screenful of the page, top to bottom.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    let n = 1;
    for (let y = 0; y < height; y += vp.height - 80, n++) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOT_DIR, `page-${String(n).padStart(2, "0")}-${vp.label}.png`) });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "no sideways scroll").toBeLessThanOrEqual(0);

    await page.goto("/login.html");
    const fromLogin = page.getByRole("link", { name: "how to start" });
    await expect(fromLogin).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, `login-link-${vp.label}.png`) });
    await fromLogin.click();
    await page.waitForURL(/\/how-to-start$/);
    expect(errors).toEqual([]);
  });
}
