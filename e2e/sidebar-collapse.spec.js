// AB#2481 (Board review item 12; DOCTRINE P-010, docs/design/p010-scroll-audit.md): every section of the left column
// collapses and expands, and stays as the player left it across tabs and a reload. On a desktop only the open tab's
// group shows its tabs until the player expands another, and Milestones and Quick Actions start collapsed; on a phone the groups are
// the bar as before and the sidebar's blocks start collapsed. Screenshots at 1280x800 and 375x812 go to
// e2e/screenshots/ab-2481/ (gitignored).
//
// Run against a server you started (playwright.config.js): `npx playwright test e2e/sidebar-collapse.spec.js`.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { gameDrawn, openTab } from "./nav.mjs";
import { verifyAndLogIn } from "./verification.mjs";

const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2481");

async function register(page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register.html");
  await page.fill("#register-email", `side-${stamp}@example.test`);
  await page.fill("#register-password", "playtest-password-not-real");
  await page.fill("#register-ceo", "Sidebar CEO");
  await page.fill("#register-corp", `Sidebar Corp ${stamp}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, "", `side-${stamp}@example.test`, "playtest-password-not-real");
  await page.waitForURL(/\/\?account=/);
  await page.getByRole("button", { name: "I'll find my own way" }).click();
  await expect(page.locator("#dialogue-modal")).toBeHidden();
}

const group = (page, id) => page.locator(`.nav-group__button[data-group="${id}"]`);
const block = (page, id) => page.locator(`.side-panel__toggle[aria-controls="sidebar-${id}"]`);
const expanded = async (locator) => (await locator.getAttribute("aria-expanded")) === "true";
const groupStates = (page) => page.locator(".nav-group__button").evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.group, e.getAttribute("aria-expanded")])));

test.describe("at 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("only the open tab's group is expanded, Milestones is collapsed, and every choice lasts across tabs and a reload", async ({ page }) => {
    await register(page);
    expect(await groupStates(page)).toEqual({ company: "true", station: "false", industry: "false", market: "false", comms: "false", map: "false" });
    await expect(page.locator(".nav-tab[data-tab='rnd']")).toBeHidden();
    expect(await expanded(block(page, "identity"))).toBe(true);
    expect(await expanded(block(page, "milestones"))).toBe(false);
    expect(await expanded(block(page, "actions"))).toBe(false);
    await expect(page.locator("#sidebar-milestones")).toBeHidden();
    // The column was every tab over three open blocks, 1,825px, and set the page's length on every tab
    // (docs/design/p010-scroll-audit.md). Six names, one group's tabs and Identity: under 1,100px for a new corporation.
    const column = await page.locator(".side-panel").boundingBox();
    expect(column.y + column.height).toBeLessThan(1100);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOT_DIR, "default-1280x800.png") });

    // The player's choices: Identity collapsed, Market expanded. A group's name only toggles; it opens no tab.
    await block(page, "identity").click();
    await group(page, "market").click();
    await expect(page.locator("#overview")).toBeVisible();
    await expect(page.locator(".nav-tab[data-tab='assets']")).toBeVisible();
    await page.locator(".nav-tab[data-tab='assets']").click();
    await expect(page.locator("#assets")).toBeVisible();
    // Company was open only because its tab was: it collapses now; Market stays as the player set it.
    expect(await groupStates(page)).toMatchObject({ company: "false", market: "true" });
    await expect(page.locator("#sidebar-identity")).toBeHidden();

    // A collapsed group opens again when one of its tabs is opened, here from Quick Actions.
    await group(page, "market").click(); // collapse Market while on Assets
    expect(await expanded(group(page, "market"))).toBe(false);
    await block(page, "actions").click();
    await page.locator("#sidebar-actions [data-jump='finance']").click();
    await expect(page.locator("#finance")).toBeVisible();
    expect(await groupStates(page)).toMatchObject({ company: "true", market: "false" });
    await group(page, "industry").click();

    // A reload keeps them.
    await page.reload();
    await gameDrawn(page);
    expect(await expanded(block(page, "identity"))).toBe(false);
    expect(await expanded(group(page, "industry"))).toBe(true);
    await expect(page.locator(".nav-tab[data-tab='refinery']")).toBeVisible();
    await openTab(page, "station"); // the helper a spec uses: presses the group's name, then the tab
    await expect(page.locator("#station")).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOT_DIR, "choices-kept-1280x800.png") });
  });
});

test.describe("at 375x812", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test("the groups are the bar and open their tabs; the blocks are a sheet from the pinned bar, and the column's choices are untouched", async ({ page }) => {
    await register(page);
    expect(Object.values(await groupStates(page)).every((v) => v === null), "no toggle state on the bar").toBe(true);
    // AB#2468 slice 2: the column is not on the page; Profile, Milestones and Quick Actions are pinned along the bottom
    await expect(page.locator(".side-panel")).toBeHidden();
    for (const id of ["identity", "milestones", "actions"]) expect(await expanded(block(page, id))).toBe(false);
    await page.screenshot({ path: path.join(SHOT_DIR, "default-375x812.png") });
    await page.locator('.pinned-bar__button[data-panel="sidebar-identity"]').click();
    await expect(page.locator("#sidebar-identity")).toBeVisible();
    await expect(block(page, "identity")).toBeHidden(); // the sheet's block has no toggle: the bar's button names it
    expect(await expanded(block(page, "identity")), "the sheet leaves the column's remembered choice alone").toBe(false);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOT_DIR, "identity-open-375x812.png") });
    await group(page, "market").click(); // on a phone the group's button opens its tab, and a tap outside closes the sheet
    await expect(page.locator("#market")).toBeVisible();
    await expect(page.locator("#sidebar-identity")).toBeHidden();
  });
});
