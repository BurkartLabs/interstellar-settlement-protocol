// ISP-142 (AB#836): the Refinery Chains panel for chains of several inputs, in the running game at 1440x900 and 390x844.
// A two-input chain with one input short marks it and its Start button names it; the batches field redraws what a run
// needs; "Made by" goes to the chain that makes an input; and a cross-track chain that is ready starts from the form,
// with the server's receipt and the run on Active runs. Screenshots are taken after each action, from the page as the
// server left it (DOCTRINE constraint 3): e2e/screenshots/ab-836/ (gitignored; the pull request's are in docs/ab-836/).
//
// Run: `npx playwright test e2e/multi-input-panel.spec.js` (it starts its own server).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-836");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "multi-input-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const FUSION_INPUTS = "20 Fusion Pellets + 10 Rare-Earth Magnets + 20 Cryogenic Coolant";

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

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`the multi-input panel: short, linked, and started, at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-multi-input-e2e-"));
    const email = `planner-${width}-${Date.now()}@example.test`;
    const seeded = spawnSync(process.execPath, ["e2e/seed-planner-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (seeded.status !== 0) throw new Error(`seed-planner-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (name, target = page) => target.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`) });
    // The page redraws the chains every few seconds, so a card found a moment ago can be replaced mid-scroll; try again.
    const shotOf = async (name, card) => {
      await expect(async () => {
        await card.locator(".refinery__start").evaluate((el) => el.scrollIntoView({ block: "center" }), undefined, { timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      await shot(name);
    };
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click("#credential-login-btn");
      await page.waitForURL(/\/\?account=/);
      await openTab(page, "refinery");

      // A two-input chain with one input short: 40 Nickel held, 50 a batch.
      const smelting = page.locator("#chain-smelting-chain");
      await expect(smelting.locator(".ui-card__title")).toHaveText("Nickel-Iron Alloy");
      const nickel = smelting.locator('[data-input-item="Nickel"]');
      await expect(nickel.locator('[data-role="amounts"]')).toHaveText("Needs 50 · holds 40");
      await expect(nickel.locator('[data-role="short"]')).toHaveText("Short by 10");
      await expect(nickel).toHaveClass(/refinery__input--short/);
      await expect(smelting.locator('[data-input-item="Iron Ore"] [data-role="enough"]')).toHaveText("Enough");
      await expect(smelting.locator('[data-input-item="Iron Ore"]')).toContainText("Made by: no chain; mined or bought");
      await expect(smelting.locator('[data-output-item="Nickel-Iron Alloy"]')).toContainText("Used by: Nickel-Iron Alloy → Pressure Vessels");
      await expect(smelting.locator(".refinery__start")).toHaveText("Short: Nickel");
      await expect(smelting.locator(".refinery__start")).toBeDisabled();
      await shotOf("two-input-short", smelting);

      // "Made by" goes to the chain that makes the input.
      const fusion = page.locator("#chain-fusion-core-chain");
      const magnetLink = fusion.locator('[data-input-item="Rare-Earth Magnets"] [data-chain-link="magnet-chain"]');
      await expect(magnetLink).toHaveText("Rare Earths + Cobalt → Rare-Earth Magnets");
      await magnetLink.click();
      await expect(page.locator("#chain-magnet-chain")).toBeFocused();
      await expect(page.locator("#chain-magnet-chain")).toBeInViewport();

      // The batches field redraws what a run needs: two batches of the cross-track chain is more than is held.
      const batches = fusion.locator(".refinery__batches");
      await expect(batches).toHaveValue("1");
      await batches.fill("2");
      await expect(fusion.locator('[data-input-item="Fusion Pellets"] [data-role="amounts"]')).toHaveText("Needs 40 · holds 20");
      await expect(fusion.locator(".refinery__start")).toHaveText("Short: Fusion Pellets, Rare-Earth Magnets, Cryogenic Coolant");
      await batches.fill("1");

      // Ready: every input enough, and the button starts it.
      for (const item of ["Fusion Pellets", "Rare-Earth Magnets", "Cryogenic Coolant"]) {
        await expect(fusion.locator(`[data-input-item="${item}"] [data-role="enough"]`), item).toHaveText("Enough");
      }
      await expect(fusion.locator('[data-output-item="Fusion Reactor Cores"]')).toContainText("Used by: no chain; a final product");
      await expect(fusion.locator(".refinery__start")).toHaveText("Start Run");
      await expect(fusion.locator(".refinery__start")).toBeEnabled();
      await shotOf("cross-track-ready", fusion);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways scroll").toBe(0);

      await fusion.locator(".refinery__start").click();
      await expect(page.locator("#action-receipt-title")).toHaveText("Production Run Started", { timeout: 10_000 });
      await expect(page.locator("#action-receipt-body")).toContainText(FUSION_INPUTS);
      await expect(page.locator("#action-receipt-body")).toContainText("4 Fusion Reactor Cores");
      await shot("cross-track-started");
      await page.keyboard.press("Escape");
      await expect(page.locator("#refinery-active-runs")).toContainText(`Processing: ${FUSION_INPUTS} → 4 Fusion Reactor Cores`);
      await expect(page.locator("#refinery-status")).toContainText(`Refinery run started: ${FUSION_INPUTS}, ready in 12h.`);
      await expect(async () => { await page.locator("#refinery-active-runs").scrollIntoViewIfNeeded({ timeout: 2_000 }); }).toPass({ timeout: 15_000 });
      await shot("cross-track-running");
      expect(errors).toEqual([]);
    } finally {
      child.kill();
    }
  });
}
