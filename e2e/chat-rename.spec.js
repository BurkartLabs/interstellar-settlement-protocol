// AB#2490 (Board review item 40, "Comms is now called Chat"): no visible label reads Comms. The navigation group,
// the sidebar's quick action and the channel tabs' name say Chat. At 1280x800 and 375x812, with the Chat tab open
// and the sidebar's blocks opened; screenshots go to e2e/screenshots/ab-2490/ (gitignored).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2490");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "chat-rename-e2e-fixture-secret-0123456789ab";
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
  test(`Chat, not Comms, wherever it is named, at ${vp.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-chat-rename-e2e-"));
    const email = `chat-${Date.now()}-${vp.width}@example.test`;
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
      await openTab(page, "chat");
      await expect(page.locator("#chat")).toBeVisible();
      await expect(page.locator('.nav-group__button[data-group="comms"]')).toHaveText("Chat");
      await expect(page.locator("#chat-channel-tabs")).toHaveAttribute("aria-label", "Chat channels");
      await page.locator("#chat").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `chat-${vp.label}.png`) });
      // The sidebar's blocks opened, so the quick action is in sight too
      const closed = page.locator(".side-panel__toggle[aria-expanded='false']");
      while (await closed.count()) await closed.first().click();
      await expect(page.locator('#sidebar-actions [data-jump="chat"]')).toHaveText("Chat");
      // Nowhere on the page, in what is shown or what a screen reader is given
      const said = await page.evaluate(() => {
        const labels = [...document.querySelectorAll("[aria-label], [title]")].map((el) => `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`);
        return `${document.body.innerText}\n${labels.join("\n")}`;
      });
      expect(said).not.toMatch(/\bcomms\b/i);
      await page.locator('#sidebar-actions [data-jump="chat"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `quick-actions-${vp.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
