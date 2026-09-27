// ISP-82 (AB#771): the Starmap, the dialogue (with Elara Voss's portrait) and the walkthrough, rebuilt on the design
// system, in a real browser at 375x812, 768x1024 and 1280x800. The dialogue and the walkthrough are what a new player
// meets: register, verify, log in, the coordinator's offer, then "Brief me". The Starmap is a seeded corporation's
// (e2e/seed-starmap-account.mjs): the cluster, Sol's belt with its composition, an expedition out and the launch form,
// Earth with its stations, and a station opened. No sideways scroll; at 375, no visible text under 14px and every
// control at least 44px each way (only a link inside running text is exempt). The map's own labels are on a canvas,
// where these checks cannot read: tests/unit/starmapDialogue.test.js holds them to chartFont instead.
// Screenshots go to e2e/screenshots/ab-771/ (gitignored; the pull request's are copied to docs/ab-771/).
//
// Run: `npx playwright test e2e/starmap-dialogue.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";
import { verifyAndLogIn } from "./verification.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-771");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "starmap-dialogue-e2e-fixture-secret-012345";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[375, 812], [768, 1024], [1280, 800]];

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "1", ISP_DISABLE_TICKERS: "1" },
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

/** The measures every surface is held to, inside the element `selector` names. */
async function measure(page, selector, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${selector}: sideways scroll`).toBe(0);
  if (width !== 375) return;
  const tiny = await page.locator(selector).evaluate((root) => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("[hidden], canvas, option")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
    return out;
  });
  expect(tiny, `${selector}: text under 14px`).toEqual([]);
  const small = await page.locator(selector).locator("button:visible, input:visible, select:visible, textarea:visible, a:visible").evaluateAll((els) =>
    els
      .filter((el) => !(el.tagName === "A" && el.closest("p")))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el.tagName} "${(el.textContent || el.id || el.className).trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  );
  expect(small, `${selector}: controls under 44px`).toEqual([]);
}

/** Ask the page's own Starmap controller to show something, as a click on the map would. */
const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);

for (const [width, height] of SIZES) {
  test(`the dialogue, the walkthrough and the Starmap at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(150_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-starmap-dialogue-e2e-"));
    const seededEmail = `starmap-${width}-${Date.now()}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-starmap-account.mjs", dir, seededEmail, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-starmap-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (name, full = false) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), fullPage: full });
    try {
      await page.setViewportSize({ width, height });

      // A new player: the coordinator's offer is the dialogue, with her portrait.
      const email = `dialogue-${width}-${Date.now()}@example.test`;
      await page.goto(`${url}/register.html`);
      await page.fill("#register-email", email);
      await page.fill("#register-password", PASSWORD);
      await page.fill("#register-ceo", "Dialogue QA");
      await page.fill("#register-corp", `Dialogue Corp ${Date.now()}`);
      await page.click('#register-form button[type="submit"]');
      await verifyAndLogIn(page, url, email, PASSWORD);
      await page.waitForURL(/\/\?account=/);
      const dialogue = page.locator("#dialogue-modal");
      await expect(dialogue.getByRole("button", { name: "Brief me" })).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("#dialogue-portrait")).toBeVisible();
      await measure(page, "#dialogue-modal .modal-card", width);
      await shot("dialogue");

      // Accepting it starts the walkthrough: its card, and the outline on what step 1 asks for.
      await dialogue.getByRole("button", { name: "Brief me" }).click();
      await expect(dialogue).toBeHidden();
      await expect(page.locator("#walkthrough-modal")).toBeVisible();
      await expect(page.locator("#walkthrough-progress")).toHaveText(/^1 of \d+$/);
      await expect(page.locator(".walkthrough__focus").first()).toBeAttached({ timeout: 10_000 });
      await measure(page, "#walkthrough-modal .modal-card", width);
      await shot("walkthrough");
      await page.click("#walkthrough-end");
      await expect(page.locator("#walkthrough-modal")).toBeHidden();

      // The seeded corporation's Starmap.
      await page.evaluate(() => localStorage.clear());
      await page.context().clearCookies();
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", seededEmail);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "starmap");
      await expect(page.locator("#map-details .ui-panel__title")).toHaveText("Star Cluster");
      await measure(page, "#starmap", width);
      await shot("starmap-cluster", true);
      await page.locator("#starmap-canvas").screenshot({ path: path.join(SHOT_DIR, `canvas-cluster-${width}x${height}.png`) });

      expect(await mapShow(page, { systemId: "sol", bodyId: "belt" })).toBe(true);
      await expect(page.locator("#map-details")).toContainText("Material Composition", { timeout: 10_000 });
      await expect(page.locator("#map-details [data-role=starmap-expedition] .progress-wrap")).toBeVisible();
      await expect(page.locator("#launch-expedition-btn")).toBeVisible();
      await measure(page, "#starmap", width);
      await page.locator("#map-details").scrollIntoViewIfNeeded();
      await shot("starmap-belt", true);

      expect(await mapShow(page, { systemId: "sol", bodyId: "earth" })).toBe(true);
      await expect(page.locator("#map-details .starmap__stations")).toBeVisible();
      await expect(page.locator("#map-details .ui-badge--accent")).toHaveText("Docked");
      await measure(page, "#starmap", width);
      await shot("starmap-earth", true);

      await page.evaluate(async () => (await import("/scripts/views/starmap.js")).starmap.openStation("mars-orbital-dock"));
      const station = page.locator("#starmap-station-modal");
      await expect(station.locator(".starmap__station-title")).toHaveText("Mars Orbital Dock");
      await measure(page, "#starmap-station-modal .modal-card", width);
      await shot("starmap-station");
      await station.locator(".starmap__close").click();
      await expect(station).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
