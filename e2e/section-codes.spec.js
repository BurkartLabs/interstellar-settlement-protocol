// ISP-248 (AB#944): the document-code section header on three screens, from the running game at 1280x800 and 375x812:
// the Financial Core (static panels), the Galactic Exchange (many sections) and the Station (a title a view draws). The
// code shows before each title, filled from the registry, and every heading's accessible name is its plain words
// (Playwright's accessibility snapshot). Starts its own server on a seeded data dir (e2e/seed-idle-refinery.mjs).
//
// Run: npx playwright test e2e/section-codes.spec.js (no server needed). Screenshots: e2e/screenshots/ab-944/ (ignored by
// git, AB#2251); the PR's copies are in docs/ab-944.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-944");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "section-codes-e2e-fixture-secret-012345678";
const R = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "section-codes.json"), "utf8"));
const code = (id) => [...R.screens, ...R.sections].find((e) => e.id === id).code;

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
    child.on("exit", (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out}`)); });
  });
}

/** Each screen: its tab, its title, the plain words, and one section whose heading is checked the same way. */
const SCREENS = [
  { tab: "finance", title: "#finance .ui-screen__title", plain: "Financial Control Board", section: { id: "finance-cash-reserves", heading: "#finance-cash-reserves h3", plain: "Cash Reserves" } },
  { tab: "market", title: "#market .ui-screen__title", plain: "Galactic Exchange", section: { id: "exchange-sell-section", heading: "#exchange-sell-section .ui-panel__title", plain: "Sell orders" } },
  { tab: "station", title: "#station .ui-screen__title", plain: null, section: { id: "station-construction-section", heading: "#station-construction-section h3", plain: "Construction" } }
];

for (const vp of [{ label: "1280", width: 1280, height: 800, mobile: false }, { label: "375", width: 375, height: 812, mobile: true }]) {
  test(`the document-code headers at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-codes-e2e-"));
    const email = `codes-${Date.now()}-${vp.width}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-idle-refinery.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await expect(page.locator('h1 [data-code-for="login"]')).toHaveText(`${code("login")} // `); // a signed-out page too
      await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Protocol Access Gate");
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      for (const s of SCREENS) {
        await openTab(page, s.tab);
        const title = page.locator(s.title).first();
        await expect(title.locator(".ui-code")).toHaveText(`${code(s.tab)} // `, { timeout: 10_000 });
        const plain = s.plain ?? (await title.textContent()).replace(`${code(s.tab)} // `, "").trim();
        // The accessibility snapshot: the heading is its plain title, the code is not in it.
        await expect(title).toMatchAriaSnapshot(`- heading "${plain}"`);
        await expect(title).toHaveAccessibleName(plain);
        const heading = page.locator(s.section.heading).first();
        await expect(heading).toContainText(`${code(s.section.id)} // ${s.section.plain}`);
        await expect(heading).toHaveAccessibleName(s.section.plain);
        await title.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -100));
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(wide, `${s.tab} scrolls sideways`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: path.join(SHOT_DIR, `${s.tab}-${vp.label}.png`) });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
