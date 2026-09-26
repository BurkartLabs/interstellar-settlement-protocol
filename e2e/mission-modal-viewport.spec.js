// Bug AB#1832: a contract's briefing opened above the screen. #mission-detail-modal was fixed to the Assignments panel
// (its .tab-panel's backdrop-filter made the panel the containing block), so with the page scrolled down to the
// contract list the player saw a dimmed list and no briefing or Accept button. This opens a briefing from a scrolled
// page, as a player does, and measures the dialog against the viewport. The markup rule is
// tests/unit/fixedOutsideMain.test.js.
//
// Run: `npx playwright test e2e/mission-modal-viewport.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "briefing-e2e-fixture-secret-0123456789ab";

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

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

for (const viewport of VIEWPORTS) {
  test(`a contract's briefing opens on screen from a scrolled page at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `briefing-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-briefing-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-contractor-account.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-contractor-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);

      await openTab(page, "missions");
      await page.locator("[data-agent-id]").first().click();
      const offered = page.locator("#agent-mission-list [data-mission-id]").first();
      // ISP-81 (AB#770): the rebuilt office is shorter, and at 1280 the list is nearly above the fold; scrolling it to the
      // top of the screen, as a player reading down to it does, keeps the page scrolled whatever the office measures.
      await offered.evaluate((el) => el.scrollIntoView({ block: "start" }));
      // The bug only shows from a scrolled page; if the list ever fits above the fold, this check is not testing it.
      expect(await page.evaluate(() => window.scrollY), "page scrolled to the contract list").toBeGreaterThan(100);
      await offered.click();

      const modal = page.locator("#mission-detail-modal");
      await expect(modal).toBeVisible();
      const box = await page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        return { card: r("#mission-detail-modal .modal-card"), accept: r("#mission-accept-btn"), innerHeight: window.innerHeight };
      });
      expect(box.card.top, "briefing's top edge on screen").toBeGreaterThanOrEqual(0);
      expect(box.card.top, "briefing's top edge on screen").toBeLessThan(box.innerHeight);
      await page.locator("#mission-accept-btn").scrollIntoViewIfNeeded();
      await expect(page.locator("#mission-accept-btn")).toBeInViewport();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab1832-briefing-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
