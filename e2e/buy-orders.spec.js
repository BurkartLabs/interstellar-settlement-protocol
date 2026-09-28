// AB#1054: players' buy orders on the Galactic Exchange, in a real browser at 1280x800 and 375x812. A rival's two buy
// orders show beside the sell orders; a buy order placed through the form fills what is listed at or under its price
// (300 Carbon at 19 from Kessler) and the rest waits as the viewer's own row, with Cancel; cancelling returns what it
// held. The layout checks are the Exchange's own (e2e/exchange-screen.spec.js). Screenshots to e2e/screenshots/ab-1054/.
import { test, expect } from "@playwright/test";
import { openExchangePage, openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-1054");
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
  test(`buy orders on the Exchange at ${width}x${height}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await context.newPage();
    const email = `bids-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-bids-e2e-"));
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
      await openExchangePage(page, "players"); // AB#2472: the player order books

      const bids = page.locator("#exchange-bids-table tr");
      await expect(bids).toHaveCount(2);
      await expect(page.locator("#exchange-bids-table")).toContainText("Halvorsen Refining");
      await expect(page.locator("#exchange-bids-table [data-cancel-bid-id]")).toHaveCount(0); // not the viewer's

      await page.selectOption("#bid-item", "Carbon");
      await page.fill("#bid-quantity", "400");
      await page.fill("#bid-price", "20");
      await expect(page.locator("#bid-total")).toContainText("Holds ¤8,000 now");
      await page.click("#bid-submit");
      await page.locator("#trade-confirm-ok").click();
      await expect(page.locator("#action-receipt-close")).toBeVisible();
      await expect(page.locator("#bid-status")).toHaveText(/Bought 300 at once; 100 Carbon waiting at ¤20/);
      await page.locator("#action-receipt-close").click();

      const mine = page.locator("#exchange-bids-table tr", { hasText: "You" });
      await expect(mine).toHaveCount(1);
      await expect(mine).toContainText("Carbon");
      await expect(mine).toContainText("100");
      await expect(page.locator("#exchange-buy-table tr", { hasText: "Carbon" })).toHaveCount(0); // Kessler's 300 sold
      await page.locator("#exchange-tab-history").click(); // AB#2472: the trade history is its own subpage
      await expect(page.locator('#trade-history-table .ui-badge[data-trade-type="bid"]')).toBeVisible();
      await expect(page.locator('#trade-history-table .ui-badge[data-trade-type="bought"]')).toBeVisible();
      await page.locator("#exchange-tab-players").click();

      await measure(page, width);
      await page.evaluate(() => document.getElementById("exchange-bids-section").scrollIntoView({ block: "center" }));
      await page.screenshot({ path: path.join(SHOT_DIR, `bids-${width}x${height}.png`) });
      if (width < 768) {
        await page.evaluate(() => document.getElementById("exchange-bid-form-section").scrollIntoView({ block: "center" }));
        await page.screenshot({ path: path.join(SHOT_DIR, `bid-form-${width}x${height}.png`) });
      }

      await mine.locator("[data-cancel-bid-id]").click();
      await expect(page.locator("#exchange-bids-table tr", { hasText: "You" })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
