// ISP-279 (AB#986, v0.5 release gate): the Logistics tab quotes the arrival time next to the fee, before the
// player confirms (AB#985 made the arrival real; this makes it visible), and lists shipments in flight until
// they arrive. Acceptance #3 asks for a screenshot of the quote for a cross-system transfer and of the
// in-flight list with a shipment in it, at 1280x800 and 375x812, from the running game after dispatching.
//
// Reaching a station outside Sol needs Proxima or Deep-Star Navigation research, which needs corporation level
// 5 (data/research.json) — a real grind even with dev mode's zeroed R&D timers, because mining itself is not
// accelerated (PROGRESS.md, ISP-61's own finding). Scripting that climb just to take two screenshots of a
// display panel is disproportionate to this story, so the fixture below seeds a corporation that already holds
// stock at Centauri Prime Orbital and is docked back at Earth — a state genuinely reachable by play, just not
// replayed here, using the same mutateAccountState() every integration test already uses for exactly this
// reason (tests/integration/*.test.js). Nothing about the mechanism under test is faked from there on: the
// account logs in over real HTTP, the quote is read off the live page, the dispatch is a real click against
// the real transfer-resources route, and the server that answers it is a real, separate `node server/index.js`
// process reading that fixture from disk at boot, the same as a real restart.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

/** Same shape as e2e/first-hour.spec.js's shoot(): grow to the page's own height for one capture, no stitching. */
async function shoot(page, viewportLabel, stepId, width) {
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: fullHeight });
  await page.screenshot({ path: path.join(SCREEN_DIR, `${stepId}-${viewportLabel}.png`) });
  await page.setViewportSize({ width, height: VIEWPORTS.find((v) => v.width === width).height });
}

/**
 * Builds an accounts snapshot with one corporation that already holds Silicates at Centauri Prime Station (1
 * jump from Sol) while docked at Earth Station Prime, using the server's own account-creation code — not a
 * hand-typed fixture — so the schema cannot drift from what registration actually produces. Runs as a genuinely
 * separate `node` process (e2e/seed-logistics-account.mjs): server/gameState.js's dataDir and accountsStore are
 * computed once at first import and do not follow a later change to ISP_DATA_DIR within one process, so an
 * in-process import here would silently keep writing into whichever directory the first viewport's run used.
 */
function seedAccount(dataDir, email) {
  const result = spawnSync(process.execPath, ["e2e/seed-logistics-account.mjs", dataDir, email, FIXTURE_PASSWORD], {
    cwd: REPO_ROOT, encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`seed-logistics-account.mjs failed: ${result.stdout}\n${result.stderr}`);
}

/** Starts `node server/index.js` on `dir` and resolves with its URL once it listens (data-dir.test.js's pattern). */
function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: "logistics-e2e-fixture-secret-0123456789ab", ISP_DEV: "" },
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
  test(`logistics quote and in-flight shipments at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const email = `logistics-qa-${Date.now()}-${viewport.width}@example.test`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-logistics-e2e-"));
    seedAccount(dir, email);
    const { child, url } = await startServer(dir);

    const mobile = viewport.width < 600;
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", FIXTURE_PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);
      await expect(page.locator("#dialogue-modal")).toBeHidden();

      await openTab(page, "logistics");
      await expect(page.locator('.nav-tab[data-tab="logistics"]')).toHaveClass(/active/);

      // ── quote: the remote station's card names the fee and the arrival time before anything is sent ──────
      const remoteCard = page.locator(".logistics-station-card", { hasText: "Centauri Prime Orbital" });
      await expect(remoteCard).toBeVisible();
      const quoteText = await remoteCard.locator(".logistics-route-fee").innerText();
      expect(quoteText).toMatch(/per unit/);
      expect(quoteText).toMatch(/transit/);
      expect(quoteText).toMatch(/1 jump/);
      await expect(page.locator(".logistics-in-flight")).toContainText("Nothing is in transit");
      if (mobile) await assertNoHorizontalScroll(page);
      await shoot(page, viewport.label, "01-quote-cross-system", viewport.width);

      // ── dispatch: a real click against the real transfer-resources route ───────────────────────────────
      await remoteCard.locator('.logistics-qty-input[data-item="Silicates"]').fill("120");
      await remoteCard.locator('.logistics-transfer-btn[data-item="Silicates"]').click();
      await expect(page.locator("#feedback-log li").first()).toContainText(/dispatched/i, { timeout: 10_000 });

      // ── in-flight: the shipment lists with its route, contents and a counting-down ETA ──────────────────
      const inFlightItem = page.locator(".logistics-in-flight-item").first();
      await expect(inFlightItem).toBeVisible();
      await expect(inFlightItem).toContainText("Centauri Prime Orbital");
      await expect(inFlightItem).toContainText("120");
      await expect(inFlightItem.locator(".logistics-in-flight-eta")).toBeVisible();
      if (mobile) await assertNoHorizontalScroll(page);
      await shoot(page, viewport.label, "02-in-flight", viewport.width);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
