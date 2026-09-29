// AB#2341: standing NPC bids for the six products no track story owns, on the Exchange in a real browser at 1280x800
// and 375x812: Aerogel's bid from Meridian Glassworks at its base of 41, badged NPC, and all six listed. Screenshots to
// e2e/screenshots/ab-2341/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-2341");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "exchange-e2e-fixture-secret-0123456789abcd";
const SIZES = [[1280, 800], [375, 812]];
const PRODUCTS = { Aerogel: 41, "Quantum Insulators": 74, "Armour Plating": 118, "Precision Frames": 94, "Carbon Fibre Sheets": 21, "Graphene Lattice": 37 };

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
  test(`product bids on the Exchange at ${width}x${height}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await context.newPage();
    const email = `product-bids-${Date.now()}-${width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-product-bids-e2e-"));
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
      // AB#4710: with All picked the table lists the buyers for what the corporation holds here; every buyer is one
      // press away, and a product the corporation has not made yet is among the rest
      await page.locator("#npc-buy-show-all").click();

      for (const [item, base] of Object.entries(PRODUCTS)) {
        await expect(page.locator("#npc-buy-table tr", { hasText: item }), item).toContainText(`¤${base}`);
      }
      await page.locator('#exchange-filter-bar [data-filter="Aerogel"]').click();
      const row = page.locator("#npc-buy-table tr");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Meridian Glassworks");
      await expect(row.locator("[data-npc-badge]")).toHaveText("NPC");
      await expect(row).toContainText("¤41");
      await measure(page, width);
      await page.evaluate(() => document.getElementById("exchange-standing-section").scrollIntoView({ block: "center" }));
      await page.screenshot({ path: path.join(SHOT_DIR, `aerogel-bid-${width}x${height}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
