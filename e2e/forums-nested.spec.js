// AB#2466: the Forums in a sized container, with replies nested under what they answer, in a real browser at 1280x800
// and 375x812. The data comes from e2e/seed-forum-thread.mjs: a thread whose replies answer each other down to seven
// levels. A player replies to a reply from the page and the new reply appears under it. Screenshots go to
// e2e/screenshots/ab-2466/ (gitignored; the PR's are copied to docs/ab-2466/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-2466");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "forums-nested-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";

let server, url, logins;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-forums-e2e-"));
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
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const tinyText = (page) => page.evaluate(() => {
  const out = [];
  const walker = document.createTreeWalker(document.getElementById("forums"), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el.getClientRects().length) continue;
    const f = parseFloat(getComputedStyle(el).fontSize);
    if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
  }
  return [...new Set(out)];
});

for (const [width, height] of [[1280, 800], [375, 812]]) {
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => server?.kill());

    test(`replies nested under what they answer, and a reply to a reply, at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", logins.nova);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "forums");
      const forums = page.locator("#forums");
      // the sized container: 70% of the column or a reading width, centred, at least 36rem tall
      const box = await forums.boundingBox();
      const column = await forums.evaluate((el) => el.parentElement.getBoundingClientRect().width);
      expect(Math.round(box.width)).toBe(Math.round(Math.max(0.7 * column, Math.min(column, 960))));
      expect(box.height).toBeGreaterThanOrEqual(575);
      await page.screenshot({ path: path.join(SHOT_DIR, `forums-list-${width}x${height}.png`), fullPage: true, animations: "disabled" });

      await page.getByText("Arbitrated concessions: how the Council decides").first().click();
      const deepest = page.locator('.forums__reply[data-reply-depth="6"]');
      await expect(deepest).toHaveCount(1, { timeout: 15_000 });
      await expect(deepest).toContainText("Filed a note on it.");
      // the chain: each level inside the one above it
      expect(await page.locator("#forum-reply-rep-seed-7").evaluate((el) => el.closest('.forums__reply[data-reply-depth="0"]')?.querySelector("article")?.id)).toBe("forum-reply-rep-seed-1");
      await expect(page.locator('.forums__reply[data-reply-depth="0"]')).toHaveCount(2); // two answers to the thread
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(SHOT_DIR, `forums-thread-${width}x${height}.png`), fullPage: true, animations: "disabled" });
      expect(await sideways(page), "sideways").toBe(0);
      if (width === 375) expect(await tinyText(page), "text under 14px").toEqual([]);

      // reply to a reply: it lands under that reply
      await page.locator('#forum-reply-rep-seed-9 [data-action="reply"]').click();
      await expect(page.locator("[data-reply-target]")).toContainText("Replying to Kestrel Mining");
      await page.fill("#forum-reply-content", "Thank you, that settles it.");
      await page.click('#forum-reply-form button[type="submit"]');
      const mine = page.locator(".forums__post", { hasText: "Thank you, that settles it." });
      await expect(mine).toBeVisible({ timeout: 15_000 });
      expect(await mine.evaluate((el) => el.closest("ol.forums__replies--nested")?.closest(".forums__reply")?.querySelector("article")?.id)).toBe("forum-reply-rep-seed-9");
      await expect(page.locator("[data-reply-target]")).toHaveCount(0); // the next reply answers the thread
    });
  });
}
