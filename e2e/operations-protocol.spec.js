// ISP-254 Bd (AB#4819): Operations' statuses and messages with their protocol line, on the running page at 1280. A
// fresh corporation takes a mining lease, commissions a yard and starts and stops a cycle through the page, as a player
// does; a seeded one (e2e/seed-belt-panel.mjs: a probe but 100 credits) has a launch refused in the belt panel. Each
// check reads the plain words first and the guide's phrase and code after them. docs/ab-4819 holds the screenshots.
//
// Run: `npx playwright test e2e/operations-protocol.spec.js` (it starts its own servers).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab, openStationOffices, openMiningCycles } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import { verificationToken } from "./verification.mjs";
import { beltCentre, openSystem, recordCanvas } from "./starmapCanvas.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "operations-protocol-e2e-fixture-secret-0123";

function startServer(dir, dev) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: dev ? "1" : "", ISP_DISABLE_TICKERS: "1" },
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

async function logIn(page, url, email) {
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });
}

const shot = async (locator, name) => {
  await locator.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`) });
  await test.info().attach(name, { body: await locator.screenshot(), contentType: "image/png" });
};

test("a lease, a yard and a cycle carry their protocol lines, at 1280x800", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-ops-protocol-e2e-"));
  const { child, url } = await startServer(dir, true);
  try {
    const email = `ops-protocol-${Date.now()}@example.test`;
    await page.request.post(`${url}/api/auth/register`, { data: { email, password: PASSWORD, ceoName: "Protocol QA", corpName: `Protocol Corp ${Date.now() % 100000}` } });
    await page.request.post(`${url}/api/auth/verify-email`, { data: { token: await verificationToken(page.request, url, email) } });
    await page.setViewportSize({ width: 1280, height: 800 });
    await logIn(page, url, email);
    await page.getByRole("button", { name: "I'll find my own way" }).click();

    await openTab(page, "station");
    await openStationOffices(page);
    await page.click('[data-building-action="building:orbital-executive-suites"]');
    await page.selectOption("#rent-office-duration", "7");
    await page.click("#rent-office-btn");
    await acknowledgeReceipt(page);
    await page.fill("#office-hire-count", "5");
    await page.click('#office-hire-form button[type="submit"]');
    await acknowledgeReceipt(page);
    await page.click("#station-back-btn");
    await openStationOffices(page);
    await page.click('[data-building-action="building:isa-claims-leases"]');
    await page.click('[data-action="purchase-lease"][data-body="Earth"]');
    await acknowledgeReceipt(page);
    await page.click('[data-action="manage-lease"]');
    await page.click("#lease-build-extractor-btn");
    await acknowledgeReceipt(page);

    // Start a cycle: the yard's badge says Active, then In force and the lease's code
    await page.click('[data-form="mine"] button[type="submit"]');
    await acknowledgeReceipt(page);
    const yard = page.locator(".extractor").first();
    await expect(yard.locator(".extractor__header")).toContainText(/Active\s*In force\s*\/\/ ISA-REG-10/i);
    await shot(yard, "ab4819-1-yard-active");

    // The notifications: the plain title and body, then the protocol line
    await page.click("#notification-toggle");
    const list = page.locator("#notification-list");
    await expect(list).toContainText("Mining Cycle Started");
    await expect(list).toContainText(/In force\s*\/\/ STA-OPS-6/i);
    await expect(list).toContainText(/Mining Lease Approved[\s\S]*In force\s*\/\/ ISA-REG-8/i);
    await shot(page.locator("#notification-panel"), "ab4819-2-notifications");
    await page.click("#notification-toggle");

    // The Mining cycles page
    await openMiningCycles(page);
    const cycles = page.locator("#mine-cycle-list .ui-card").first();
    await expect(cycles).toContainText(/Status: Active\s*In force\s*\/\/ STA-OPS-6/i);
    await shot(cycles, "ab4819-3-mining-cycles");

    // Stop it from the lease (the Station tab reopens on it): Withdrawn in the Command Log
    await openTab(page, "station");
    await page.click('[data-action="stop-mining"]');
    await page.click("#trade-confirm-ok"); // the Stop Cycle confirmation
    await expect(page.locator("#trade-confirm-modal")).toBeHidden();
    await acknowledgeReceipt(page).catch(() => {}); // a stop may or may not show a receipt
    await openTab(page, "overview");
    const log = page.locator("#feedback-log");
    await expect(log).toContainText(/Mining cycle stopped\.\s*Withdrawn\s*\/\/ ISA-REG-10/i);
    await expect(log).toContainText(/Earth mining lease approved by the ISA\.\s*In force\s*\/\/ ISA-REG-8/i);
    await shot(log, "ab4819-4-command-log");
  } finally {
    child.kill();
  }
});

test("a probe fabricating says In force in the Assembly Facility, at 1280x800", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-ops-protocol-assembly-e2e-"));
  const email = `ops-protocol-assembly-${Date.now()}@example.test`;
  execFileSync(process.execPath, ["e2e/seed-assembly-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, env: { ...process.env, JWT_SECRET: SECRET } });
  const { child, url } = await startServer(dir, false);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await logIn(page, url, email);
    await openTab(page, "station");
    await page.click('[data-corp-building="Assembly Facility"]');
    await page.click("#build-probe-btn");
    await acknowledgeReceipt(page);
    const progress = page.locator(".station__fab-progress");
    await expect(progress).toContainText(/Fabricating Mining Probe[\s\S]*remaining\s*In force\s*\/\/ CORP-IND-5/i);
    await shot(page.locator(".station__probe-status, .station__fab-progress").first().locator("xpath=.."), "ab4819-6-probe-fabricating");
    await openTab(page, "overview");
    await expect(page.locator("#feedback-log")).toContainText(/Lodged\s*\/\/ CORP-IND-5/i);
  } finally {
    child.kill();
  }
});

test("a refused launch says Unfunded in the belt panel, after the plain refusal, at 1280x800", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-ops-protocol-belt-e2e-"));
  const email = `ops-protocol-belt-${Date.now()}@example.test`;
  execFileSync(process.execPath, ["e2e/seed-belt-panel.mjs", dir, email, PASSWORD, "static"], { cwd: REPO_ROOT, env: { ...process.env, JWT_SECRET: SECRET } });
  const { child, url } = await startServer(dir, false);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await recordCanvas(page);
    await logIn(page, url, email);
    await openTab(page, "starmap");
    const canvas = page.locator("#starmap-canvas");
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await openSystem(page, canvas, "Barnard's Star");
    await page.waitForTimeout(300);
    const centre = await beltCentre(page, 16);
    expect(centre).toBeTruthy();
    await canvas.click({ position: centre });
    await page.waitForTimeout(400);
    const details = page.locator("#map-details");
    await details.scrollIntoViewIfNeeded();
    await details.locator("#launch-expedition-btn").click();
    const notice = details.locator(".starmap__notice[role=alert]");
    await expect(notice).toContainText(/Expedition launch[\s\S]*Unfunded, balance insufficient\s*\/\/ ISA-NAV-1/i);
    await shot(details, "ab4819-5-belt-refused");
  } finally {
    child.kill();
  }
});
