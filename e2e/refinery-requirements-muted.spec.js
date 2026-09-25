// ISP-292 (AB#1761, visual-design Critique AB#1757, POLISH 2.4/5): the Refinery Chains panel's requirement text
// ("Requires: ...") used the warning colour, reading as something wrong rather than a normal, unmet step.
// Acceptance asks for before-and-after screenshots at 1280x800 and 375x812.
//
// A fresh account already shows this: every chain in data/refinery-chains.json needs research nobody starts
// with, so the panel is all "Requires:" rows from the first login — no fixture beyond registering. "Before" is
// captured by serving the pre-fix public/scripts/app.js for one page load (express.static reads the file fresh
// each request, no build step), then the real fix is restored and reloaded for "after" — the same file, the
// same running server, only the moment of capture differs.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_JS = path.join(REPO_ROOT, "public", "scripts", "app.js");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const VIEWPORTS = [
  { label: "1280x800", width: 1280, height: 800 },
  { label: "375x812", width: 375, height: 812 }
];

const FIXTURE_PASSWORD = "playtest-password-not-real";

/** Same as e2e/first-hour.spec.js's assertNoHorizontalScroll(): at the phone width, no screen may scroll sideways. */
async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.scrollWidth, "document.scrollingElement.scrollWidth <= innerWidth").toBeLessThanOrEqual(overflow.innerWidth);
}

async function shoot(page, viewportLabel, stepId, width) {
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, `${stepId}-${viewportLabel}.png`) });
  await page.setViewportSize({ width, height: VIEWPORTS.find((v) => v.width === width).height });
}

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: "refinery-e2e-fixture-secret-0123456789ab", ISP_DEV: "" },
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
  test(`Refinery Chains requirement text: amber before, muted after, at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `refinery-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-refinery-e2e-"));
    const fixedAppJs = fs.readFileSync(APP_JS, "utf8");
    const preFixAppJs = execSync("git show origin/main:public/scripts/app.js", { cwd: REPO_ROOT, encoding: "utf8" });
    const { child, url } = await startServer(dir);
    const mobile = viewport.width < 600;

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${url}/register.html`);
      await page.fill("#register-email", email);
      await page.fill("#register-password", FIXTURE_PASSWORD);
      await page.fill("#register-ceo", "Refinery QA");
      await page.fill("#register-corp", `Refinery QA Corp ${Date.now()}`);
      await page.click('#register-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      // The coordinator's one-time offer (first-hour.spec.js's pattern) — declined, this spec plays the tab directly.
      await page.getByRole("button", { name: "I'll find my own way" }).click();
      await expect(page.locator("#dialogue-modal")).toBeHidden();
      await page.click('.tab-btn[data-tab="refinery"]');
      const chainsEl = page.locator("#refinery-chains");
      await expect(chainsEl).toBeVisible();
      const requirementRow = chainsEl.locator("p", { hasText: "Requires:" }).first();
      await expect(requirementRow).toBeVisible();

      // ── before: the pre-fix code, amber ──────────────────────────────────────────────────────────────
      fs.writeFileSync(APP_JS, preFixAppJs);
      await page.reload();
      await page.click('.tab-btn[data-tab="refinery"]');
      await expect(chainsEl).toBeVisible();
      const beforeRow = chainsEl.locator("p", { hasText: "Requires:" }).first();
      await expect(beforeRow).toBeVisible();
      const beforeColor = await beforeRow.evaluate((el) => getComputedStyle(el).color);
      if (mobile) await assertNoHorizontalScroll(page);
      await shoot(page, viewport.label, "01-before-amber", viewport.width);

      // ── after: the real fix, muted ───────────────────────────────────────────────────────────────────
      fs.writeFileSync(APP_JS, fixedAppJs);
      await page.reload();
      await page.click('.tab-btn[data-tab="refinery"]');
      await expect(chainsEl).toBeVisible();
      const afterRow = chainsEl.locator("p", { hasText: "Requires:" }).first();
      await expect(afterRow).toBeVisible();
      const afterColor = await afterRow.evaluate((el) => getComputedStyle(el).color);
      if (mobile) await assertNoHorizontalScroll(page);
      await shoot(page, viewport.label, "02-after-muted", viewport.width);

      expect(afterColor).not.toBe(beforeColor);
    } finally {
      fs.writeFileSync(APP_JS, fixedAppJs); // always leave the real fix on disk, whatever else happened
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
