// AB#1053: the Travel screen, rebuilt on the design system by ISP-83 (AB#772), in each of its three states, in a real
// browser at 375x812, 768x1024 and 1280x800: a docking approach inside a system (route, bar, time left), an interstellar
// jump (the two systems), and open space after a jump (the stations to dock at, the choice of destination). On each:
// no sideways scroll, nothing past either edge; at 375 no visible text under 14px and no control under 44px; no legacy
// component; a .ui-screen with one title. Each corporation is seeded by e2e/seed-travel-account.mjs.
// Screenshots go to e2e/screenshots/ab-1053/ (gitignored).
//
// Run: `npx playwright test e2e/travel-screen.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-1053");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "every-screen-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[375, 812], [768, 1024], [1280, 800]];
const LEGACY = ["btn", "btn-accent", "btn-outline", "muted", "overline", "lede", "choice-row", "form-card", "data-card", "pill", "queue-item"];

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

/** What is wrong with the Travel screen in sight, as lines (the sweep's measures, e2e/every-screen.spec.js). */
function findings(page, name, narrow) {
  return page.evaluate(({ name, narrow, legacy }) => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw) out.push(`${name}: sideways scroll`);
    const root = document.getElementById("travel");
    if (!root.classList.contains("ui-screen")) out.push(`${name}: not a .ui-screen`);
    const titles = [...root.querySelectorAll(".ui-screen__title")].filter((t) => t.getClientRects().length);
    if (titles.length !== 1) out.push(`${name}: ${titles.length} titles`);
    const shown = (el) => el.getClientRects().length && !el.closest("[hidden]");
    for (const el of root.querySelectorAll(legacy.map((c) => `.${c}`).join(","))) if (shown(el)) out.push(`${name}: legacy .${el.className}`);
    for (const el of root.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (shown(el) && r.width > 0 && (r.left < -1 || r.right > vw + 1)) out.push(`${name}: off screen ${el.tagName} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    if (!narrow) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !shown(el) || el.closest("[aria-hidden='true']")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${name}: ${f}px "${n.textContent.trim().slice(0, 30)}"`);
    }
    for (const el of root.querySelectorAll("button, a")) {
      const r = el.getBoundingClientRect();
      if (shown(el) && (r.width < 44 || r.height < 44)) out.push(`${name}: control ${Math.round(r.width)}x${Math.round(r.height)} "${el.textContent.trim().slice(0, 24)}"`);
    }
    return out;
  }, { name, narrow, legacy: LEGACY });
}

const STATES = [
  { kind: "local", check: async (page) => {
    await expect(page.locator("#travel .ui-screen__title")).toHaveText(/(^| \/\/ )Docking Approach$/);
    await expect(page.locator("#travel [data-role=travel-node]")).toHaveCount(2);
    await expect(page.locator("#travel [data-role=travel-node]").last()).toContainText("Luna Gateway");
    await expect(page.locator("#travel-progress")).toHaveAttribute("aria-valuenow", /^(2[0-9]|3[0-9])$/); // 10 of 40 minutes
    await expect(page.locator("#travel-eta")).toContainText("ETA");
  } },
  { kind: "interstellar", check: async (page) => {
    await expect(page.locator("#travel .ui-screen__title")).toHaveText(/(^| \/\/ )Jump In Progress$/);
    await expect(page.locator("#travel [data-role=travel-node]").first()).toContainText("Sol");
    await expect(page.locator("#travel [data-role=travel-node]").last()).toContainText("Alpha Centauri");
    await expect(page.locator("#travel-eta")).toContainText("ETA");
  } },
  { kind: "space", check: async (page) => {
    await expect(page.locator("#travel .ui-screen__title")).toHaveText(/(^| \/\/ )In Open Space$/);
    await expect(page.locator("#travel [data-role=travel-dock]").first()).toBeVisible();
    await expect(page.locator("#travel [data-role=travel-dock]", { hasText: "Earth Station Prime" })).toBeVisible();
  } }
];

for (const [width, height] of SIZES) {
  test(`the Travel screen's three states at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-travel-e2e-"));
    const emails = {};
    for (const { kind } of STATES) {
      emails[kind] = `travel-${kind}-${width}-${Date.now()}@example.test`;
      const run = spawnSync(process.execPath, ["e2e/seed-travel-account.mjs", dir, emails[kind], PASSWORD, kind], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
      if (run.status !== 0) throw new Error(`seed ${kind} failed: ${run.stdout}\n${run.stderr}`);
    }
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const found = [];
    try {
      await page.setViewportSize({ width, height });
      for (const { kind, check } of STATES) {
        await page.context().clearCookies();
        await page.goto(`${url}/login.html`);
        await page.evaluate(() => localStorage.clear());
        await page.fill("#login-email", emails[kind]);
        await page.fill("#login-password", PASSWORD);
        await page.click("#credential-login-btn");
        await page.waitForURL(/\/\?account=/);
        // Travel opens by itself in transit and in open space (app.js); opening it again is what a player would do.
        await openTab(page, "travel");
        await expect(page.locator("#travel")).toBeVisible();
        await check(page);
        found.push(...await findings(page, kind, width === 375));
        // AB#2495: the card at about three quarters of the main panel's width (a phone's 17.5rem floor aside), centred
        // both ways in a panel that fills the height the header leaves, and the panel draws no background of its own
        const box = await page.evaluate(() => {
          const r = (el) => el.getBoundingClientRect();
          const main = document.querySelector(".main-panel"), card = document.getElementById("travel");
          const m = r(main), c = r(card), header = r(document.querySelector(".app-header"));
          // AB#2468: what covers the top is the header on a desktop and the navigation's two fixed rows on a phone, where
          // the header is not shown; the panel fills what either leaves (the same number as before on a desktop).
          const topBars = [...document.querySelectorAll(".app-nav, .nav-group__tabs, .app-nav__menu")]
            .filter((el) => el.getClientRects().length && getComputedStyle(el).position === "fixed" && r(el).top < window.innerHeight / 2)
            .reduce((low, el) => Math.max(low, r(el).bottom), 0);
          const above = Math.max(header.height, topBars);
          return { ratio: c.width / m.width, dx: Math.abs((c.left - m.left) - (m.right - c.right)), dy: Math.abs((c.top - m.top) - (m.bottom - c.bottom)),
            fills: m.bottom >= window.innerHeight - above - 64 || m.height > window.innerHeight, card: c.height, panel: m.height,
            bg: getComputedStyle(main).backgroundColor, floor: 17.5 * parseFloat(getComputedStyle(document.documentElement).fontSize) };
        });
        if (width >= 768) expect(box.ratio).toBeCloseTo(0.75, 2);
        else expect(box.ratio).toBeLessThan(1);
        expect(box.dx).toBeLessThanOrEqual(1);
        if (box.card < box.panel) expect(box.dy).toBeLessThanOrEqual(1);
        expect(box.fills).toBe(true);
        expect(box.bg).toBe("rgba(0, 0, 0, 0)");
        await page.locator("#travel").scrollIntoViewIfNeeded();
        await page.mouse.move(width - 2, height - 2); // the click on the tab leaves the pointer hovering the navigation
        await page.screenshot({ path: path.join(SHOT_DIR, `travel-${kind}-${width}x${height}.png`) });
      }
    } finally {
      child.kill();
    }
    expect(found).toEqual([]);
    expect(errors).toEqual([]);
  });
}
