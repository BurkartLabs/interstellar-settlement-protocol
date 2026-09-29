// Bug #2364: notifications:new reaches only the sockets in the account's room when it is sent, so a note made while
// the page's socket was down (a reconnect after a ping timeout, a slow first connect) never reached the badge until a
// reload. On reconnect the page reads the list again. Here: drop the socket, make a note over HTTP, reconnect, and the
// badge counts it. Starts its own server.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2364");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "notifications-reconnect-e2e-fixture-secret-0123456789";
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

test("a note made while the socket was down reaches the badge on reconnect", async ({ page }) => {
  test.setTimeout(90_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-notify-reconnect-e2e-"));
  const email = `reconnect-${Date.now()}@example.test`;
  const seeded = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForURL(/\?account=/);
    const badge = page.locator("#notification-count");
    await page.waitForFunction(async () => (await import("/scripts/apiClient.js")).socket?.connected); // AB#4840: no socket until the game opens
    await page.waitForTimeout(500); // the first state:init's read of the list
    const before = Number(await badge.textContent());

    // The socket goes down, and a note is made while it is (walkthrough-complete makes one and sends notifications:new)
    await page.evaluate(async () => (await import("/scripts/apiClient.js")).socket.disconnect());
    const made = await page.evaluate(async () => {
      const { apiFetch } = await import("/scripts/apiClient.js");
      const { appState } = await import("/scripts/state.js");
      const res = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/walkthrough-complete`, { method: "POST" });
      return res.status;
    });
    expect(made).toBe(200);
    await page.waitForTimeout(500);
    expect(Number(await badge.textContent()), "no socket, so nothing pushed").toBe(before);

    await page.evaluate(async () => (await import("/scripts/apiClient.js")).socket.connect());
    await expect(badge).toHaveText(String(before + 1), { timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOT_DIR, "badge-after-reconnect.png") });
    expect(errors).toEqual([]);
  } finally {
    child.kill();
  }
});
