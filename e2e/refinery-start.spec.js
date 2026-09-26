// ISP-131 (AB#825): a run started from the Refinery Chains form, in a real browser, after chains moved from one `input`
// to `inputs`. The form sends its quantity as it always did; the server debits it, records what the run took and will
// deliver, and the receipt and the Active runs card show it. Screenshots go to e2e/screenshots/ab-825/ (gitignored;
// the ones the pull request shows were copied to docs/ab-825/).
//
// Run: `npx playwright test e2e/refinery-start.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-825");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "refinery-start-e2e-fixture-secret-0123456";
const PASSWORD = "playtest-password-not-real";

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
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

for (const [width, height] of [[375, 812], [1280, 800]]) {
  test(`Start Run on the Silicates chain takes 1,800 Silicates and shows the run, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-refinery-start-e2e-"));
    const email = `refinery-${width}-${Date.now()}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-idle-refinery.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-idle-refinery.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });

      await openTab(page, "refinery");
      const silicates = page.locator("#refinery-chains .refinery__chain", { hasText: "Silicates Refining" });
      await expect(silicates.locator(".refinery__quantity")).toHaveValue("1800");
      await shot("before");
      await silicates.locator(".refinery__start").click();

      await expect(page.locator("#action-receipt-title")).toHaveText("Production Run Started", { timeout: 10_000 });
      await expect(page.locator("#action-receipt-body")).toContainText("1,800 Silicates");
      await expect(page.locator("#action-receipt-body")).toContainText("720 Aerogel, 270 Quantum Insulators");
      await shot("receipt");
      await page.keyboard.press("Escape");

      await expect(page.locator("#refinery-active-runs")).toContainText("Processing: 1,800 Silicates → 720 Aerogel, 270 Quantum Insulators");
      await expect(silicates).toContainText("Inventory: 0 Silicates");
      await shot("running");
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
