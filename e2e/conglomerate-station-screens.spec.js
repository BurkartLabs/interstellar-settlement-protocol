// ISP-213 (AB#908): the Conglomerate tab's Station screen, from the running app, at 1280 and 375 wide. A founder files
// and funds a project in the UI; a funded project opens on the server's tick and the station joins the station list
// and the starmap; a member with the larger stake sees the stakes the server holds and carries a vote; and the Station
// tab says what membership gets at the member's own station. Screenshots go to e2e/screenshots/ab-908/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-908");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

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

const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);
const openStation = (page, id) => page.evaluate(async (s) => (await import("/scripts/views/starmap.js")).starmap.openStation(s), id);
const api = (page, url) => page.evaluate(async (u) => (await (await import("/scripts/apiClient.js")).apiFetch(u)).json(), url);
const shot = (page, name, label) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${label}.png`) });

async function session(browser, viewport, kind) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
  const page = await context.newPage();
  const email = `${kind}-${Date.now()}-${viewport.width}@example.test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `isp-${kind}-e2e-`));
  const seeded = spawnSync(process.execPath, ["e2e/seed-construction-account.mjs", dir, email, PASSWORD, kind], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (seeded.status !== 0) throw new Error(`seed-construction-account.mjs failed: ${seeded.stdout}\n${seeded.stderr}`);
  const { child, url } = await startServer(dir);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\?account=/);
  const stationTab = async () => {
    await openTab(page, "conglomerate");
    await page.locator('[data-role="cong-tab"][data-tab="station"]').click();
  };
  return { page, errors, stationTab, done: async () => { await context.close(); child.kill(); } };
}

for (const viewport of VIEWPORTS) {
  test(`file and fund a station project from the Conglomerate tab, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const s = await session(browser, viewport, "cg-start");
    const { page } = s;
    try {
      await s.stationTab();
      const none = page.locator('[data-role="cong-station-none"]');
      await expect(none).toContainText("2,000,000 credits, 5,000 Structural Alloys, 2,000 Pressure Vessels, 1,000 Precision Frames");
      await page.selectOption("#cong-station-site", "sol|Venus");
      await page.selectOption("#cong-station-name", "3");
      await none.getByRole("button", { name: "File the station project" }).click();
      await expect(page.locator("#trade-confirm-modal")).toContainText("File Venus Platform?");
      await page.locator("#trade-confirm-ok").click();
      const project = page.locator('[data-role="cong-station-project"]');
      await expect(project).toContainText("Venus Platform");
      // credits from the founder's own account: its stake
      await page.fill("#cong-give-credits", "2,000,000");
      await page.locator('[data-role="cong-station-give"][data-source="own"] button[type="submit"]').click();
      await expect(page.locator("#trade-confirm-modal")).toContainText("Its value becomes your stake in the station");
      await page.locator("#trade-confirm-ok").click();
      await expect(page.locator('[data-role="cong-station-line"][data-input="Credits"]')).toContainText("2,000,000");
      await expect(page.locator('[data-role="cong-station-contributors"]')).toContainText("(you)");
      await project.scrollIntoViewIfNeeded();
      await shot(page, "project-funding", viewport.label);
      // then every good, from the founder's stock at Earth Station Prime
      for (const [item, n] of [["Structural Alloys", "5000"], ["Pressure Vessels", "2000"], ["Precision Frames", "1000"]]) {
        await page.selectOption("#cong-give-item", item);
        await page.fill("#cong-give-qty", n);
        await page.locator('[data-role="cong-station-give"][data-source="own"] button[type="submit"]').click();
        await page.locator("#trade-confirm-ok").click();
        await expect(page.locator(`[data-role="cong-station-line"][data-input="${item}"]`)).toContainText(Number(n).toLocaleString("en-US"));
      }
      await expect(page.locator('[data-role="cong-station-clock"]')).toContainText("Fully funded.");
      await expect(page.locator('[data-role="cong-station-give"]')).toHaveCount(0);
      await project.scrollIntoViewIfNeeded();
      await shot(page, "project-building", viewport.label);
      expect(s.errors).toEqual([]);
    } finally {
      await s.done();
    }
  });

  test(`a funded project opens on the tick, and the station joins the station list and the starmap, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const s = await session(browser, viewport, "cg-opening");
    const { page } = s;
    try {
      await s.stationTab();
      await expect(page.locator('[data-role="cong-station-clock"]')).toContainText("opens");
      await shot(page, "project-opening", viewport.label);
      // the server's tick opens it; the room's event redraws the tab and refreshes the station list
      await expect(page.locator('[data-role="cong-station-built"]')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-role="cong-station-built"]')).toContainText("Venus Platform");
      await page.locator('[data-role="cong-station-built"]').scrollIntoViewIfNeeded();
      await shot(page, "station-built", viewport.label);
      await openTab(page, "logistics");
      await expect(page.locator(".logistics__station", { hasText: "Venus Platform" })).toBeVisible();
      await openTab(page, "starmap");
      await page.waitForTimeout(600);
      expect(await mapShow(page, { systemId: "sol" })).toBe(true);
      await openStation(page, "cg-venus");
      await expect(page.locator("#starmap-station-modal")).toContainText("Owned by Venus Builders Guild");
      await shot(page, "station-on-starmap", viewport.label);
      expect(s.errors).toEqual([]);
    } finally {
      await s.done();
    }
  });

  test(`stakes as the server holds them, a vote carried, and the member's view from the Station tab, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const s = await session(browser, viewport, "cg-gov");
    const { page } = s;
    try {
      // the Station tab, docked at the member's own station
      await openTab(page, "station");
      const own = page.locator('[data-role="own-station-panel"]');
      await expect(own).toContainText("your suite here costs 500 credits a day (50% of 1,000)");
      await own.scrollIntoViewIfNeeded();
      await shot(page, "station-tab-member", viewport.label);
      await own.getByRole("button", { name: "Stakes and votes" }).click();
      const built = page.locator('[data-role="cong-station-built"]');
      await expect(built).toBeVisible();
      // the stakes shown are the server's
      const ids = await page.evaluate(async () => { const { appState } = await import("/scripts/state.js"); return { cid: appState.conglomerate.id, accountId: appState.accountId }; });
      const gov = await api(page, `/api/accounts/${ids.accountId}/conglomerates/${ids.cid}/station`);
      expect(gov.stakes).toHaveLength(2);
      for (const st of gov.stakes) await expect(page.locator(`[data-role="cong-stake"][data-corp="${st.corp}"]`)).toContainText(`${st.pct.toFixed(2)}%`);
      await expect(built).toContainText(/Your stake: \d+\.\d\d%/);
      await expect(page.locator('[data-role="cong-station-benefits"]')).toContainText("A member's suite here costs 500 credits a day, not 1,000");
      await page.locator('[data-role="cong-station-stakes"]').scrollIntoViewIfNeeded();
      await shot(page, "station-stakes", viewport.label);
      const proposal = page.locator('[data-role="cong-proposal"]');
      await expect(proposal).toContainText("Docking at the station: members only");
      await proposal.scrollIntoViewIfNeeded();
      await shot(page, "station-vote-open", viewport.label);
      await proposal.getByRole("button", { name: "Vote yes" }).click();
      await expect(page.locator('[data-role="cong-vote-status"]')).toContainText("Your vote carried it");
      await expect(page.locator('[data-role="cong-station-access"]')).toHaveText("Members only");
      await page.locator('[data-role="cong-station-governance"]').scrollIntoViewIfNeeded();
      await shot(page, "station-vote-carried", viewport.label);
      const ox = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ox).toBeLessThanOrEqual(0);
      expect(s.errors).toEqual([]);
    } finally {
      await s.done();
    }
  });
}
