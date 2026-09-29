// ISP-292 (AB#1761, visual-design Critique AB#1757, POLISH 2.4/5): the Refinery Chains panel's requirement text
// ("Requires: ...") used the warning colour, reading as something wrong rather than a normal, unmet step.
// Acceptance asks for before-and-after screenshots at 1280x800 and 375x812.
//
// A fresh account already shows this: every chain in data/refinery-chains.json needs research nobody starts
// with, so the panel is all "Requires:" rows from the first login — no fixture beyond registering. "Before" is
// captured by serving the pre-fix panel code for one page load, then the route is dropped and the page reloaded for
// "after": the same server, only the moment of capture differs. AB#739: the panel is drawn by
// public/scripts/views/refinery.js since app.js was split into a module per tab, so that is the file swapped.
// AB#1827: swapped in the browser with page.route, never on disk. Writing the file under public/ served the pre-fix
// code to every other spec and player on the same checkout while this one ran.
//
// AB#1828: the pre-fix file is rebuilt from the current one, not read from git. It was `git show origin/main:…`,
// which was the pre-fix code only while AB#1761's own pull request was open; once merged, origin/main was the fix,
// before equalled after, and this spec failed on every checkout.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyAndLogIn } from "./verification.mjs";

/**
 * A requirement line's colour and an ordinary muted line's (one that never had an override: what the muted token
 * renders as), read in one evaluate. The panel re-renders every second, so an element found in one round-trip can be
 * detached by the next, and a detached element's computed colour is "".
 */
function panelColors(page) {
  return page.evaluate(() => {
    const ps = [...document.querySelectorAll("#refinery-unavailable-chains p")]; // AB#2485: a fresh account can run none
    const color = (p) => (p ? getComputedStyle(p).color : null);
    return {
      requirement: color(ps.find((p) => p.textContent.startsWith("Requires:"))),
      muted: color(ps.find((p) => p.classList.contains("ui-card__meta") && p.textContent.startsWith("Cycle:")))
    };
  });
}

/** The pre-fix panel code: AB#1761 removed the warning colour from exactly these two requirement lines. */
function preFixPanelJs(fixed) {
  const REVERT = [
    ['<p class="ui-card__meta">Requires: ', '<p class="ui-card__meta" style="color:var(--color-warn)">Requires: ']
  ]; // AB#2485: the building line is new since AB#1761, so only the research line has a pre-fix colour
  let text = fixed;
  for (const [now, before] of REVERT) {
    const n = text.split(now).length - 1;
    if (n !== 1) throw new Error(`expected exactly one ${now} in public/scripts/views/refinery.js, found ${n}: the code this spec rebuilds "before" from has changed`);
    text = text.replace(now, before);
  }
  return text;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PANEL_JS = path.join(REPO_ROOT, "public", "scripts", "views", "refinery.js");
const PANEL_URL = "**/scripts/views/refinery.js";
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
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: "refinery-e2e-fixture-secret-0123456789ab", ISP_DEV: "1" },
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
    const fixedPanelJs = fs.readFileSync(PANEL_JS, "utf8");
    const beforePanelJs = preFixPanelJs(fixedPanelJs);
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
      await verifyAndLogIn(page, url, email, FIXTURE_PASSWORD); // AB#2288: verify, then log in
      await page.waitForURL(/\/\?account=/);
      // The coordinator's one-time offer (first-hour.spec.js's pattern) — declined, this spec plays the tab directly.
      await page.getByRole("button", { name: "I'll find my own way" }).click();
      await expect(page.locator("#dialogue-modal")).toBeHidden();
      await openTab(page, "refinery");
      const chainsEl = page.locator("#refinery-unavailable-chains"); // AB#2485
      await expect(chainsEl).toBeVisible();
      const requirementRow = chainsEl.locator("p", { hasText: "Requires:" }).first();
      await expect(requirementRow).toBeVisible();

      // ── before: the pre-fix code, amber ──────────────────────────────────────────────────────────────
      await page.route(PANEL_URL, (route) =>
        route.fulfill({ contentType: "text/javascript", headers: { "cache-control": "no-store" }, body: beforePanelJs })
      );
      await page.reload();
      await openTab(page, "refinery");
      await expect(chainsEl).toBeVisible();
      const beforeRow = chainsEl.locator("p", { hasText: "Requires:" }).first();
      await expect(beforeRow).toBeVisible();
      const before = await panelColors(page);
      if (mobile) await assertNoHorizontalScroll(page);
      await shoot(page, viewport.label, "01-before-amber", viewport.width);

      // ── after: the real fix, muted ───────────────────────────────────────────────────────────────────
      await page.unroute(PANEL_URL);
      await page.reload();
      await openTab(page, "refinery");
      await expect(chainsEl).toBeVisible();
      const afterRow = chainsEl.locator("p", { hasText: "Requires:" }).first();
      await expect(afterRow).toBeVisible();
      const after = await panelColors(page);
      if (mobile) await assertNoHorizontalScroll(page);
      await shoot(page, viewport.label, "02-after-muted", viewport.width);

      for (const [when, colors] of Object.entries({ before, after })) {
        for (const [k, v] of Object.entries(colors)) expect(v, `${when}: the ${k} line's colour was read`).toMatch(/^rgba?\(/);
      }
      expect(after.requirement, "after: the requirement line renders in the muted token").toBe(after.muted);
      expect(before.requirement, "before: the rebuilt pre-fix file really rendered the warning colour").not.toBe(before.muted);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
