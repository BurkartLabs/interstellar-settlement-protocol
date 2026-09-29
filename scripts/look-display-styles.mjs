// scripts/look-display-styles.mjs, AB#4880: look at the game in each display style. Seeds a busy corporation (the
// facelift sweep's seeds), signs in, and for each style shoots the first screenful of the main screens at 1440x900 and
// two at 390x844, into e2e/screenshots/ab-4880/<style>/ (gitignored). Beside the pictures it records, per screen:
//   - sideways scroll and the shared findings (e2e/screenFindings.mjs);
//   - "hidden": text that is on screen in the game's own look and gone in the style. A style may change how the game
//     looks and is laid out, never what it says (docs/design/DISPLAY_STYLES.md), so this should always be empty.
// A script, not a spec: it looks and records and fails nothing. Findings go to e2e/screenshots/ab-4880/<style>/findings.json.
//
// Run: node scripts/look-display-styles.mjs [style ...]   (no arguments: every style). It starts its own server.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "../e2e/nav.mjs";
import { findings } from "../e2e/screenFindings.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4880");
const SECRET = "display-styles-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const DESK = { width: 1440, height: 900, tabs: ["overview", "station", "market", "finance", "rnd"] };
const PHONE = { width: 390, height: 844, tabs: ["overview", "market"] };

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

/** The text in sight in the open tab and the shell: each visible leaf element's own words. */
function visibleText(page, tab) {
  return page.evaluate((tab) => {
    const shown = (el) => {
      if (!el.getClientRects().length || el.closest("[hidden]")) return false;
      for (let a = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.visibility === "hidden" || s.opacity === "0" || s.display === "none") return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const scopes = [document.querySelector(".app-header"), document.querySelector(".app-nav"), document.getElementById(tab)].filter(Boolean);
    const words = new Set();
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll("*")) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
        if (own && shown(el)) words.add(own.toLowerCase());
      }
    }
    return [...words];
  }, tab);
}

async function setStyle(page, id) {
  await page.evaluate((id) => new Promise((resolve) => {
    if ((document.documentElement.getAttribute("data-theme") || "") === id) return resolve();
    document.addEventListener("isp:display-style", () => resolve(), { once: true });
    window.ispDisplayStyles.apply(id);
  }), id);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

const all = await (async () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "public", "scripts", "displayStyles.js"), "utf8");
  return [...src.matchAll(/\{ id: "([a-z0-9-]+)"/g)].map((m) => m[1]);
})();
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;
const unknown = wanted.filter((w) => !all.includes(w) && w !== "default");
if (unknown.length) throw new Error(`unknown style(s): ${unknown.join(", ")}; known: ${all.join(", ")}`);

fs.mkdirSync(OUT, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-display-styles-"));
const email = `styles-${Date.now()}@example.test`;
seed(["e2e/seed-industry-account.mjs", email, PASSWORD], dir);
seed(["e2e/seed-company-station.mjs", email], dir);
const { child, url } = await startServer(dir);
const browser = await chromium.launch();
// one findings file per style, so looks at different styles can run at the same time
const read = (id) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, id, "findings.json"), "utf8")); } catch { return {}; } };
const report = Object.fromEntries(wanted.filter((w) => w !== "default").map((id) => [id, {}]));
try {
  for (const view of [DESK, PHONE]) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click("#credential-login-btn");
    await page.waitForURL(/\/\?account=/);
    await page.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 });
    const skip = page.getByRole("button", { name: "I'll find my own way" });
    if (await skip.isVisible().catch(() => false)) await skip.click();

    // the game's own look first: what every style is compared with
    const baseline = {};
    await setStyle(page, "");
    for (const tab of view.tabs) {
      await openTab(page, tab);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(300);
      baseline[tab] = await visibleText(page, tab);
      if (wanted.includes("default")) {
        fs.mkdirSync(path.join(OUT, "default"), { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(OUT, "default", `${tab}-${view.width}.png`) });
      }
    }
    for (const id of wanted.filter((w) => w !== "default")) {
      fs.mkdirSync(path.join(OUT, id), { recursive: true });
      await setStyle(page, id);
      const entry = Object.assign(report[id], view === DESK ? {} : read(id));
      for (const tab of view.tabs) {
        await openTab(page, tab);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(300);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(OUT, id, `${tab}-${view.width}.png`) });
        const found = await findings(page, tab, view.width === 390 ? 375 : view.width, `#${tab}`);
        const now = new Set(await visibleText(page, tab));
        const hidden = baseline[tab].filter((w) => !now.has(w));
        entry[`${tab}-${view.width}`] = { findings: found, hidden };
      }
      // the choice survives a reload
      await page.reload();
      await page.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 });
      entry[`persisted-${view.width}`] = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      entry[`errors-${view.width}`] = errors.splice(0);
      const f = Object.entries(entry).filter(([k, v]) => v && typeof v === "object" && !Array.isArray(v));
      const issues = f.reduce((n, [, v]) => n + v.findings.length + v.hidden.length, 0);
      fs.writeFileSync(path.join(OUT, id, "findings.json"), JSON.stringify(entry, null, 1));
      console.log(`${id} @${view.width}: ${issues} finding(s)${entry[`persisted-${view.width}`] === id ? "" : ", NOT persisted"}${entry[`errors-${view.width}`].length ? `, ${entry[`errors-${view.width}`].length} page error(s)` : ""}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  child.kill();
}
console.log(`screenshots in ${path.relative(REPO_ROOT, OUT)}/<style>/, findings in <style>/findings.json`);
