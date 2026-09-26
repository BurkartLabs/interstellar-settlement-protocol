// ISP-83 (AB#772): every screen of the game at 375x812, 768x1024 and 1280x800, the check that the nine screen stories
// (AB#763 to AB#771) add up to one product. The pages before play (landing, login, register and their siblings); every
// tab, for a corporation with something on each (e2e/seed-industry-account.mjs); and Travel, for one mid-journey
// (e2e/seed-travel-account.mjs). On every screen, at every width: no sideways scroll. At 375: no visible text under
// 14px and no control under 44px each way (only a link inside running text is exempt), where each story checked only
// its own screens, and not the header, the sidebar or the modals they share. Everywhere: no legacy component in sight
// (.btn, .muted, .overline and the rest the design system replaced), and every tab a .ui-screen with one title.
// Findings are gathered for the whole run and listed together. Screenshots go to e2e/screenshots/ab-772/
// (gitignored; the pull request's are copied to docs/ab-772/).
//
// Run: `npx playwright test e2e/every-screen.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-772");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "every-screen-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[375, 812], [768, 1024], [1280, 800]];
const PAGES = ["/", "/login.html", "/register.html", "/forgot-password.html", "/reset-password.html", "/check-email.html", "/verify-email.html", "/how-to-start.html"];
const TABS = ["overview", "inbox", "finance", "ceo", "missions", "station", "rnd", "refinery", "logistics", "market", "assets", "chat", "forums", "starmap"];
/** The components the design system replaced (ISP-72 to ISP-82). None may be in sight on any screen. */
const LEGACY = ["btn", "btn-accent", "btn-outline", "btn-ghost", "muted", "overline", "lede", "choice-row", "form-card", "data-card", "card-grid", "text-list", "panel-block", "pill", "queue-item", "queue-list"];

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
 * What is wrong on the screen in sight, as lines: sideways scroll at any width; at 375 text under 14px and controls
 * under 44px; legacy components. `scope` is where to look (the whole page, or a tab with the shell around it).
 */
async function findings(page, name, width, scope = "body") {
  return page.evaluate(({ name, narrow, scope, legacy }) => {
    const out = [];
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) out.push(`${name}: sideways scroll ${overflow}px`);
    const shown = (el) => el.getClientRects().length && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden";
    const roots = [...document.querySelectorAll(scope)].filter(shown);
    const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}`;
    for (const root of roots) {
      for (const el of root.querySelectorAll(legacy.map((c) => `.${c}`).join(","))) {
        if (shown(el)) out.push(`${name}: legacy ${label(el)}`);
      }
      if (!narrow) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !shown(el) || el.closest("canvas, option, .sr-only")) continue;
        const f = parseFloat(getComputedStyle(el).fontSize);
        if (f < 14) out.push(`${name}: ${f}px text ${label(el)} "${n.textContent.trim().slice(0, 30)}"`);
      }
      for (const el of root.querySelectorAll("button, input, select, textarea, a, [role=button], [role=tab]")) {
        if (!shown(el) || (el.tagName === "A" && el.closest("p, li"))) continue; // a link in running text is exempt
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.width < 44 || r.height < 44)) out.push(`${name}: control ${Math.round(r.width)}x${Math.round(r.height)} ${label(el)} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24)}"`);
      }
    }
    return [...new Set(out)];
  }, { name, narrow: width === 375, scope, legacy: LEGACY });
}

const shot = (page, name, width, height) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });

for (const [width, height] of SIZES) {
  test(`every screen at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(240_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-every-screen-e2e-"));
    const email = `every-${width}-${Date.now()}@example.test`;
    const traveller = `travel-${width}-${Date.now()}@example.test`;
    seed("e2e/seed-industry-account.mjs", dir, email);
    seed("e2e/seed-travel-account.mjs", dir, traveller);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const found = [];
    try {
      await page.setViewportSize({ width, height });

      for (const p of PAGES) {
        await page.goto(`${url}${p}`);
        await page.waitForLoadState("networkidle");
        const name = p === "/" ? "landing" : p.replace(/^\/|\.html$/g, "");
        found.push(...await findings(page, name, width));
        await shot(page, name, width, height);
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
        await page.waitForTimeout(300);
        const panel = page.locator(`#${tab}`);
        if (!(await panel.evaluate((el) => el.classList.contains("ui-screen")))) found.push(`${tab}: not a .ui-screen`);
        const titles = await panel.locator(".ui-screen__title:visible").count();
        if (titles !== 1) found.push(`${tab}: ${titles} screen titles in sight`);
        found.push(...await findings(page, tab, width, `#${tab}, .app-header, .layout-grid > aside, .nav-bar, .nav-groups`));
        await shot(page, tab, width, height);
      }

      // The shell's own parts no tab shows by itself: the sidebar's blocks opened (a phone starts them closed), and the
      // notification panel.
      const closed = page.locator(".side-panel__toggle[aria-expanded='false']");
      while (await closed.count()) await closed.first().click();
      found.push(...await findings(page, "sidebar", width, ".side-panel"));
      await shot(page, "sidebar", width, height);
      await page.click("#notification-toggle");
      await expect(page.locator("#notification-panel")).toBeVisible();
      found.push(...await findings(page, "notifications", width, "#notification-panel"));
      await page.screenshot({ path: path.join(SHOT_DIR, `notifications-${width}x${height}.png`) });
      await page.click("#notification-toggle");

      await logIn(traveller);
      await openTab(page, "travel");
      await expect(page.locator("#travel")).toBeVisible();
      const travel = page.locator("#travel");
      if (!(await travel.evaluate((el) => el.classList.contains("ui-screen")))) found.push("travel: not a .ui-screen");
      found.push(...await findings(page, "travel", width, "#travel"));
      await shot(page, "travel", width, height);
    } finally {
      child.kill();
    }
    await test.info().attach(`findings-${width}x${height}`, { body: found.join("\n") || "none", contentType: "text/plain" });
    const sideways = found.filter((f) => f.includes("sideways scroll"));
    expect(sideways, "no screen scrolls sideways (AB#772 acceptance)").toEqual([]);
    expect(found, "every screen on the design system, at 375 no text under 14px and no control under 44px").toEqual([]);
    expect(errors).toEqual([]);
  });
}
