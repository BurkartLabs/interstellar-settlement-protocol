// AB#2467: a player's message renders its Markdown, and a hostile one renders inert, in a real browser at 1280x800 and
// 375x812. Kestrel sends Nova a formatted message and one of real XSS payloads (e2e/seed-inbox-markdown.mjs); Nova
// opens the conversation. Every payload sets window.__xss or the title if it runs, and a dialog fails the test.
// Screenshots go to e2e/screenshots/ab-2467/ (gitignored; the PR's are copied to docs/ab-2467/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-2467");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "inbox-markdown-e2e-secret-0123456789abcd";
const PASSWORD = "playtest-password-not-real";

let server, url, logins;
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-inbox-md-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-inbox-markdown.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-inbox-markdown.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
  server = spawn(process.execPath, ["server/index.js"], { cwd: REPO_ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
});
test.afterAll(() => server?.kill());

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`a formatted message and a hostile one at ${width}x${height}`, async ({ page }) => {
    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height });
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", logins.nova);
    await page.fill("#login-password", PASSWORD);
    await page.click("#credential-login-btn");
    await page.waitForURL(/\/\?account=/);
    const title = await page.title();
    await openTab(page, "inbox");
    await page.locator('#inbox-subtab-nav [data-subtype="players"]').click();
    await page.locator("#inbox-conversation-list [data-conv-id]").first().click();
    const msgs = page.locator("#thread-messages > li"); // a message; its lists have li of their own
    await expect(msgs).toHaveCount(2);

    // The formatted one: bold, italic, a list of each kind, a safe link and code.
    const formatted = msgs.filter({ hasText: "quick offer" }).locator(".thread__body");
    await expect(formatted.locator("strong")).toHaveText(/Nova Freight/);
    await expect(formatted.locator("em")).toHaveText(["quick", "Nickel"]);
    await expect(formatted.locator("ul > li")).toHaveCount(2);
    await expect(formatted.locator("ol > li")).toHaveCount(2);
    await expect(formatted.locator("a")).toHaveAttribute("href", "https://example.com/gex");
    await expect(formatted.locator("code")).toHaveText("LIC-2147-ABC123");

    // The hostile one: every payload is text on the screen, nothing ran, nothing to click.
    const hostile = msgs.filter({ hasText: "claim your prize" }).locator(".thread__body");
    await expect(hostile).toContainText("<script>window.__xss = 'script'</script>");
    await expect(hostile).toContainText("<img src=x onerror=");
    await expect(hostile).toContainText("[claim your prize](javascript:window.__xss='link')");
    expect(await hostile.locator("script, img, svg, iframe, a").count(), "no live element from the payloads").toBe(0);
    await hostile.getByText("claim your prize").first().click(); // a click on the refused link does nothing
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss), "no payload ran").toBeUndefined();
    expect(await page.title(), "the title was not rewritten").toBe(title);
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);

    // A phone's thread box is the viewport's height, shorter than the hostile message: a taller page for the pictures.
    if (width < 600) { await page.setViewportSize({ width, height: 1400 }); await page.waitForTimeout(300); }
    await page.locator("#inbox-thread-view").screenshot({ path: path.join(SHOT_DIR, `thread-${width}x${height}.png`), animations: "disabled" });
    await formatted.screenshot({ path: path.join(SHOT_DIR, `formatted-${width}x${height}.png`) });
    await hostile.screenshot({ path: path.join(SHOT_DIR, `hostile-${width}x${height}.png`) });
  });
}
