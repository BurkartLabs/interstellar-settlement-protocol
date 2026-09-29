// AB#744 (ISP-58): the confirmation modal after the rest of the game's committing actions, looked at in a browser.
// Acceptance asks for the modal after an exchange sale and after queueing research at 1280x800; both are taken here, and
// at 375x812. The corporation is seeded holding Silicates at Earth Station Prime (e2e/seed-trade-account.mjs), and this
// spec starts its own server on that data folder.
//
// Run: npx playwright test e2e/action-receipt-rest.spec.js (no server needed).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acknowledgeReceipt } from "./receipt.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-744");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "trade-e2e-fixture-secret-0123456789abcdef";

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

for (const vp of [{ label: "1280x800", width: 1280, height: 800 }, { label: "375x812", width: 375, height: 812 }]) {
  test(`the receipt after a sale to a standing order and after queueing research, at ${vp.label}`, async ({ page }) => {
    test.setTimeout(90_000);
    const email = `receipt-744-${Date.now()}-${vp.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-receipt-744-"));
    const seeded = spawnSync(process.execPath, ["e2e/seed-trade-account.mjs", dir, email, PASSWORD], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET }
    });
    if (seeded.status !== 0) throw new Error(`seed-trade-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);

      // ── a sale to a standing order ──────────────────────────────────────────
      await openTab(page, "market");
      const sell = page.locator('[data-npc-item="Silicates"]').first();
      await expect(sell).toBeEnabled();
      const orderId = await sell.getAttribute("data-npc-order-id");
      await page.fill(`[data-npc-sell-qty="${orderId}"]`, "10");
      await sell.click();
      await page.click("#trade-confirm-ok");
      await expect(page.locator("#action-receipt-title")).toHaveText("Sale Completed", { timeout: 10_000 });
      const saleBody = page.locator("#action-receipt-body");
      await expect(saleBody).toContainText("10 Silicates sold to a standing order");
      await expect(saleBody).toContainText("Exchange tax");
      await expect(saleBody).toContainText("Paid to your reserves");
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOT_DIR, `receipt-sale-${vp.label}.png`) });
      await acknowledgeReceipt(page);

      // ── queueing research ───────────────────────────────────────────────────
      await openTab(page, "rnd");
      await page.click('.research__enqueue[data-tech-id="tt-basic-extraction"]');
      await expect(page.locator("#action-receipt-title")).toHaveText("Research Queued", { timeout: 10_000 });
      await expect(page.locator("#action-receipt-body")).toContainText("Basic Extraction Analytics");
      await expect(page.locator("#action-receipt-body")).toContainText(/Completes\s*(\d{4}-\d\d-\d\d )?\d\d:\d\d UTC/); // AB#945: YYYY-MM-DD HH:MM UTC, the date left out when today's
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOT_DIR, `receipt-research-${vp.label}.png`) });
      await acknowledgeReceipt(page);

      // A refusal is an error, not a confirmation: the same research again is refused, and no receipt appears.
      await openTab(page, "overview");
      await openTab(page, "rnd");
      const again = page.locator('.research__enqueue[data-tech-id="tt-basic-extraction"]');
      // Queued research usually loses its enqueue button; when one is still there and enabled, press it.
      if ((await again.count()) > 0 && (await again.first().isEnabled())) {
        await again.click();
        await page.waitForTimeout(800);
        await expect(page.locator("#action-receipt-modal")).toBeHidden();
      }
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
