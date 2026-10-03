// ISP-80 (AB#769): the Galactic Exchange rebuilt on the design system (flat direction, Decision AB#1801), in a real
// browser at 375x812, 768x1024 and 1280x800, with every table holding rows (e2e/seed-exchange-account.mjs, and one
// listing made through the page): no sideways scroll; at 375, no visible text under 14px and every control at least
// 44px each way; below 768px every table row is a card; an empty table shows its empty state and no table at all.
// Screenshots to e2e/screenshots/ab-769/ (gitignored; the pull request's are copied to docs/ab-769/). AB#2472: the
// Exchange is five subpages; each check runs on the page that holds it, and every page is measured and photographed.
import { test, expect } from "@playwright/test";
import { gameDrawn, openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-769");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "exchange-e2e-fixture-secret-0123456789abcd";
const SIZES = [[375, 812], [768, 1024], [1280, 800]];

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => {
      out += chunk;
      const port = out.match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

/** The measures the screen is held to (as e2e/company-screens.spec.js holds the Company group). */
async function measure(page, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways scroll").toBe(0);
  // Nor inside the screen: no panel, and not the screen itself, is wider than the room it is given (at 768 with the side
  // menu the tables spilled their panels and the screen scrolled sideways inside a page that did not).
  const wide = await page.locator("#market, #market .ui-panel").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `${el.id || el.className} ${el.scrollWidth}>${el.clientWidth}`));
  expect(wide, "a panel wider than its room").toEqual([]);
  if (width < 768) {
    const notCards = await page.locator("#market .ui-table tbody tr:visible").evaluateAll((rows) => rows.filter((r) => getComputedStyle(r).display !== "grid").length);
    expect(notCards, "table rows that are not cards below 768px").toBe(0);
    expect(await page.locator("#market .ui-table thead:visible").count(), "table headers shown below 768px").toBe(0);
    // Nothing in a card reaches past the card's edge (the quota bar and Sell button did, with no page scroll to show it).
    const spill = await page.locator("#market .ui-table tbody tr:visible").evaluateAll((rows) => rows.flatMap((r) => {
      const edge = r.getBoundingClientRect().right;
      return [...r.querySelectorAll("*")].filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > edge + 0.5).map((el) => `${el.tagName.toLowerCase()} in ${r.closest("section")?.id}`);
    }));
    expect(spill, "content past a card's edge").toEqual([]);
  }
  if (width !== 375) return;
  const tiny = await page.locator("#market").evaluate((panel) => {
    const out = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("[hidden], canvas, option")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
    // A cell's column name is drawn by td::before, which the walker cannot see: measured apart.
    for (const td of panel.querySelectorAll(".ui-table td[data-label]")) {
      if (!td.getClientRects().length) continue;
      const f = parseFloat(getComputedStyle(td, "::before").fontSize);
      if (f < 14) out.push(`td::before "${td.dataset.label}" ${f}px`);
    }
    return out;
  });
  expect(tiny, "text under 14px").toEqual([]);
  const small = await page.locator("#market").locator("button:visible, input:visible, select:visible, a:visible").evaluateAll((els) =>
    els
      .filter((el) => !el.closest("p"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || el.id).trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  );
  expect(small, "controls under 44px").toEqual([]);
}

/**
 * What a player sees: the viewport with a section scrolled to just under the sticky header. A screenshot of the whole
 * panel stitches it under the fixed header and bottom bar, which then appear stamped across it (P-TOOLS).
 */
async function shoot(page, label, sectionIds) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOT_DIR, `${label}-top.png`) });
  for (const id of sectionIds) {
    await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      const headerBottom = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
      window.scrollBy(0, el.getBoundingClientRect().top - Math.max(0, headerBottom) - 8);
    }, id);
    await page.screenshot({ path: path.join(SHOT_DIR, `${label}-${id.replace(/^exchange-/, "")}.png`) });
  }
}
/** AB#2472: each subpage and the sections its screenshots show. */
const PAGES = {
  standing: ["exchange-price-chart", "exchange-standing-section", "exchange-inventory-section"],
  players: ["exchange-sell-section", "exchange-listing-section"],
  mine: ["exchange-mine-section"],
  mercs: ["exchange-mercenary-section"],
  history: ["exchange-history-section"]
};
const toPage = (page, id) => page.locator(`#exchange-tab-${id}`).click();

for (const [width, height] of SIZES) {
  test(`the Galactic Exchange at ${width}x${height}`, async ({ browser }) => {
    test.setTimeout(180_000); // AB#2472: five subpages measured and photographed
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await context.newPage();
    const email = `exchange-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-exchange-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-exchange-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-exchange-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "market");
      // The default subpage is the standing orders; the other pages' sections are out of sight until chosen.
      await expect(page.locator("#exchange-tab-standing")).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#npc-buy-table tr").first()).toBeVisible();
      await expect(page.locator("#exchange-sell-section")).toBeHidden();
      await toPage(page, "players");
      await expect(page.locator("#exchange-buy-table tr")).toHaveCount(4);
      await expect(page.locator("#exchange-standing-section")).toBeHidden();

      // An empty table: its empty state, and no table, header or scroll furniture (ISP-20).
      await toPage(page, "mine");
      await expect(page.locator("#my-sell-orders-empty")).toBeVisible();
      await expect(page.locator("#exchange-mine-section .ui-table-wrap")).toBeHidden();
      await toPage(page, "history");
      await expect(page.locator("#exchange-tools")).toBeHidden(); // no orders here to filter
      await expect(page.locator("#trade-history-empty")).toBeVisible();
      await expect(page.locator("#exchange-history-section .ui-table-wrap")).toBeHidden();

      // One purchase, so the price chart has a day to draw and Trade history a Bought row.
      await toPage(page, "players");
      const buyRow = page.locator("#exchange-buy-table tr", { hasText: "Silicates" });
      await buyRow.locator("[data-buy-order-qty]").fill("5");
      await buyRow.locator("[data-buy-order-id]").click();
      await page.locator("#trade-confirm-ok").click();
      await expect(page.locator("#action-receipt-modal")).toBeVisible(); // closed only once it is up: a click behind it waits
      await page.keyboard.press("Escape"); // the receipt
      await expect(page.locator("#action-receipt-modal")).toBeHidden();
      await expect(page.locator("#price-chart-canvas")).toBeVisible({ timeout: 40_000 }); // the chart refreshes on its own

      // One listing through the page, so My listings and Trade history have rows too.
      await page.fill('[data-sell-qty="Silicates"]', "20");
      await page.fill('[data-sell-price="Silicates"]', "30");
      await page.click('[data-sell-item="Silicates"]');
      await page.locator("#trade-confirm-ok").click();
      await expect(page.locator("#action-receipt-modal")).toBeVisible(); // closed only once it is up: a click behind it waits
      await page.keyboard.press("Escape"); // the receipt
      await expect(page.locator("#action-receipt-modal")).toBeHidden();
      await toPage(page, "mine");
      await expect(page.locator("#my-sell-orders-table tr")).toHaveCount(1);
      await toPage(page, "history");
      await expect(page.locator('#trade-history-table .ui-badge[data-trade-type="bought"]')).toBeVisible();
      await expect(page.locator('#trade-history-table .ui-badge[data-trade-type="listed"]')).toBeVisible();

      for (const [id, sections] of Object.entries(PAGES)) {
        await toPage(page, id);
        await measure(page, width);
        await shoot(page, `exchange-${id}-${width}x${height}`, sections);
      }

      // The page is remembered: a reload opens the one last chosen.
      await page.reload();
      await gameDrawn(page); // the game has drawn
      await openTab(page, "market");
      await expect(page.locator("#exchange-tab-history")).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#exchange-history-section")).toBeVisible();

      // A resource filter: the tab is selected, and a table with nothing for it (My listings holds Silicates) says the
      // filter is hiding it, with Clear filters, and shows no table.
      await toPage(page, "players");
      await page.locator('#exchange-filter-bar [data-filter="Carbon"]').click();
      await expect(page.locator('#exchange-filter-bar [data-filter="Carbon"]')).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#exchange-buy-table tr")).toHaveCount(1);
      await measure(page, width);
      await shoot(page, `exchange-filtered-${width}x${height}`, ["exchange-sell-section"]);
      await toPage(page, "mine");
      await expect(page.locator("#my-sell-orders-filtered")).toBeVisible();
      await expect(page.locator("#my-sell-orders-filtered [data-clear-filters]")).toBeVisible();
      await expect(page.locator("#exchange-mine-section .ui-table-wrap")).toBeHidden();
      await measure(page, width);
      await shoot(page, `exchange-filtered-mine-${width}x${height}`, ["exchange-mine-section"]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
