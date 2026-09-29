// ISP-255c1 (AB#4830): the Comms group's refusals and statuses with their protocol line, on the running page at 1280. The
// server runs with low limits (2 chat lines in 10 seconds, 1 forum reply an hour) so a real refusal comes back from it,
// not one this spec writes. Each check reads the plain words first, then the guide's phrase and the screen's code.
// docs/ab-4830 holds the screenshots.
//
// Run: `npx playwright test e2e/comms-protocol.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const SECRET = "comms-protocol-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";

let server, url, logins;
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-comms-protocol-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-forum-thread.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stdout}\n${seeded.stderr}`);
  logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
  server = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1",
      ISP_RATE_LIMIT_CHAT_LINE_MAX: "2", ISP_RATE_LIMIT_FORUM_POST_MAX: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
});
test.afterAll(() => server?.kill());

const shot = async (locator, name) => {
  await locator.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`) });
  await test.info().attach(name, { body: await locator.screenshot(), contentType: "image/png" });
};

test("chat, the Inbox and the Forums say their protocol line after the plain words, at 1280x800", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", logins.nova);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await expect(page.locator("#logout-btn")).toBeVisible({ timeout: 20_000 });

  // Chat: a third line inside ten seconds is refused by the server: Denied, the Chat's code
  await openTab(page, "chat");
  for (const line of ["Selling silicates at Earth.", "30 a tonne.", "Anyone?"]) {
    await page.fill("#chat-input", line);
    await page.press("#chat-input", "Enter");
  }
  await openTab(page, "overview");
  const log = page.locator("#feedback-log");
  await expect(log).toContainText(/That is more than 2 lines in 10 seconds\. Try again in \d+ seconds?\.\s*Denied\s*\/\/ CORP-COM-1/i);
  await shot(log, "ab4830-1-chat-refused");

  // The Inbox: a name nothing matches (with Bug #4832's next step), a draft saved, a draft deleted
  await openTab(page, "inbox");
  await page.click("#inbox-compose-trigger");
  await page.fill("#compose-to", "zzzz-no-such-corporation");
  await page.fill("#compose-body", "Your freighter is in my berth.");
  await page.click('#inbox-compose-form button[type="submit"]');
  const status = page.locator("#compose-status");
  await expect(status).toContainText(/No corporation has that name\. Check the spelling: part of a name lists every corporation it matches\.\s*Denied\s*\/\/ CORP-COM-3/i);
  await shot(page.locator("#inbox-compose-form"), "ab4830-2-compose-refused");
  await page.click("#compose-save-draft-btn");
  await expect(status).toContainText(/Draft saved\.\s*Concluded\s*\/\/ CORP-COM-3/i);
  await shot(status, "ab4830-3-draft-saved");
  await page.click("#compose-delete-draft-btn");
  await openTab(page, "overview");
  await expect(log).toContainText(/Draft deleted\.\s*Withdrawn\s*\/\/ CORP-COM-3/i);

  // The Forums: a second reply inside the hour is refused by the server's limit
  await openTab(page, "forums");
  await page.getByText("Arbitrated concessions: how the Council decides").first().click();
  const reply = page.locator("#forum-reply-content");
  await reply.fill("The Council reads control, not claims.");
  await page.click('#forum-reply-form button[type="submit"]');
  await expect(reply).toHaveValue("");
  await reply.fill("And a second thought.");
  await page.click('#forum-reply-form button[type="submit"]');
  const replyStatus = page.locator("#forum-reply-status");
  await expect(replyStatus).toContainText(/Failed to post reply: .+\s*Denied\s*\/\/ CORP-COM-2/i);
  await shot(page.locator("#forum-reply-form"), "ab4830-4-reply-refused");

  await openTab(page, "overview");
  await shot(log, "ab4830-5-command-log");
  expect(errors).toEqual([]);
});
