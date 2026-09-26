// AB#1762 (ISP-293): Corporate R&D and the Assignments Bureau sat narrower than the content column (the R&D panel at
// 820px, the Bureau board at 25vw, an agent's office at 50vw), so they looked unfinished beside the other tabs. Each
// is measured here against the width of its own tab panel's content box, which is what every sibling tab fills.
// Screenshots go to e2e/screenshots/isp-293/<SHOT_PREFIX>-...; run with SHOT_PREFIX=before on main and after on the branch.
//
// Run: ISP_DEV=1 npm run dev, then BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/rnd-assignments-width.spec.js
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { verifyAndLogIn } from "./verification.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "isp-293");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PREFIX = process.env.SHOT_PREFIX || "after";
const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

/** The element's width against its tab panel's content box (the panel's width less its horizontal padding). */
function widths(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const tab = el?.closest(".tab-panel");
    if (!el || !tab) return null;
    const cs = getComputedStyle(tab);
    const content = tab.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { el: Math.round(el.getBoundingClientRect().width), content: Math.round(content) };
  }, selector);
}

/** Scroll so the top of `selector` sits just under the fixed header, for a normal (not fullPage) screenshot. */
function toTop(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const header = document.querySelector("header");
    const offset = header && getComputedStyle(header).position !== "static" ? header.getBoundingClientRect().height : 0;
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset - 8);
  }, selector);
}

for (const vp of VIEWPORTS) {
  test(`R&D, the Bureau and an agent's office fill the content column at ${vp.label}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await page.goto("/register.html");
    await page.fill("#register-email", `isp293-${stamp}@example.test`);
    await page.fill("#register-password", "playtest-password-not-real");
    await page.fill("#register-ceo", "Playtest CEO");
    await page.fill("#register-corp", `Width Corp ${stamp}`);
    await page.click('#register-form button[type="submit"]');
    await verifyAndLogIn(page, "", `isp293-${stamp}@example.test`, "playtest-password-not-real"); // AB#2288: verify, then log in
    await page.waitForURL(/\/\?account=/);
    await page.getByRole("button", { name: "I'll find my own way" }).click();

    const measured = {};

    await page.click('.tab-btn[data-tab="rnd"]');
    await expect(page.locator("#rnd .rnd-panel")).toBeVisible();
    await expect(page.locator("#rnd-tech-tree .rnd-row").first()).toBeVisible();
    await toTop(page, "#rnd");
    await page.screenshot({ path: path.join(SHOT_DIR, `${PREFIX}-rnd-${vp.label}.png`) });
    measured.rnd = await widths(page, "#rnd .rnd-panel");

    await page.click('.tab-btn[data-tab="missions"]');
    await expect(page.locator("#missions-board-view")).toBeVisible();
    await expect(page.locator("#agent-list [data-agent-id]").first()).toBeVisible();
    await toTop(page, "#missions");
    await page.screenshot({ path: path.join(SHOT_DIR, `${PREFIX}-bureau-${vp.label}.png`) });
    measured.bureau = await widths(page, "#missions-board-view");

    await page.locator("#agent-list [data-agent-id]").first().click();
    await expect(page.locator("#agent-office-view")).toBeVisible();
    await toTop(page, "#missions");
    await page.screenshot({ path: path.join(SHOT_DIR, `${PREFIX}-agent-office-${vp.label}.png`) });
    measured.office = await widths(page, "#agent-office-view");
    // What the player reads next in the office: the contract cards, which keep their own card-sized cap.
    await toTop(page, "#agent-mission-list");
    await page.screenshot({ path: path.join(SHOT_DIR, `${PREFIX}-agent-contracts-${vp.label}.png`) });

    console.log(`${PREFIX} ${vp.label} ${JSON.stringify(measured)}`);
    for (const [name, m] of Object.entries(measured)) {
      expect(m, `${name} was not found`).not.toBeNull();
      expect(Math.abs(m.el - m.content), `${name}: ${m.el}px in a ${m.content}px content column`).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}
