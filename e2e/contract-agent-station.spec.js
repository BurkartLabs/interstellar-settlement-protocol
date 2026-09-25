// AB#1203: the route now completes a contract only at the agent's station, which is where the page already let a
// player complete one. This plays that path in a browser — accept a contract from Elara Voss at Earth Station Prime,
// complete it there — so the stricter route is shown not to refuse the one place the game sends you.
// (The refusal away from the station is tests/integration/mission-agent-station.test.js.)
import { acknowledgeReceipt } from "./receipt.mjs"; // AB#743, AB#744
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "contract-e2e-fixture-secret-0123456789ab";

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
  test(`complete a contract at the agent's station at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `contract-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-contract-e2e-"));
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

      await page.click('.tab-btn[data-tab="missions"]');
      await page.locator("[data-agent-id]").first().click();
      const offered = page.locator("[data-mission-id]").first();
      const missionId = await offered.getAttribute("data-mission-id");
      await offered.click();
      await page.click("#mission-accept-btn");
      await acknowledgeReceipt(page); // AB#744
      await expect(page.locator("#feedback-log li").first()).toContainText(/contract accepted/i, { timeout: 10_000 });

      // The accepted contract moves to the Bureau's active list; open it there, where Complete lives
      const complete = page.locator("#mission-complete-btn");
      if (!(await complete.isVisible())) {
        if (await page.locator("#mission-detail-modal").isVisible()) await page.click("#mission-modal-close");
        await page.getByRole("button", { name: /Back to Assignments Bureau/ }).click();
        await page.locator(`#active-mission-list [data-mission-id="${missionId}"]`).click();
      }
      await expect(complete).toBeVisible();
      await expect(page.locator("#mission-location-section")).toBeHidden();
      await complete.click();
      await expect(page.locator("#feedback-log li").first()).toContainText(/complete/i, { timeout: 10_000 });
      // AB#744: signed in, completion is confirmed by the ISA receipt (the server's figures), not the old overlay.
      await expect(page.locator("#action-receipt-title")).toHaveText("Contract Completed", { timeout: 10_000 });
      await page.waitForTimeout(600); // the receipt's own entrance, before the picture
      await page.screenshot({ path: path.join(SCREEN_DIR, `ab1203-contract-completed-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
