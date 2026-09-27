// ISP-229 (AB#924): ISA concessions on the Starmap, in a real browser at 1280x800 and 375x812. The data comes from
// e2e/seed-concessions.mjs (the server's own code): Halcyon Mining holds Alpha Centauri, the Serpent Pact (a
// conglomerate) holds Luyten 726-8, Kestrel Mining's petition for Barnard's Star is in review, and Nova Freight is
// eligible in Ross 248. Halcyon sees the overlay and its legend, and manages its concession from Alpha Centauri's panel;
// Nova Freight petitions from Ross 248's panel through the confirmation that shows the upkeep. Each size starts its own
// freshly seeded server. Screenshots go to e2e/screenshots/ab-924/ (gitignored; the PR's are copied to docs/ab-924/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";
import { backToCluster, openSystem, recordCanvas } from "./starmapCanvas.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-924");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "concessions-e2e-fixture-secret-0123456789";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1280, 800], [375, 812]];

let server, url, logins;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-concessions-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-concessions.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-concessions.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  logins = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
  server = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
}

async function openStarmap(page, who, [width, height]) {
  await recordCanvas(page);
  await page.setViewportSize({ width, height });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", logins[who]);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "starmap");
  const canvas = page.locator("#starmap-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  return canvas;
}
/** The whole element in one picture: a viewport tall enough to hold it, so the phone's fixed nav sits clear of it. */
async function shot(page, el, name, [width, height]) {
  await page.waitForLoadState("networkidle");
  await expect(el).toBeVisible();
  // At the page's top, in a viewport tall enough to hold the element below the header and above the phone's fixed nav.
  await page.evaluate(() => window.scrollTo(0, 0));
  let box = await el.boundingBox();
  await page.setViewportSize({ width, height: Math.max(height, Math.ceil(box.y + box.height) + 200) });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500); // the map canvas resizes to the new viewport, and the panel below it moves with it
  await page.evaluate(() => window.scrollTo(0, 0));
  box = await el.boundingBox();
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height }, animations: "disabled" });
  await page.setViewportSize({ width, height });
}
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** At 375, the concession section's own text under 14px, as a list. */
const tinyText = (page) => page.evaluate(() => {
  const out = [];
  for (const root of document.querySelectorAll("[data-concession-details], [data-concession-legend]")) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("option")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
  }
  return [...new Set(out)];
});

for (const size of SIZES) {
  const [width, height] = size;
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => server?.kill());

    test(`the overlay, its legend, and the holder's management view at ${width}x${height}`, async ({ page }) => {
      const canvas = await openStarmap(page, "halcyon", size);
      await page.selectOption("#map-overlay", "concessions");
      const legend = page.locator("[data-concession-legend]");
      await expect(legend).toBeVisible({ timeout: 15_000 });
      await expect(legend).toContainText(/You: Halcyon Mining/);
      await expect(legend).toContainText(/Serpent Pact/);
      await expect(legend).toContainText("Petition under review");
      await expect(legend).toContainText("ISA administered");
      await page.waitForTimeout(400);
      await page.locator("#starmap-canvas").screenshot({ path: path.join(SHOT_DIR, `overlay-map-${width}x${height}.png`), animations: "disabled" });
      await shot(page, page.locator("#starmap-dominance-legend"), "overlay-legend", size);

      await openSystem(page, canvas, "Alpha Centauri");
      const holder = page.locator("#map-details [data-concession-holder]");
      await expect(holder).toBeVisible({ timeout: 15_000 });
      await expect(holder).toContainText("In force");
      await expect(holder).toContainText("Everyone's leases");
      await expect(page.locator("#map-details [data-concession-control]")).toContainText("Eligible");
      await shot(page, page.locator("#map-details"), "holder-view", size);
      expect(await sideways(page), "sideways scroll").toBe(0);
      if (width === 375) expect(await tinyText(page), "text under 14px at 375").toEqual([]);
    });

    test(`a petition under review, and an eligible corporation petitioning with the upkeep shown at ${width}x${height}`, async ({ page }) => {
      const canvas = await openStarmap(page, "nova", size);
      await page.selectOption("#map-overlay", "concessions");
      await expect(page.locator("[data-concession-legend]")).toBeVisible({ timeout: 15_000 });
      await openSystem(page, canvas, "Barnard's Star");
      await expect(page.locator("#map-details [data-concession-petitions]")).toContainText(/Kestrel Mining.*petition/, { timeout: 15_000 });
      await shot(page, page.locator("#map-details"), "details-petition", size);

      await backToCluster(page, canvas);
      await openSystem(page, canvas, "Ross 248");
      const petition = page.locator('#map-details [data-role="concession-petition"]');
      await expect(petition).toBeEnabled({ timeout: 15_000 });
      await expect(page.locator("#map-details [data-concession-streak]")).toContainText("eligible on 14 of the last 14 days");
      await shot(page, page.locator("#map-details"), "details-eligible", size);
      await petition.click();
      await expect(page.locator("#trade-confirm-title")).toHaveText(/Petition for Ross 248's concession/);
      await expect(page.locator("#trade-confirm-body")).toContainText("Upkeep if granted");
      await page.screenshot({ path: path.join(SHOT_DIR, `petition-confirm-${width}x${height}.png`), animations: "disabled" });
      await page.locator("#trade-confirm-ok").click();
      await expect(page.locator("#map-details [data-concession-petitions]")).toContainText(/Nova Freight.*petition/, { timeout: 15_000 });
      expect(await sideways(page), "sideways scroll").toBe(0);
      if (width === 375) expect(await tinyText(page), "text under 14px at 375").toEqual([]);
    });
  });
}
