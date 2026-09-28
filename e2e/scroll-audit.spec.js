// AB#2469 (DOCTRINE P-010: on a desktop, a page needs little or no scrolling): every screen of the game measured for how
// far it scrolls at two desktop viewports, 1440x900 and 1920x1080. The pages before play; every tab, for a corporation
// with something on each (e2e/seed-industry-account.mjs); every view inside a tab that has its own view tabs (Inbox,
// Assets, Conglomerate); and Travel, for one mid-journey (e2e/seed-travel-account.mjs). For each: the page's height in
// screens, where the tab's own content ends, and the tab's sections top to bottom with their heights, so the audit
// (docs/design/p010-scroll-audit.md) can say what to split and where. It asserts nothing about length: it measures.
// Output: the measurements as the test attachment audit-<w>x<h>.json (under test-results/), and a full-page screenshot
// per screen in e2e/screenshots/ab-2469/ (both gitignored).
//
// Run: `npx playwright test e2e/scroll-audit.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";
import { NAV_GROUPS } from "../public/scripts/navGroups.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2469");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "scroll-audit-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1440, 900], [1920, 1080]];
const PAGES = ["/", "/login.html", "/register.html", "/forgot-password.html", "/reset-password.html", "/check-email.html", "/verify-email.html", "/how-to-start.html"];
const TABS = NAV_GROUPS.flatMap((g) => g.tabs).filter((t) => t !== "travel");
/** Tab lists that switch between views of a tab (not filters inside one view): each view is measured on its own. */
const VIEW_TABS = ["#inbox-subtab-nav", "#inbox-folders", "#assets [role=tablist]", "#conglomerate .cong-tabs", "#finance-subnav", "#market #exchange-pages"]; // #finance-subnav: AB#2470; #exchange-pages: AB#2472

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

function seed(script, dir, email) {
  const run = spawnSync(process.execPath, [script, dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (run.status !== 0) throw new Error(`${script} failed: ${run.stdout}\n${run.stderr}`);
}

/**
 * How far the screen scrolls: the document's height against the window's, where `scope`'s content ends, and its
 * sections (its visible children, or its one wrapper's) with each one's heading, top and height in pixels.
 */
function measure(page, scope) {
  return page.evaluate((scope) => {
    window.scrollTo(0, 0);
    const vh = window.innerHeight;
    const doc = document.documentElement.scrollHeight;
    const root = scope ? document.querySelector(scope) : document.body;
    const shown = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && !el.hidden;
    let parts = [...root.children].filter(shown);
    while (parts.length === 1 && parts[0].children.length) parts = [...parts[0].children].filter(shown);
    const heading = (el) => (el.matches("h1,h2,h3,h4") ? el : el.querySelector("h1,h2,h3,h4,.ui-card__title,.ui-section__title,legend"))?.textContent.trim().replace(/\s+/g, " ").slice(0, 60) || "";
    const sections = parts.map((el) => {
      const r = el.getBoundingClientRect();
      return { heading: heading(el), id: el.id || "", top: Math.round(r.top + scrollY), height: Math.round(r.height) };
    }).filter((s) => s.height > 0);
    const r = root.getBoundingClientRect();
    return { viewport: vh, pageHeight: doc, screens: +(doc / vh).toFixed(2), contentBottom: Math.round(r.bottom + scrollY), sections };
  }, scope);
}

const shot = (page, name, width, height) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });

for (const [width, height] of SIZES) {
  test(`every screen's scroll depth at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(300_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-scroll-audit-e2e-"));
    const email = `audit-${width}-${Date.now()}@example.test`;
    const traveller = `travel-${width}-${Date.now()}@example.test`;
    seed("e2e/seed-industry-account.mjs", dir, email);
    seed("e2e/seed-travel-account.mjs", dir, traveller);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const rows = [];
    const record = async (name, scope) => {
      await page.waitForTimeout(300);
      rows.push({ name, ...(await measure(page, scope)) });
      await shot(page, name, width, height);
    };
    try {
      await page.setViewportSize({ width, height });
      for (const p of PAGES) {
        await page.goto(`${url}${p}`);
        await page.waitForLoadState("networkidle");
        await record(p === "/" ? "landing" : p.replace(/^\/|\.html$/g, ""), null);
      }

      const logIn = async (who) => {
        await page.context().clearCookies();
        await page.goto(`${url}/login.html`);
        await page.evaluate(() => localStorage.clear());
        await page.fill("#login-email", who);
        await page.fill("#login-password", PASSWORD);
        await page.click("#credential-login-btn");
        await page.waitForURL(/\/\?account=/);
        await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });
      };

      await logIn(email);
      for (const tab of TABS) {
        await openTab(page, tab);
        await expect(page.locator(`#${tab}`)).toBeVisible();
        await record(tab, `#${tab}`);
        for (const list of VIEW_TABS.filter((s) => s.startsWith(`#${tab}`))) {
          const views = page.locator(`${list} [role=tab]:visible`);
          const n = await views.count();
          for (let i = 0; i < n; i++) {
            const label = (await views.nth(i).innerText()).trim().split("\n")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            await views.nth(i).click();
            await record(`${tab}--${label}`, `#${tab}`);
          }
          if (n) await views.first().click();
        }
      }

      await logIn(traveller);
      await openTab(page, "travel");
      await expect(page.locator("#travel")).toBeVisible();
      await record("travel", "#travel");
    } finally {
      child.kill();
    }
    await test.info().attach(`audit-${width}x${height}.json`, { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
    expect(rows.length).toBeGreaterThan(TABS.length);
    expect(errors).toEqual([]);
  });
}
