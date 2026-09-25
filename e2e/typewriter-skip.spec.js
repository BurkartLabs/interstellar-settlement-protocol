// AB#1763 (ISP-294): the coordinator's typewritten line finishes on a click, a tap or a key, and the next control is
// ready: focus is on the first choice, so the next key press acts on it. Also checks the chained case: a choice that
// opens the next line must not finish that line with its own click. (Reduced motion, where the line is complete from
// the start, is e2e/focus-and-motion.spec.js, AB#1760.)
//
// Run: `npx playwright test e2e/typewriter-skip.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const SECRET = "typewriter-e2e-fixture-secret-0123456789";

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

const focusedText = (page) => page.evaluate(() => document.activeElement?.textContent?.trim() || "");

for (const vp of VIEWPORTS) {
  test.describe(`the typewriter at ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });

    test(`a ${vp.mobile ? "tap" : "click"} or a key finishes the line and focuses the next control`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-typewriter-e2e-"));
      const { child, url } = await startServer(dir);
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const line = page.locator("#dialogue-text");
      const card = page.locator("#dialogue-modal .modal-card");

      try {
        const stamp = `${Date.now()}-${vp.width}`;
        await page.goto(`${url}/register.html`);
        await page.fill("#register-email", `typewriter-${stamp}@example.test`);
        await page.fill("#register-password", "playtest-password-not-real");
        await page.fill("#register-ceo", "Typewriter QA");
        await page.fill("#register-corp", `Typewriter Corp ${stamp}`);
        await page.click('#register-form button[type="submit"]');
        await page.waitForURL(/\/\?account=/);

        // 1. The first-day offer, typing: a click (desktop) or a tap (phone) finishes it.
        await expect(line).not.toBeEmpty({ timeout: 20_000 });
        const partial = (await line.textContent()).length;
        await page.screenshot({ path: path.join(SCREEN_DIR, `ab1763-typing-${vp.label}.png`) });
        if (vp.mobile) await card.tap({ position: { x: 20, y: 20 } });
        else await card.click({ position: { x: 20, y: 20 } });
        await page.screenshot({ path: path.join(SCREEN_DIR, `ab1763-after-${vp.mobile ? "tap" : "click"}-${vp.label}.png`) });
        const whole = await line.textContent();
        expect(whole.length, "the line was still typing when it was clicked").toBeGreaterThan(partial);
        expect(whole).toMatch(/what the ISA expects next\.$/);
        await expect(page.getByRole("button", { name: "Brief me" })).toBeFocused();
        await page.waitForTimeout(300);
        expect(await line.textContent(), "nothing is still typing").toBe(whole);
        await page.getByRole("button", { name: "I'll find my own way" }).click();
        await expect(page.locator("#dialogue-modal")).toBeHidden();

        // 2. Replay the intro: any key finishes it, and Enter then acts on the focused first choice.
        await page.click("#replay-onboarding-btn");
        // The replay awaits a request before the intro opens, and the last line's text is still in the element.
        await expect(page.locator("#dialogue-title")).toHaveText("Corporate Confirmation", { timeout: 20_000 });
        await expect(line).toHaveText(/^Registration complete/);
        await expect(line).not.toHaveText(/assigned to yours\.$/);
        await page.keyboard.press("x");
        await expect(line).toHaveText(/assigned to yours\.$/);
        expect(await focusedText(page)).toBe("Any advice for me?");
        await page.keyboard.press("Enter");

        // 3. The chosen line opens typing: the click or key that chose it did not also finish it.
        await expect(page.locator("#dialogue-title")).toHaveText("Starting Advice");
        expect(await line.textContent()).not.toMatch(/each of those next\.$/);
        await expect(page.locator("#dialogue-continue")).toBeHidden();
        if (vp.mobile) await card.tap({ position: { x: 20, y: 20 } });
        else await card.click({ position: { x: 20, y: 20 } });
        await expect(line).toHaveText(/each of those next\.$/);
        await expect(page.locator("#dialogue-continue")).toBeFocused();
        expect(errors).toEqual([]);
      } finally {
        child.kill();
      }
    });
  });
}
