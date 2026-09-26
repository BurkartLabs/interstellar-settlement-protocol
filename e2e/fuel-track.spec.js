// AB#830: the Fuel track on screen, from the running game: the two new chains in Refinery Chains with their inputs on
// hand, Fusion Fuel Cycle in Corporate R&D, the Lunar Helium Consortium's new standing bids on the Exchange, and the
// Station at Frost Relay Depot, whose moon Rime now takes a lease. Starts its own server on a seeded data dir
// (e2e/seed-fuel-account.mjs).
//
// Run: npx playwright test e2e/fuel-track.spec.js (no server needed).
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_DIR = path.join(process.cwd(), "e2e", "screenshots");
fs.mkdirSync(SCREEN_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "fuel-track-e2e-fixture-secret-0123456789ab";

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

async function look(page, locator, name) {
  await locator.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`) });
  await test.info().attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

for (const vp of [{ label: "1280x800", width: 1280, height: 800 }, { label: "375x812", width: 375, height: 812 }]) {
  test(`the Fuel track's chains, research, bids and lease are on screen, at ${vp.label}`, async ({ page }) => {
    test.setTimeout(90_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-fuel-e2e-"));
    const email = `fuel-${Date.now()}-${vp.width}@example.test`;
    execFileSync(process.execPath, ["e2e/seed-fuel-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, env: { ...process.env, JWT_SECRET: SECRET } });
    const { child, url } = await startServer(dir);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\/\?account=/);

      // Only what is on screen: a hidden tab holds the same words (Fusion Fuel Cycle's card in R&D).
      const shown = (text) => page.getByText(text).locator("visible=true").first();
      await openTab(page, "refinery");
      const fusion = shown("40 Helium-3 + 80 Deuterium per batch → 40 Fusion Pellets");
      await expect(fusion).toBeVisible();
      await expect(shown("200 Water Ice + 200 Hydrogen per batch → 60 Cryogenic Coolant")).toBeVisible();
      // Starting a chain of several inputs from the page is AB#836's; until then the card says so.
      await expect(shown("This chain takes several inputs. Starting it from this page arrives in a later build.")).toBeVisible();
      await look(page, fusion, `ab830-refinery-${vp.label}`);

      await openTab(page, "rnd");
      const node = shown("Fusion Fuel Cycle");
      await expect(node).toBeVisible();
      await look(page, node, `ab830-rnd-${vp.label}`);

      await openTab(page, "market");
      // The Lunar Helium Consortium's rows in the standing buy orders.
      const bid = page.locator("#exchange-standing-section tr", { hasText: "Fusion Pellets" }).first();
      await expect(bid).toBeVisible();
      await expect(bid).toContainText("Lunar Helium Consortium");
      await expect(page.locator("#exchange-standing-section tr", { hasText: "Deuterium" }).first()).toContainText("40");
      await look(page, bid, `ab830-bids-${vp.label}`);

      await openTab(page, "station");
      // Rime, the moon the depot orbits, now takes a lease; the picker needs an office here (the integration test leases it).
      const rime = shown("Rime");
      await expect(rime).toBeVisible();
      await look(page, rime, `ab830-station-${vp.label}`);
      expect(errors).toEqual([]);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
