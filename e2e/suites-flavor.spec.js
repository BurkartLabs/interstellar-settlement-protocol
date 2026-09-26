// AB#1269: docked at Mars Orbital Dock, the Orbital Executive Suites card no longer talks about an Earth Station Prime
// office. Starts its own server on a seeded data directory (the logistics-shipments.spec.js pattern).
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
const SECRET = "docked-e2e-fixture-secret-0123456789abcd";

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
  test(`the Suites card at Mars Orbital Dock at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `docked-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-docked-e2e-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-docked-account.mjs", dir, email, PASSWORD, "mars-orbital-dock"], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-docked-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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

      const card = page.locator(".station__card", { has: page.locator('[data-building-action="building:orbital-executive-suites"]') });
      await expect(card).toBeVisible();
      await expect(page.locator("#station")).toContainText("Mars Orbital Dock");
      await expect(card).toContainText("a registered office here tells the ISA");
      await expect(card).not.toContainText("Earth Station Prime");
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab1269-suites-at-mars-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
