// AB#995 (ISP-288): the forums and chat a page at a time, in a real browser at 1280x800 and 375x812. A thread of 60
// replies opens with 50 and a "Load more replies" that brings the other 10; a chat channel of 70 lines opens with the
// server's window of 50 and a "Load older messages" that reads the first 20 back from the channel's history. Starts
// its own server on e2e/seed-forum-thread.mjs's data (for the logins). Screenshots go to e2e/screenshots/ab-995/.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-995");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "forums-chat-paging-e2e-fixture-secret-0123";
const PASSWORD = "playtest-password-not-real";

let server, url, logins;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-paging-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-forum-thread.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
  logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
  server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
}

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => server?.kill());

    test(`a long thread pages its replies and chat reads older history, at ${width}x${height}`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", logins.nova);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);

      // A thread of 60 replies, and 70 lines on the trade channel, through the page's own API and socket
      await page.evaluate(async () => {
        const { apiFetch, parseJsonResponse, socket } = await import("/scripts/apiClient.js");
        const post = async (path, body) => parseJsonResponse(await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
        const { thread } = await post("/api/forums/threads", { category: "General", title: "Refinery margins, month by month", body: "A long thread for AB#995's paging." });
        for (let i = 1; i <= 60; i++) await post(`/api/forums/threads/${thread.id}/replies`, { content: `Reply ${i}: the margin this month.` });
        await new Promise((resolve) => {
          socket.on("chat:new", (m) => { if (m.content === "Trade line 70") resolve(); });
          for (let i = 1; i <= 70; i++) socket.emit("chat:send", { channel: "trade", content: `Trade line ${i}` });
        });
      });
      await page.reload(); // state:init: the chat's last 50 lines, and no forum threads until the Forums tab reads them
      await page.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 }); // the app has taken ?account= off the address

      // Forums: the thread opens with 50 of its 60 replies
      await openTab(page, "forums");
      await page.getByText("Refinery margins, month by month").first().click();
      const shown = page.locator('[data-role="replies-shown"]');
      await expect(shown).toHaveText("Showing 50 of 60 replies", { timeout: 15_000 });
      await expect(page.locator(".forums__reply")).toHaveCount(50);
      const more = page.locator('[data-action="more-replies"]');
      await more.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `forum-thread-page1-${width}x${height}.png`), animations: "disabled" });
      await more.click();
      await expect(page.locator(".forums__reply")).toHaveCount(60);
      await expect(more).toHaveCount(0);
      await expect(page.locator(".forums__reply").last()).toContainText("Reply 60: the margin this month.");
      await page.locator(".forums__reply").nth(50).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `forum-thread-page2-${width}x${height}.png`), animations: "disabled" });

      // Chat: the trade channel opens with the server's window of 50 lines
      await openTab(page, "chat");
      await page.locator('[data-chat-channel-tab="trade"]').click();
      const lines = page.locator("#chat-log .chat__line");
      await expect(lines).toHaveCount(50);
      await expect(lines.first().locator(".chat__text")).toHaveText("Trade line 21"); // the window: lines 21 to 70
      const older = page.locator('[data-action="older-chat"]');
      await page.locator("#chat-log").evaluate((el) => { el.scrollTop = 0; });
      await page.screenshot({ path: path.join(SHOT_DIR, `chat-before-older-${width}x${height}.png`), animations: "disabled" });
      await older.click();
      await expect(lines).toHaveCount(70);
      await expect(lines.first().locator(".chat__text")).toHaveText("Trade line 1"); // read back from the history
      await expect(page.locator("#chat-log .chat__older")).toContainText("Start of the channel");
      await page.locator("#chat-log").evaluate((el) => { el.scrollTop = 0; });
      await page.screenshot({ path: path.join(SHOT_DIR, `chat-after-older-${width}x${height}.png`), animations: "disabled" });
      expect(errors).toEqual([]);
    });
  });
}
