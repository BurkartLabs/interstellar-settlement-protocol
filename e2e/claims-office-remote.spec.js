// AB#1870: docked at Mars Orbital Dock with an office only at Earth Station Prime, the ISA Claims & Leases
// Division no longer offers a lease application it would refuse server-side. Starts its own server on a seeded
// data directory (the suites-flavor.spec.js pattern).
import { test, expect } from "@playwright/test";
import { openTab, openStationOffices } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acknowledgeReceipt } from "./receipt.mjs"; // AB#743

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "remote-office-e2e-fixture-secret-0123456789ab";

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
  test(`ISA Claims at Mars with only an Earth office, at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `remote-office-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-remote-office-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-remote-office-account.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-remote-office-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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
      await openTab(page, "station");
      await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
      await page.click('[data-building-action="building:isa-claims-leases"]');

      const content = page.locator("#station-building-content");
      await expect(content).toContainText("An office at Mars Orbital Dock is required");
      await expect(page.locator('[data-action="purchase-lease"]')).toHaveCount(0);
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab1870-claims-no-office-here-${viewport.label}.png`) });

      // Rent the Mars office, then the same page offers the lease it refused a moment ago.
      await page.click("#station-back-btn");
      await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
      await page.click('[data-building-action="building:orbital-executive-suites"]');
      await page.click("#rent-office-btn");
      // AB#743: the server's receipt, not #rent-office-status, which this used to read while it still said
      // "Processing lease agreement..." (it matched /lease/ before the server had answered at all).
      await expect(page.locator("#action-receipt-title")).toHaveText("Office Lease Confirmed");
      await expect(page.locator("#action-receipt-body")).toContainText("Mars Orbital Dock");
      await acknowledgeReceipt(page);
      await page.click("#station-back-btn");
      await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
      await page.click('[data-building-action="building:isa-claims-leases"]');
      await expect(page.locator('[data-action="purchase-lease"]').first()).toBeVisible();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab1870-claims-after-mars-office-${viewport.label}.png`) });

      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
