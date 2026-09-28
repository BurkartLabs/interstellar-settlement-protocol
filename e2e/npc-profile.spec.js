// ISP-124 (AB#818): NPC corporations visible on the Exchange, in a real browser at 1280x800 and 375x812 (AB#2492: the project's sizes; 1440x900 and 390x844 before). Player
// listings and a rival's buy orders (seeded) sit with the NPCs' standing orders: every NPC row carries the badge ("NPC",
// or "Authority" for the GEX and the ISA), no player row does, and an NPC's name opens its profile card with the
// catalog's flavour, home station and trades. Screenshots, taken after the actions, to e2e/screenshots/ab-818/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-818");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "exchange-e2e-fixture-secret-0123456789abcd";
const SIZES = [[1280, 800], [375, 812]];

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
for (const [width, height] of SIZES) {
  test(`NPC badges and a profile card at ${width}x${height}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await context.newPage();
    const email = `npc-profile-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-npc-profile-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-exchange-account.mjs", dir, email, PASSWORD, "bids"], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
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

      // Every NPC row badged; no player row.
      for (const table of ["#npc-sell-table", "#npc-buy-table"]) {
        const rows = page.locator(`${table} tr`);
        const n = await rows.count();
        expect(n, table).toBeGreaterThan(0);
        await expect(page.locator(`${table} [data-npc-badge]`), table).toHaveCount(n);
      }
      await expect(page.locator("#exchange-buy-table tr")).toHaveCount(4); // Kessler's four listings
      await expect(page.locator("#exchange-bids-table tr")).toHaveCount(2); // Halvorsen's two buy orders
      for (const table of ["#exchange-buy-table", "#exchange-bids-table", "#my-sell-orders-table"]) {
        await expect(page.locator(`${table} [data-npc-badge]`), table).toHaveCount(0);
      }
      await expect(page.locator('#npc-buy-table tr', { hasText: "GEX Commodities Authority" }).locator("[data-npc-badge]")).toHaveText("Authority");

      // Player and NPC orders together: the Silicates filter leaves one of each kind on screen.
      await page.locator('#exchange-filter-bar [data-filter="Silicates"]').click();
      await expect(page.locator("#exchange-buy-table tr")).toHaveCount(1);
      await expect(page.locator("#npc-sell-table tr")).toHaveCount(1);
      await page.screenshot({ path: path.join(SHOT_DIR, `orders-${width}x${height}.png`), fullPage: true });

      // The card, opened from the order book.
      const name = page.locator('#npc-sell-table [data-npc-profile="Meridian Glassworks"]');
      await name.scrollIntoViewIfNeeded();
      await name.click();
      const modal = page.locator("#npc-profile-modal");
      await expect(modal).toBeVisible();
      await expect(page.locator("#npc-profile-title")).toHaveText("Meridian Glassworks");
      await expect(page.locator('[data-npc-field="home"]')).toHaveText("Earth Station Prime");
      await expect(page.locator('[data-npc-field="trades"]')).toHaveText("Silicates");
      await expect(page.locator("#npc-profile-body")).toContainText("aerogel panels");
      // AB#2492: Close sits at the card's bottom right: its right edge on the content's, nothing below it
      const at = await page.evaluate(() => {
        const btn = document.getElementById("npc-profile-close").getBoundingClientRect();
        const content = document.querySelector("#npc-profile-modal .dialogue__content").getBoundingClientRect();
        const below = [...document.querySelectorAll("#npc-profile-modal .dialogue__content *")].filter((el) => el.getClientRects().length && el.getBoundingClientRect().top >= btn.bottom).length;
        return { right: content.right - btn.right, bottom: content.bottom - btn.bottom, below };
      });
      expect(at.right).toBeLessThanOrEqual(1);
      expect(at.bottom).toBeLessThanOrEqual(1);
      expect(at.below).toBe(0);
      await page.screenshot({ path: path.join(SHOT_DIR, `profile-${width}x${height}.png`) });
      await page.keyboard.press("Escape");
      await expect(modal).toBeHidden();
      await expect(name).toBeFocused(); // focus back on the name that opened it

      // An authority's card from the buy side.
      await page.locator('#exchange-filter-bar [data-filter=""]').click();
      await page.locator('#npc-buy-table [data-npc-profile="GEX Commodities Authority"]').click();
      await expect(page.locator("#npc-profile-heading")).toHaveText("Authority");
      await page.locator("#npc-profile-close").click();
      await expect(modal).toBeHidden();

      await measure(page, width);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
