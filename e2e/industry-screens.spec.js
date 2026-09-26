// ISP-79 (AB#768): the Industry screens - Corporate R&D, CEO Insight, Refinery Chains, Assets and Logistics - rebuilt on
// the design system, in a real browser at 375x812, 768x1024 and 1280x800, for a corporation with something in every
// state (e2e/seed-industry-account.mjs). No sideways scroll; at 375, no visible text under 14px and every control at
// least 44px each way (only a link inside running text is exempt); below 768px, every table row is a card.
// Screenshots of each screen, and Assets' second tab, go to e2e/screenshots/ab-768/ (gitignored; the ones the pull
// request shows were copied to docs/ab-768/).
//
// Run: `npx playwright test e2e/industry-screens.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-768");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "industry-screens-e2e-fixture-secret-012345";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[375, 812], [768, 1024], [1280, 800]];

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
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

/** The measures every screen is held to, inside its own panel. */
async function measure(page, id, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${id}: sideways scroll`).toBe(0);
  if (width !== 375) return;
  const tiny = await page.locator(`#${id}`).evaluate((panel) => {
    const out = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("[hidden], canvas, option")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
    return out;
  });
  expect(tiny, `${id}: text under 14px`).toEqual([]);
  const small = await page.locator(`#${id}`).locator("button:visible, input:visible, select:visible, textarea:visible, a:visible").evaluateAll((els) =>
    els
      .filter((el) => !(el.tagName === "A" && el.closest("p")))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el.tagName} "${(el.textContent || el.id || el.className).trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  );
  expect(small, `${id}: controls under 44px`).toEqual([]);
}

/** A table row's display: a card (grid) below 768px, a row above. */
const rowDisplay = (page, selector) => page.locator(selector).first().evaluate((r) => getComputedStyle(r).display);

for (const [width, height] of SIZES) {
  test(`Corporate R&D, CEO Insight, Refinery Chains, Assets and Logistics at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-industry-e2e-"));
    const email = `industry-${width}-${Date.now()}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-industry-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });

      await openTab(page, "rnd");
      await expect(page.locator("#rnd-queue .progress-wrap").first()).toBeVisible();
      await expect(page.locator("#rnd-tech-tree .research__node--done").first()).toBeVisible();
      await expect(page.locator("#rnd-tech-tree .research__node--available .research__enqueue").first()).toBeVisible();
      await expect(page.locator("#rnd-tech-tree .research__node--locked").first()).toBeVisible();
      await measure(page, "rnd", width);
      await shot("rnd");

      await openTab(page, "ceo");
      await expect(page.locator("#ceo-queue .progress-wrap")).toBeVisible();
      await expect(page.locator("#ceo-insight-tree .research__node--planned").first()).toBeVisible();
      await measure(page, "ceo", width);
      await shot("ceo");

      await openTab(page, "refinery");
      await expect(page.locator("#refinery-active-runs .progress-wrap")).toBeVisible();
      await expect(page.locator("#refinery-chains .refinery__chain").first()).toBeVisible();
      await measure(page, "refinery", width);
      await shot("refinery");

      await openTab(page, "assets");
      await expect(page.locator("#assets-panel-inventory tbody tr:not(.ui-table__group)").first()).toBeVisible();
      await measure(page, "assets", width);
      expect(await rowDisplay(page, "#assets-panel-inventory tbody tr:not(.ui-table__group)"), "a table row below 768px is a card").toBe(width < 768 ? "grid" : "table-row");
      await shot("assets");
      await page.click("#assets-tab-infrastructure");
      await expect(page.locator("#assets-panel-infrastructure")).toBeVisible();
      await expect(page.locator("#assets-panel-inventory")).toBeHidden();
      await expect(page.locator("#assets-tab-infrastructure")).toHaveAttribute("aria-selected", "true");
      await measure(page, "assets", width);
      await shot("assets-infrastructure");

      await openTab(page, "logistics");
      await expect(page.locator("#logistics .logistics__station").first()).toBeVisible();
      await expect(page.locator("#logistics-in-flight .logistics__shipment").first()).toBeVisible();
      await expect(page.locator("#logistics-docked")).toContainText("Docked at Earth Station Prime");
      // One item picked, so the look shows a picked box and the bulk move it enables.
      await page.locator("#logistics .logistics__pick").first().check();
      await expect(page.locator("#logistics .logistics__move-picked").first()).toBeEnabled();
      await measure(page, "logistics", width);
      expect(await rowDisplay(page, "#logistics-history tbody tr"), "a table row below 768px is a card").toBe(width < 768 ? "grid" : "table-row");
      await shot("logistics");
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
