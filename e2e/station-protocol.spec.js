// ISP-254Bc (AB#4818): the Station's protocol line, from the running app at 1280x800. A corporation docked at Earth
// with an Assembly Facility and just enough credits for a week's office rents one (the lease reads Active Lease,
// In force), is refused a hire for want of credits (Unfunded, the server's code), and sees
// the lease's notification (In force) in the bell, and the lease in the command log; its facility card reads
// Operational, In force. Screenshots go to
// e2e/screenshots/ab-4818/.
import { test, expect } from "@playwright/test";
import { openStationOffices, openTab, toggleNotifications } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4818");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

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

test("the Station's statuses and notices carry the protocol line, at 1280x800", async ({ browser }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-station-protocol-e2e-"));
  const email = `station-${Date.now()}@example.test`;
  const env = { ...process.env, JWT_SECRET: SECRET };
  let r = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, email, `other-${email}`, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stdout}\n${r.stderr}`);
  // no office yet, an Assembly Facility, and a week's office plus 1,000 credits: the hire after it is unfunded
  r = spawnSync(process.execPath, ["--input-type=module", "-e", `
    process.env.ISP_DATA_DIR = ${JSON.stringify(dir)}; process.env.NODE_ENV = "test";
    const store = await import("./server/gameState.js");
    const { accountsStore } = await import("./server/game/store.js");
    const { officeLeaseCost } = await import("./public/scripts/ceoEffects.js");
    const a = Object.values(accountsStore.accounts).find((x) => x.email === ${JSON.stringify(email)});
    store.mutateAccountState(a.id, (s) => {
      s.corp.offices = [];
      s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), "tt-assembly-fabrication"])];
      s.corp.buildings = [...(s.corp.buildings || []), { name: "Assembly Facility", tier: 1, status: "Operational" }];
      s.corp.finances.credits = officeLeaseCost(7) + 1000;
    }, { sanitize: false, settleMining: false });
    await store.saveAccountsNow();`], { cwd: REPO_ROOT, encoding: "utf8", env });
  if (r.status !== 0) throw new Error(`setup failed: ${r.stdout}\n${r.stderr}`);
  const { child, url } = await startServer(dir);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = (name, locator) => (locator ? locator.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) }) : page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) }));
  try {
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForURL(/\?account=/);

    // 1. rent the office: the lease reads Active Lease, In force // STA-OPS-1
    await openTab(page, "station");
    await openStationOffices(page);
    await page.click('[data-building-action="building:orbital-executive-suites"]');
    await page.selectOption("#rent-office-duration", "7");
    await page.click("#rent-office-btn");
    await acknowledgeReceipt(page);
    const lease = page.locator("#station-building-content .protocol-line", { hasText: "In force" }).first();
    await expect(lease).toBeVisible();
    await lease.scrollIntoViewIfNeeded();
    await shot("1-office-lease-in-force");

    // 2. hire one with 1,000 credits: refused, Unfunded (the server's code), with the next step
    await page.fill("#office-hire-count", "1");
    await page.click('#office-hire-form button[type="submit"]');
    const hireStatus = page.locator("#office-hire-status");
    await expect(hireStatus).toContainText("Hire fewer, or sell goods to raise the credits.");
    await expect(hireStatus.locator(".protocol-line")).toContainText("Unfunded, balance insufficient");
    await hireStatus.scrollIntoViewIfNeeded();
    await shot("2-hire-refused-unfunded");

    // 3. the lease's notification, In force, in the bell
    await toggleNotifications(page);
    const note = page.locator("#notification-list li", { hasText: "Office Lease Confirmed" }).first();
    await expect(note.locator(".protocol-line")).toContainText("In force");
    await shot("3-notification-office-lease", page.locator("#notification-panel"));
    await toggleNotifications(page);

    // 4. the command log (kept in the page, so before any reload): the lease confirmed, In force
    await openTab(page, "overview");
    const log = page.locator("#command-log");
    await expect(log.locator("li", { hasText: "Office lease confirmed" }).locator(".protocol-line")).toContainText("In force");
    await log.scrollIntoViewIfNeeded();
    await shot("4-command-log", log);

    // 5. the facility card: Operational, In force
    await page.goto(page.url()); // back to the Station's overview
    await openTab(page, "station");
    const facility = page.locator("#station-facility-buildings .station__card", { hasText: "Assembly Facility" }).first();
    await expect(facility.locator(".protocol-line")).toContainText("In force");
    await facility.scrollIntoViewIfNeeded();
    await shot("5-facility-operational", facility);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
