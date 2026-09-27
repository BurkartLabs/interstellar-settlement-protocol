// ISP-173 (AB#867): readiness on the Overview's Military Power card, full and falling while upkeep is unpaid, from the
// running app. At 1280x800 and 375x812; screenshots go to e2e/screenshots/ab-867/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-867");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "375x812", width: 375, height: 812, mobile: true }
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
  test(`the Overview's Military Power card shows readiness, and why it is falling, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const run = async (kind) => {
      const email = `upkeep-${kind}-${Date.now()}-${viewport.width}@example.test`;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-upkeep-e2e-"));
      const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, kind], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
      if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
      const { child, url } = await startServer(dir);
      try {
        await page.goto(`${url}/login.html`);
        await page.fill("#login-email", email);
        await page.fill("#login-password", PASSWORD);
        await page.click('#login-form button[type="submit"]');
        await page.waitForURL(/\?account=/);
        await openTab(page, "overview");
        const card = page.locator("#overview-cards > *", { hasText: "Military Power" });
        await card.scrollIntoViewIfNeeded();
        return { card, child };
      } catch (e) { child.kill(); throw e; }
    };
    const unpaid = await run("unpaid");
    try {
      await expect(unpaid.card).toContainText(/Readiness 70%/);
      await expect(unpaid.card).toContainText("Upkeep is unpaid, so it falls 10 points a day, to 40");
      await page.screenshot({ path: path.join(SHOT_DIR, `readiness-unpaid-${viewport.label}.png`) });
    } finally { unpaid.child.kill(); }
    const paid = await run("military");
    try {
      await expect(paid.card).toContainText("Readiness 100%");
      await expect(paid.card).not.toContainText("Upkeep is unpaid");
      await page.screenshot({ path: path.join(SHOT_DIR, `readiness-full-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally { paid.child.kill(); await context.close(); }
  });
}
