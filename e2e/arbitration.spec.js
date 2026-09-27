// ISP-243 (AB#939): the Galactic Arbitration Council's chambers in a real browser at 1280x800 and 375x812. The data
// comes from e2e/seed-arbitration.mjs (the server's own code): Nova Freight has a hired contract to file on, a ruled
// case (upheld), and a pending case where it is the respondent; the docket also holds a dismissed case. Nova files a
// case end to end through the wizard. Each size starts its own freshly seeded server. Screenshots go to
// e2e/screenshots/ab-939/ (gitignored; the PR's are copied to docs/ab-939/).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTab } from "./nav.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "ab-939");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const SECRET = "arbitration-e2e-fixture-secret-0123456789a";
const PASSWORD = "playtest-password-not-real";
const SIZES = [[1280, 800], [375, 812]];

let server, url, logins;
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-arbitration-e2e-"));
  const seeded = spawnSync(process.execPath, ["e2e/seed-arbitration.mjs", dir, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-arbitration.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
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

async function chambers(page, [width, height]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", logins.nova);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  await openTab(page, "station");
  await page.locator('[data-building-action="building:galactic-arbitration-council"]').click();
  await expect(page.locator("[data-gac-chambers] [data-gac-filing]")).toBeVisible({ timeout: 15_000 });
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
const tinyText = (page) => page.evaluate(() => {
  const out = [];
  for (const root of document.querySelectorAll("[data-gac-chambers]")) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el.getClientRects().length) continue;
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

    test(`files a case end to end: claim type, record, evidence preview, fee at ${width}x${height}`, async ({ page }) => {
      await chambers(page, size);
      const filing = page.locator("[data-gac-filing]");
      await filing.locator('input[value="mercenary-readiness"]').check();
      const record = filing.locator('[data-role="gac-record"]');
      await expect(record).toHaveCount(1, { timeout: 15_000 });
      await expect(filing.locator('[data-gac-step="record"]')).toContainText("hired from Kestrel Mining");
      await record.check();
      const evidence = filing.locator("[data-gac-evidence]");
      await expect(evidence).toContainText(/Respondent\s*Kestrel Mining/, { timeout: 15_000 });
      await expect(evidence).toContainText("hour by hour");
      await expect(filing.locator(".gac-preview__rule")).toContainText("Upheld if the owner's readiness fell");
      const claimed = (await evidence.locator("dd").nth(2).innerText()).trim(); // "N credits"
      await shot(page, filing, "wizard", size);
      expect(await sideways(page), "sideways scroll").toBe(0);
      if (width === 375) expect(await tinyText(page), "text under 14px at 375").toEqual([]);

      await filing.locator('[data-role="gac-file"]').click();
      await expect(page.locator("#trade-confirm-title")).toHaveText(/File a mercenary readiness case against Kestrel Mining/);
      await expect(page.locator("#trade-confirm-body")).toContainText("held until the ruling");
      await page.screenshot({ path: path.join(SHOT_DIR, `file-confirm-${width}x${height}.png`), animations: "disabled" });
      await page.locator("#trade-confirm-ok").click();
      await expect(page.locator("[data-gac-filing] [data-role=gac-status]")).toContainText("is filed", { timeout: 15_000 });
      const newest = page.locator("[data-gac-mine] [data-gac-case]").filter({ hasText: "Kestrel Mining" });
      await expect(newest).toHaveCount(1);
      await expect(newest).toContainText("Pending");
      await newest.locator("summary").click();
      await expect(newest).toContainText(new RegExp(`Amount claimed\\s*${claimed}`));
      await expect(page.locator("[data-gac-docket-list] [data-gac-docket]")).toHaveCount(4);
    });

    test(`the docket, a ruling in the Council's words, and a respondent's cure at ${width}x${height}`, async ({ page }) => {
      await chambers(page, size);
      const ruled = page.locator("[data-gac-mine] [data-gac-case]").filter({ hasText: "Halcyon Mining" });
      await expect(ruled).toContainText("Upheld", { timeout: 15_000 });
      await ruled.locator("summary").click();
      await expect(ruled.locator("[data-gac-ruling]")).toContainText(/Readiness below hire readiness \(100\) for \d+ of 72 contract hours\. Upheld: [\d,]+ credits awarded to Nova Freight/);
      const pending = page.locator("[data-gac-mine] [data-gac-case]").filter({ hasText: "Drift Salvage" });
      await pending.locator("summary").click();
      await expect(pending.locator('[data-role="gac-cure"]')).toBeVisible();
      await shot(page, page.locator("[data-gac-mine]"), "cases-ruling", size);
      await shot(page, page.locator("[data-gac-docket-list]"), "docket", size);
      await expect(page.locator("[data-gac-docket-list]")).toContainText("Dismissed");
      await expect(page.locator("[data-gac-docket-list]")).not.toContainText("hour by hour"); // no evidence on the docket
      expect(await sideways(page), "sideways scroll").toBe(0);
      if (width === 375) expect(await tinyText(page), "text under 14px at 375").toEqual([]);
    });
  });
}
