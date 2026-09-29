// scripts/facelift-sweep.mjs, ISP-245 (AB#941): every screen of the game at 375x812, 768x1024 and 1280x800, for the v1.0 facelift inventory
// (docs/design/FACELIFT_INVENTORY.md). The pages before play; every tab the navigation offers; each tab's subpages
// (the Station's, the Exchange's, a conglomerate's own tabs); and every building the Station opens, for a busy
// corporation that founded a conglomerate and has a fleet (e2e/seed-industry-account.mjs, then
// e2e/seed-company-station.mjs, as ISP-250's audit uses). On each screen at each width it records, without failing:
//   - the shared findings (e2e/screenFindings.mjs): sideways scroll, boxes off screen, words wider than their control,
//     legacy components, and at 375 text under 14px and controls under 44px;
//   - what is off the design system (ISP-25): style rules applied on the screen that set a colour, font or shadow
//     without a token (a raw #hex, rgb(), px size or font family), controls not built from its components (a
//     <button> without .ui-button, an <input> without .ui-input, a <select> without .ui-select, a <table> without
//     .ui-table), and inline styles that set a colour or font.
// Screenshots go to e2e/screenshots/ab-941/ (gitignored), and the findings to e2e/screenshots/ab-941/inventory.json;
// scripts/facelift-inventory.mjs turns both into the contact sheets and the inventory. A script, not a spec: it looks
// and records and fails nothing, and a spec may not write files (tests/unit/e2eNoSourceWrites.test.js).
//
// Run: `npm run look:facelift` (this, then the sheets and the inventory). It starts its own servers.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab, openStationOffices } from "../e2e/nav.mjs";
import { findings } from "../e2e/screenFindings.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-941");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "facelift-inventory-fixture-secret-0123456";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[375, 812], [768, 1024], [1280, 800]];
const PAGES = [["landing", "/"], ["login", "/login.html"], ["register", "/register.html"], ["forgot-password", "/forgot-password.html"], ["reset-password", "/reset-password.html"], ["check-email", "/check-email.html"], ["verify-email", "/verify-email.html"], ["how-to-start", "/how-to-start.html"]];
const SHELL = ".app-header, .layout-grid > aside, .nav-bar, .nav-groups";

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}
function seed(args, dir) {
  const run = spawnSync(process.execPath, [args[0], dir, ...args.slice(1)], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (run.status !== 0) throw new Error(`${args[0]} failed: ${run.stdout}\n${run.stderr}`);
}

/** What on the screen in sight is off the design system (ISP-25): raw-valued rules applied, bare controls, inline styles. */
function offSystem(page, scope) {
  return page.evaluate(({ scope }) => {
    const shown = (el) => el.getClientRects().length && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden";
    const roots = [...document.querySelectorAll(scope)].filter(shown);
    const inScope = (el) => roots.some((r) => r.contains(el));
    const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}`;
    // a value set without a token: a colour, a font size or family, or a shadow written out rather than var(--…)
    const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
    const PROPS = /^(color|background|background-color|border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|box-shadow|text-shadow|fill|stroke|font-size|font-family|font)$/;
    const rawValue = (prop, value) => {
      const v = value.replace(/var\([^)]*\)/g, "");
      if (/^font-size$/.test(prop)) return /\d(px|rem|em)\b/.test(v);
      if (/^font-family$/.test(prop)) return v.trim() !== "" && !/^(inherit|initial|unset)$/.test(v.trim());
      return RAW_COLOUR.test(v);
    };
    const tokens = new Set();
    const rules = [];
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; } // @media, @supports
        if (!rule.selectorText || /(^|,)\s*(:root|html|\[data-theme)/.test(rule.selectorText)) continue;
        const bad = [];
        for (let i = 0; i < rule.style.length; i += 1) {
          const prop = rule.style[i];
          if (PROPS.test(prop) && rawValue(prop, rule.style.getPropertyValue(prop))) bad.push(`${prop}: ${rule.style.getPropertyValue(prop).trim()}`);
        }
        if (bad.length) rules.push({ selector: rule.selectorText, bad });
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* another origin's sheet */ } }
    for (const r of rules) {
      let hit = null;
      try { hit = [...document.querySelectorAll(r.selector)].find((el) => shown(el) && inScope(el)); } catch { continue; }
      if (hit) tokens.add(`${r.selector} { ${r.bad.join("; ")} }`);
    }
    const components = new Set();
    const bare = [
      ["button:not(.ui-button):not(.ui-tab):not(.nav-tab):not(.nav-group__button)", "a <button> without .ui-button"],
      ["input:not(.ui-input):not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=range])", "an <input> without .ui-input"],
      ["select:not(.ui-select)", "a <select> without .ui-select"],
      ["textarea:not(.ui-textarea):not(.ui-input)", "a <textarea> without .ui-textarea"],
      ["table:not(.ui-table)", "a <table> without .ui-table"]
    ];
    for (const [sel, what] of bare) for (const el of document.querySelectorAll(sel)) if (shown(el) && inScope(el)) components.add(`${what}: ${label(el)}`);
    const inline = new Set();
    for (const el of document.querySelectorAll("[style]")) {
      if (!shown(el) || !inScope(el)) continue;
      const s = el.getAttribute("style");
      if (/(^|;)\s*(color|background|font|border-color|box-shadow)\s*:/.test(s) && !/^\s*(--[\w-]+\s*:[^;]*;?\s*)+$/.test(s)) inline.add(`${label(el)} style="${s.slice(0, 80)}"`);
    }
    return { tokens: [...tokens], components: [...components], inline: [...inline] };
  }, { scope });
}

const results = {}; // screen -> width -> source -> { findings, offSystem, shot }
const save = () => fs.writeFileSync(path.join(SHOT_DIR, "inventory.json"), JSON.stringify(results, null, 1));

/**
 * The seeds whose worlds fill the screens added in v0.6 to v0.13: each prints its logins as JSON, and the sweep signs
 * in as the first. The base pass (seed-industry-account + seed-company-station) covers every screen at every width;
 * these show the same screens with their records in them (raids, bonds, loans, equity, cases, patents, concessions,
 * conglomerate levels, Tier 4).
 */
const CONTENT = [
  ["raids", ["e2e/seed-raids.mjs", PASSWORD]],
  ["bond-board", ["e2e/seed-bond-board.mjs", PASSWORD]],
  ["loan-board", ["e2e/seed-loan-board.mjs", PASSWORD]],
  ["stock-exchange", ["e2e/seed-stock-exchange.mjs", PASSWORD]],
  ["arbitration", ["e2e/seed-arbitration.mjs", PASSWORD]],
  ["patents", ["e2e/seed-patents.mjs", PASSWORD]],
  ["concessions", ["e2e/seed-concessions.mjs", PASSWORD]],
  ["conglomerate-level", ["e2e/seed-conglomerate-level.mjs", PASSWORD]]
];

/** Sign in as `email` and look at every screen: tabs, their subpages, the Station's buildings, a facility. */
async function sweep(page, url, email, width, source, { pages = false } = {}) {
  const look = async (name, scope, { fullPage = true } = {}) => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300);
    const found = await findings(page, name, width, scope);
    const off = await offSystem(page, scope);
    const shot = `${name}-${width}${source === "base" ? "" : `@${source}`}.png`;
    const view = shot.replace(/\.png$/, "-view.png");
    (((results[name] ||= {})[width] ||= {}))[source] = { findings: found.map((x) => x.replace(`${name}: `, "")), offSystem: off, shot, view };
    // the first screenful as a player sees it, for the contact sheets: a full-page shot draws the sticky header where the
    // page was scrolled to, not at the top (AB#894), so the sheet uses a viewport shot from the top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150); // the sticky header repaints after the jump; two phone shots lost it without the wait
    await page.screenshot({ path: path.join(SHOT_DIR, view) });
    await page.screenshot({ path: path.join(SHOT_DIR, shot), fullPage });
  };
  if (pages) {
    for (const [name, route] of PAGES) {
      await page.goto(`${url}${route}`);
      await look(`page-${name}`, "body");
    }
  }
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  await page.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 });
  const skip = page.getByRole("button", { name: "I'll find my own way" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await look("shell", SHELL, { fullPage: false });

  const tabs = await page.locator(".nav-tab[data-tab]").evaluateAll((els) => els.filter((e) => !e.hidden).map((e) => e.getAttribute("data-tab")));
  for (const tab of tabs) {
    await openTab(page, tab);
    if (!(await page.locator(`#${tab}`).isVisible().catch(() => false))) continue;
    await look(tab, `#${tab}`);
    // the tab's own subpages: a tab bar inside the screen (the Station's, the Exchange's, the Inbox's…)
    const subs = page.locator(`#${tab} [role=tablist] [role=tab], #${tab} [data-role="cong-tab"]`);
    const n = await subs.count();
    for (let i = 1; i < n; i += 1) { // the first is the page already looked at
      const t = subs.nth(i);
      if (!(await t.isVisible().catch(() => false))) continue;
      const id = (await t.getAttribute("data-subpage")) || (await t.getAttribute("data-tab")) || (await t.getAttribute("data-subtype"))
        || ((await t.textContent()) || "").trim().toLowerCase().replace(/\(\d+\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || String(i);
      await t.click();
      await look(`${tab}--${id.replace(/^.*-tab-/, "").replace(/^finance-subtab-/, "")}`, `#${tab}`);
    }
    if (n > 1) await subs.first().click().catch(() => {});
  }

  // every building the Station opens, one at a time, and back
  await openTab(page, "station");
  await openStationOffices(page);
  const actions = await page.locator('#station-npc-buildings [data-building-action^="building:"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-building-action")));
  for (const action of actions) {
    await openTab(page, "station");
    await openStationOffices(page);
    await page.locator(`#station-npc-buildings [data-building-action="${action}"]`).click();
    await page.waitForTimeout(300);
    if (!(await page.locator("#station-building-view").isVisible())) continue; // one that opens a tab is looked at there
    await look(`building-${action.slice(9)}`, "#station-building-view");
    await page.locator("#station-back-btn").click();
  }
  // the corporation's own facilities (the Assembly Facility's view)
  await openTab(page, "station");
  const enter = page.locator('[data-corp-building="Assembly Facility"]');
  if (await enter.isVisible().catch(() => false)) {
    await enter.click();
    await page.waitForTimeout(300);
    if (await page.locator("#station-building-view").isVisible()) await look("facility-assembly", "#station-building-view");
  }
}

const browser = await chromium.launch();
for (const [width, height] of SIZES) {
  {
    console.log(`every screen at ${width}x${height}`);
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-facelift-e2e-"));
    const email = `facelift-${width}-${Date.now()}@example.test`;
    seed(["e2e/seed-industry-account.mjs", email, PASSWORD], dir);
    seed(["e2e/seed-company-station.mjs", email], dir);
    // an Assembly Facility, so its view is looked at too
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", `
      process.env.ISP_DATA_DIR = ${JSON.stringify(dir)}; process.env.NODE_ENV = "test";
      const store = await import("./server/gameState.js");
      const { accountsStore } = await import("./server/game/store.js");
      const a = Object.values(accountsStore.accounts).find((x) => x.email === ${JSON.stringify(email)});
      store.mutateAccountState(a.id, (s) => {
        s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), "tt-assembly-fabrication"])];
        if (!(s.corp.buildings || []).some((b) => b.name === "Assembly Facility")) s.corp.buildings = [...(s.corp.buildings || []), { name: "Assembly Facility", tier: 1, status: "Operational" }];
        s.corp.buildingSlots = Math.max(Number(s.corp.buildingSlots) || 0, (s.corp.buildings || []).length + 2);
      }, { sanitize: false, settleMining: false });
      await store.saveAccountsNow();`], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (run.status !== 0) throw new Error(`facility seed failed: ${run.stdout}\n${run.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await sweep(page, url, email, width, "base", { pages: true });
    } finally {
      child.kill();
      await context.close();
      save();
    }
    if (errors.length) console.log(`  page errors at ${width}:\n  ${errors.join("\n  ")}`);
  }
}

// the same screens with their v0.6 to v0.13 records in them, at the narrowest and widest width
for (const [source, args] of CONTENT) {
  {
    console.log(`every screen with ${source}'s records, at 375 and 1280`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `isp-facelift-${source}-`));
    const run = spawnSync(process.execPath, [args[0], dir, ...args.slice(1)], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (run.status !== 0) throw new Error(`${args[0]} failed: ${run.stdout}\n${run.stderr}`);
    const logins = JSON.parse(run.stdout.trim().split("\n").at(-1));
    const email = typeof logins === "string" ? logins : Object.values(logins)[0];
    const { child, url } = await startServer(dir);
    try {
      for (const [width, height] of [SIZES[0], SIZES[2]]) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        try { await sweep(page, url, email, width, source); } finally { await context.close(); }
      }
    } finally {
      child.kill();
      save();
    }
  }
}
await browser.close();
console.log(`${Object.keys(results).length} screens recorded in ${path.relative(REPO_ROOT, path.join(SHOT_DIR, "inventory.json"))}`);
