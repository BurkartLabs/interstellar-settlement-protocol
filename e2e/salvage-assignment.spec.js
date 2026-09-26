// ISP-298 (AB#1791, v0.5 release gate): a broke, idle corporation is told about the Salvage Assignment on
// Overview — the first screen it sees — rather than left to find Assignments unprompted (T-078), and
// Assignments itself shows a countdown while the contract runs. Acceptance asks for screenshots of both at
// 1440 and 375 wide, from the running game, following ISP-297 (AB#1789)'s server implementation.
//
// Reaching "broke, with the Assignment already accepted an hour ago" by play means grinding down to 0 credits
// and then waiting a real hour — disproportionate to a display story. The fixture below (e2e/seed-salvage-
// account.mjs) seeds both scenarios directly via mutateAccountState(), the same mechanism every integration
// test already uses, and the real salvageAssignmentOffer() shape rather than a hand-typed guess at it. Nothing
// about the mechanism under test is faked from there on: the account logs in over real HTTP, the countdown and
// the Overview card are read off the live page, and the server is a real, separate `node server/index.js`
// process reading that fixture from disk at boot, the same as a real restart.
import { acknowledgeReceipt } from "./receipt.mjs"; // AB#743, AB#744
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

const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "375x812", width: 375, height: 812 }
];

const FIXTURE_PASSWORD = "playtest-password-not-real";

/** Same as e2e/first-hour.spec.js's assertNoHorizontalScroll(): at the phone width, no screen may scroll sideways. */
async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.scrollWidth, "document.scrollingElement.scrollWidth <= innerWidth").toBeLessThanOrEqual(overflow.innerWidth);
}

/** Same shape as e2e/first-hour.spec.js's shoot(): grow to the page's own height for one capture, no stitching. */
async function shoot(page, viewportLabel, stepId, width) {
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, `${stepId}-${viewportLabel}.png`) });
  await page.setViewportSize({ width, height: VIEWPORTS.find((v) => v.width === width).height });
}

function seedAccount(dataDir, email, mode) {
  const result = spawnSync(process.execPath, ["e2e/seed-salvage-account.mjs", dataDir, email, FIXTURE_PASSWORD, mode], {
    cwd: REPO_ROOT, encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`seed-salvage-account.mjs failed: ${result.stdout}\n${result.stderr}`);
}

/** Starts `node server/index.js` on `dir` and resolves with its URL once it listens (data-dir.test.js's pattern). */
function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: "salvage-e2e-fixture-secret-0123456789ab", ISP_DEV: "" },
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
  test(`Overview surfaces the Salvage Assignment while broke and idle, at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `salvage-offered-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-salvage-e2e-"));
    seedAccount(dir, email, "offered");
    const { child, url } = await startServer(dir);
    const mobile = viewport.width < 600;

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", FIXTURE_PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await expect(page.locator("#dialogue-modal")).toBeHidden();

      // ── Overview (the default tab) names the Assignment and links to it ────────────────────────────────
      const salvageCard = page.locator("#overview-cards .data-card", { hasText: "ISA Salvage Assignment" });
      await expect(salvageCard).toBeVisible();
      await expect(salvageCard).toContainText("Available");
      if (mobile) await assertNoHorizontalScroll(page);
      await shoot(page, viewport.label, "01-overview-broke", viewport.width);

      // ── it actually links to Assignments ────────────────────────────────────────────────────────────────
      await salvageCard.click();
      await expect(page.locator('.nav-tab[data-tab="missions"]')).toHaveClass(/active/);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`Assignments shows the Salvage Assignment's running countdown, at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `salvage-active-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-salvage-e2e-"));
    seedAccount(dir, email, "active");
    const { child, url } = await startServer(dir);
    const mobile = viewport.width < 600;

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", FIXTURE_PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await expect(page.locator("#dialogue-modal")).toBeHidden();

      await openTab(page, "missions");
      await expect(page.locator('.nav-tab[data-tab="missions"]')).toHaveClass(/active/);

      // ── one hour in of four: a countdown, not a Complete button yet ────────────────────────────────────
      const activeCard = page.locator(".mission-card--active", { hasText: "ISA Salvage Assignment" });
      await expect(activeCard).toBeVisible();
      const countdown = activeCard.locator("[data-salvage-countdown]");
      await expect(countdown).toBeVisible();
      await expect(countdown).toContainText(/remaining/);
      await expect(activeCard.locator("[data-complete-mission]")).toHaveCount(0);
      await expect(activeCard.locator("[data-abandon-mission]")).toHaveCount(0);
      if (mobile) await assertNoHorizontalScroll(page);
      await shoot(page, viewport.label, "02-assignments-countdown", viewport.width);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`completing it once elapsed pays the flat amount and clears the countdown, at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `salvage-ready-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-salvage-e2e-"));
    seedAccount(dir, email, "ready");
    const { child, url } = await startServer(dir);

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", FIXTURE_PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await expect(page.locator("#dialogue-modal")).toBeHidden();

      await openTab(page, "missions");
      const activeCard = page.locator(".mission-card--active", { hasText: "ISA Salvage Assignment" });
      await expect(activeCard).toBeVisible();
      await expect(activeCard.locator("[data-salvage-countdown]")).toHaveCount(0);

      const completeBtn = activeCard.locator("[data-complete-mission]");
      await expect(completeBtn).toBeVisible();
      await completeBtn.click();
      await expect(page.locator("#feedback-log li").first()).toContainText(/\$3,000 credited/, { timeout: 10_000 });
      await expect(page.locator(".mission-card--active", { hasText: "ISA Salvage Assignment" })).toHaveCount(0);

      // AB#744: the completion is confirmed by the ISA receipt, with the flat payout the server paid.
      await expect(page.locator("#action-receipt-title")).toHaveText("Contract Completed", { timeout: 10_000 });
      await expect(page.locator("#action-receipt-body")).toContainText("3,000 credits");
      await acknowledgeReceipt(page);
      await expect(page.locator(".mission-complete-overlay")).toHaveCount(0);

      await openTab(page, "overview");
      await expect(page.locator("#overview-cards .data-card", { hasText: "Cash Reserves" })).toContainText("$3,000");
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
