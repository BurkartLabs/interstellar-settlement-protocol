// ISP-237 (AB#932): the patent office at Corporate Registry & Charters, and the royalty on a patented chain before a
// refinery run starts, in a real browser at 1280x800 and 375x812. The data comes from e2e/seed-patents.mjs (the server's
// own code): Nova Freight may file Fusion Fuel Cycle, holds Deep-Core Extraction, and pays on Kestrel Mining's chain.
// Each size starts its own freshly seeded server. Screenshots go to e2e/screenshots/ab-932/ (gitignored; the PR's are
// copied to docs/ab-932/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab, openStationOffices } from "./nav.mjs";
import { runRoyaltyQuote } from "../public/scripts/refineryRoyalty.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-932");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "patents-e2e-fixture-secret-0123456789ab";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1280, 800], [375, 812]];

let server, url, logins;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-patents-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-patents.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-patents.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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

async function logIn(page, who, [width, height]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", logins[who]);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
}
/** The whole element in one picture: a viewport tall enough to hold it, so the phone's fixed nav sits clear of it. */
async function shot(page, el, name, [width, height]) {
  await page.waitForLoadState("networkidle");
  await expect(el).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  let box = await el.boundingBox();
  await page.setViewportSize({ width, height: Math.max(height, Math.ceil(box.y + box.height) + 200) });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  box = await el.boundingBox();
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}x${height}.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height }, animations: "disabled" });
  await page.setViewportSize({ width, height });
}
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** At 375, the office's own text under 14px, as a list. */
const tinyText = (page, selector) => page.evaluate((sel) => {
  const out = [];
  for (const root of document.querySelectorAll(sel)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length || el.closest("option")) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < 14) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 30)}" ${f}px`);
    }
  }
  return [...new Set(out)];
}, selector);

for (const size of SIZES) {
  const [width, height] = size;
  test.describe(`${width}x${height}`, () => {
    test.beforeAll(start);
    test.afterAll(() => server?.kill());

    test(`the patent office: file, own patents, patents paid on and the register at ${width}x${height}`, async ({ page }) => {
      await logIn(page, "nova", size);
      await openTab(page, "station");
      await openStationOffices(page); // AB#2471: the offices are the Station's Offices subpage
      await page.locator('[data-building-action="building:corporate-registry-charters"]').click();
      const officeEl = page.locator("[data-patent-office]");
      await expect(officeEl.locator("[data-patent-filable]")).toHaveCount(1, { timeout: 15_000 });
      await expect(officeEl.locator("[data-patent-filable]")).toContainText("Fusion Fuel Cycle");
      await expect(officeEl.locator("[data-patent-mine-list]")).toContainText("Deep-Core Extraction");
      await expect(officeEl.locator("[data-patent-paying-list]")).toContainText("Kestrel Mining");
      await expect(officeEl.locator("[data-patent-register-list] [data-patent-register]")).toHaveCount(3);
      await shot(page, page.locator("#station-building-content"), "patent-office", size);
      expect(await sideways(page), "sideways scroll").toBe(0);
      if (width === 375) expect(await tinyText(page, "[data-patent-office]"), "text under 14px at 375").toEqual([]);

      await officeEl.locator('[data-role="patent-rate"]').selectOption("8");
      await officeEl.locator('[data-role="patent-file"]').click();
      await expect(page.locator("#trade-confirm-title")).toHaveText(/File a patent on Fusion Fuel Cycle/);
      await expect(page.locator("#trade-confirm-body")).toContainText("5,000 credits, paid to the ISA");
      await page.screenshot({ path: path.join(SHOT_DIR, `file-confirm-${width}x${height}.png`), animations: "disabled" });
      await page.locator("#trade-confirm-ok").click();
      await expect(officeEl.locator("[data-patent-mine]")).toHaveCount(2, { timeout: 15_000 });
      await expect(officeEl.locator("[data-patent-mine-list]")).toContainText("Fusion Fuel Cycle");
      await expect(officeEl.locator("[data-patent-filable]")).toHaveCount(0);
      await expect(officeEl.locator("[data-patent-register]")).toHaveCount(4);
      await shot(page, page.locator("#station-building-content"), "patent-filed", size);
    });

    test(`a refinery run of another's patented chain shows its royalty before it starts at ${width}x${height}`, async ({ page }) => {
      await logIn(page, "nova", size);
      await openTab(page, "refinery");
      const card = page.locator("#chain-pressure-vessel-chain");
      // Bug AB#4682: the Refinery redraws when its data arrives, so a node scrolled to before then can be gone by the
      // click ("Element is not attached to the DOM"). The button is found by its chain at the moment of use, once drawn,
      // and a click scrolls it into view and retries a node that was replaced.
      const start = page.locator('.refinery__start[data-chain-id="pressure-vessel-chain"]');
      await expect(start).toBeVisible({ timeout: 15_000 });
      await start.click();
      await expect(page.locator("#trade-confirm-title")).toHaveText(/under Kestrel Mining .*'s patent/, { timeout: 15_000 });
      // the quote the page shows is the shared arithmetic's, for the run's own output (800 alloy: 10 batches, 250 vessels)
      const quote = runRoyaltyQuote({ patent: { holder: "Kestrel Mining", ratePct: 4, endsAt: Date.now() }, chain: { outputs: [{ item: "Pressure Vessels", quantityPerCycle: 25 }] }, batches: 10, basePrices: { "Pressure Vessels": 129 } });
      await expect(page.locator("#trade-confirm-body")).toContainText(`${quote.royalty.toLocaleString("en-US")} credits: 4% of the output's ${quote.value.toLocaleString("en-US")} at the standing bid`);
      await expect(page.locator("#trade-confirm-ok")).toHaveText(`Start run (royalty ${quote.royalty.toLocaleString("en-US")} credits)`);
      await page.screenshot({ path: path.join(SHOT_DIR, `refinery-royalty-${width}x${height}.png`), animations: "disabled" });
      expect(await sideways(page), "sideways scroll").toBe(0);
      await page.locator("#trade-confirm-cancel").click();
      await expect(page.locator("#trade-confirm-modal")).toBeHidden();
      await expect(card.locator(".refinery__start")).toHaveText("Start Run"); // cancelled: nothing started
    });
  });
}
