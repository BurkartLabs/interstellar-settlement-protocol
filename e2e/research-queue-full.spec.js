// AB#2476 (Board review item 23): Corporate R&D holds the research in progress and one more behind it. With both
// places taken (e2e/seed-industry-account.mjs queues one running and one waiting), every card that could be queued
// keeps its Enqueue disabled and says when a place opens, as the server would refuse it. At 1280x800 and 375x812;
// screenshots go to e2e/screenshots/ab-2476/ (gitignored).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2476");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "research-queue-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800, mobile: false },
  { label: "375x812", width: 375, height: 812, mobile: true }
];

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

for (const vp of VIEWPORTS) {
  test(`a full R&D queue disables Enqueue and says when a place opens, at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-rnd-queue-e2e-"));
    const email = `rnd-full-${Date.now()}-${vp.width}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      await openTab(page, "rnd");
      await expect(page.locator("#rnd-queue")).toContainText("Queued, starts in");
      const enqueue = page.locator(".research__enqueue");
      expect(await enqueue.count()).toBeGreaterThan(0);
      for (const button of await enqueue.all()) await expect(button).toBeDisabled();
      const card = page.locator(".ui-card", { has: page.locator(".research__enqueue") }).first();
      await expect(card).toContainText(/Queue full: a place opens in \d+h \d+m, when .+ finishes/);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `queue-full-${vp.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
