// ISP-250 (AB#946): the Company and Station screens added since v0.5, held to the design system at 375x812, 768x1024
// and 1280x800. The inventory v1.0-01 (ISP-245, AB#941) was to provide does not exist yet, so this spec is it: every tab
// of the Company group (Overview, Inbox, Financial Core, CEO Insight, Assignments, Conglomerate and its own tabs) and the
// Station group (Station, Fleet), and every building the Station opens, for a busy corporation that founded a
// conglomerate and has a fleet (e2e/seed-industry-account.mjs, then e2e/seed-company-station.mjs). On each: the shared
// checks (e2e/screenFindings.mjs: sideways scroll; at 375 text under 14px and controls under 44px; legacy components)
// and the bureaucratic voice's header (docs/design/BUREAUCRATIC_UI.md): every titled section carries its document
// code from the registry. Findings are gathered for the whole run and listed together. Screenshots go to
// e2e/screenshots/ab-946/ (gitignored; the pull request's are copied to docs/ab-946/).
//
// Run: `npx playwright test e2e/company-station-screens.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gameDrawn, openStationOffices, openTab } from "./nav.mjs";
import { findings } from "./screenFindings.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-946");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "company-station-e2e-fixture-secret-012345";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[375, 812], [768, 1024], [1280, 800]];
const TABS = ["overview", "inbox", "finance", "ceo", "missions", "conglomerate", "station", "fleet"];
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

/** Titled sections in sight under `scope` whose title has no filled document code (BUREAUCRATIC_UI.md, the header). */
function uncoded(page, name, scope) {
  return page.evaluate(({ name, scope }) => {
    const out = [];
    const shown = (el) => el && el.getClientRects().length && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden";
    const coded = (title) => [...title.querySelectorAll(".ui-code")].some((c) => c.textContent.trim());
    for (const root of document.querySelectorAll(scope)) {
      if (!shown(root)) continue;
      const titles = new Set();
      // a titled section is the registry test's (tests/unit/sectionCodes.test.js): a <section> with an aria-labelledby
      // target or its own first heading; a card or a row is not one (one code per section, BUREAUCRATIC_UI.md)
      for (const s of root.querySelectorAll("section:not(.ui-card)")) { // a card is not a section, even as a <section>
        if (!shown(s)) continue;
        const by = s.getAttribute("aria-labelledby");
        const t = (by && document.getElementById(by.split(" ")[0])) || [...s.querySelectorAll("h2, h3, h4, h5")].find((h) => h.closest("section") === s);
        if (t && shown(t)) titles.add(t);
      }
      for (const t of root.querySelectorAll(".ui-screen__title, .station__building-title")) if (shown(t)) titles.add(t);
      for (const t of titles) if (!coded(t)) out.push(`${name}: no code on "${t.textContent.trim().slice(0, 40)}"`);
    }
    return [...new Set(out)];
  }, { name, scope });
}

for (const [width, height] of SIZES) {
  test(`the Company and Station screens at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(300_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-company-station-e2e-"));
    const email = `company-station-${width}-${Date.now()}@example.test`;
    seed(["e2e/seed-industry-account.mjs", email, PASSWORD], dir);
    seed(["e2e/seed-company-station.mjs", email], dir);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const found = [];
    const look = async (name, scope) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      found.push(...await findings(page, name, width, `${scope}, ${SHELL}`), ...await uncoded(page, name, scope));
      await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });
    };
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await gameDrawn(page);

      for (const tab of TABS) {
        await openTab(page, tab);
        await expect(page.locator(`#${tab}`)).toBeVisible();
        if (tab === "conglomerate") {
          await expect(page.locator('#conglomerate [data-role="cong-body"]')).toBeVisible({ timeout: 15_000 });
          const hqTabs = page.locator('#conglomerate [data-role="cong-tab"]');
          const n = await hqTabs.count();
          for (let i = 0; i < n; i += 1) {
            const t = hqTabs.nth(i);
            const id = await t.getAttribute("data-tab");
            await t.click();
            await look(`conglomerate-${id}`, "#conglomerate");
          }
          if (!n) await look("conglomerate", "#conglomerate");
          continue;
        }
        await look(tab, `#${tab}`);
      }

      // every building the Station opens, one at a time, and back
      await openTab(page, "station");
      const actions = await page.locator('#station-npc-buildings [data-building-action^="building:"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-building-action")));
      for (const action of actions) {
        await openTab(page, "station");
        await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
        await page.locator(`#station-npc-buildings [data-building-action="${action}"]`).click();
        await page.waitForTimeout(300);
        if (!(await page.locator("#station-building-view").isVisible())) continue; // a building that opens a tab (the Bureau opens Assignments), audited there
        await look(`building-${action.slice(9)}`, "#station-building-view");
        await page.locator("#station-back-btn").click();
      }
    } finally {
      child.kill();
    }
    await test.info().attach(`findings-${width}x${height}`, { body: found.join("\n") || "none", contentType: "text/plain" });
    expect(found, "every Company and Station screen on the design system (AB#946)").toEqual([]);
    expect(errors).toEqual([]);
  });
}
