// ISP-255d (AB#4826): hunts and the Arbitration Council in protocol language, from the running app at 1280x800.
// Player A, at Wolf 359 with two fleets and 1,200 credits, sends the larger to hunt and is refused for its provisions
// (Unfunded, the server's code), then sends the smaller: it wins (Concluded in the report and the bell) and the belt is
// quiet (In force). Player B, who hired A's other fleet, files a readiness case at the Galactic Arbitration Council:
// Filed, awaiting review in the status line, on its case and on the public docket. Screenshots: e2e/screenshots/ab-4826/.
import { test, expect } from "@playwright/test";
import { openTab, openStationOffices } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4826");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";

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
async function signIn(browser, url, email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\?account=/);
  return { context, page, errors };
}
const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);

test("hunts and the Arbitration Council carry the protocol line, at 1280x800", async ({ browser }) => {
  test.setTimeout(180_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-warfare-protocol-e2e-"));
  const emailA = `hunter-${Date.now()}@example.test`, emailB = `renter-${Date.now()}@example.test`;
  const env = { ...process.env, JWT_SECRET: SECRET };
  let r = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, emailA, emailB, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stdout}\n${r.stderr}`);
  r = spawnSync(process.execPath, ["--input-type=module", "-e", `
    process.env.ISP_DATA_DIR = ${JSON.stringify(dir)}; process.env.NODE_ENV = "test";
    const store = await import("./server/gameState.js");
    const { accountsStore } = await import("./server/game/store.js");
    const { allStations } = await import("./server/game/stations.js");
    const { offerFleet, hireOffer } = await import("./server/mercenaries.js");
    const find = (email) => Object.values(accountsStore.accounts).find((x) => x.email === email);
    const a = find(${JSON.stringify(emailA)}), b = find(${JSON.stringify(emailB)});
    const wolf = allStations().find((s) => s.systemId === "wolf-359").id;
    const now = Date.now();
    store.mutateAccountState(a.id, (s) => {
      s.corp.currentSystemId = "wolf-359";
      s.corp.currentStationId = wolf;
      s.corp.military = { units: { lf: 8, ds: 20, se: 0, at: 18, dt: 0 }, readiness: 100, fleets: [
        { id: "flt-aegis", name: "Aegis", units: { ds: 6, at: 6 }, stationId: wolf, transit: null, formedAt: now - 86400000 },
        { id: "flt-bulwark", name: "Bulwark", units: { ds: 12, at: 12 }, stationId: wolf, transit: null, formedAt: now - 86400000 },
        { id: "flt-corsair", name: "Corsair", units: { lf: 8, ds: 2 }, stationId: wolf, transit: null, formedAt: now - 86400000 }
      ] };
    }, { sanitize: false, settleMining: false });
    const offer = offerFleet(a.id, "flt-corsair", { termHours: 24, price: 5000, collateral: 15000, allowedUse: "defense" }, now);
    if (!offer.ok && !offer.offer) throw new Error("offer: " + JSON.stringify(offer));
    const offerId = (offer.offer || offer).id;
    const hired = hireOffer(b.id, offerId, now);
    if (hired.ok === false || hired.error) throw new Error("hire: " + JSON.stringify(hired));
    store.mutateAccountState(a.id, (s) => { s.corp.finances.credits = 1200; }, { sanitize: false, settleMining: false });
    await store.saveAccountsNow();
    (await import("./server/game/store.js")).saveStateNow();`], { cwd: REPO_ROOT, encoding: "utf8", env });
  if (r.status !== 0) throw new Error(`setup failed: ${r.stdout}\n${r.stderr}`);
  const { child, url } = await startServer(dir);
  try {
    // A: the hunt, refused for provisions, then won
    let s = await signIn(browser, url, emailA);
    let page = s.page;
    await openTab(page, "starmap");
    await page.waitForTimeout(600);
    expect(await mapShow(page, { systemId: "wolf-359", bodyId: "wf-shards" })).toBe(true);
    await page.locator("#hunt-open-btn").click();
    await page.locator('input[name="hunt-fleet"][value="flt-bulwark"]').check();
    await page.locator("#hunt-send-btn").click();
    const notice = page.locator(".starmap__notice");
    await expect(notice).toContainText("Send a smaller fleet, or sell goods to raise the credits.");
    await expect(notice.locator(".protocol-line")).toContainText("Unfunded");
    await notice.scrollIntoViewIfNeeded();
    await notice.locator("xpath=ancestor::*[contains(@class,'ui-panel')][1]").screenshot({ path: path.join(SHOT_DIR, "1-hunt-refused-unfunded.png") }).catch(() => page.screenshot({ path: path.join(SHOT_DIR, "1-hunt-refused-unfunded.png") }));
    await page.locator('input[name="hunt-fleet"][value="flt-aegis"]').check();
    await page.locator("#hunt-send-btn").click();
    await acknowledgeReceipt(page);
    const report = page.locator("[data-hunt-report]");
    await expect(report).toBeVisible({ timeout: 40_000 }); // the hunt lasts 10 s here; the page reads it back 6 s after
    await expect(report.locator(".protocol-line")).toContainText("Concluded");
    await expect(page.locator("[data-belt-quiet] .protocol-line")).toContainText("In force");
    await page.locator("[data-belt-rats]").scrollIntoViewIfNeeded();
    await page.locator("[data-belt-rats]").screenshot({ path: path.join(SHOT_DIR, "2-hunt-won-belt-quiet.png") });
    await page.click("#notification-toggle");
    await expect(page.locator("#notification-list li", { hasText: "Hunt won" }).locator(".protocol-line")).toContainText("Concluded");
    await page.locator("#notification-panel").screenshot({ path: path.join(SHOT_DIR, "3-notification-hunt-won.png") });
    expect(s.errors).toEqual([]);
    await s.context.close();

    // B: a readiness case at the Council
    s = await signIn(browser, url, emailB);
    page = s.page;
    await openTab(page, "station");
    await openStationOffices(page);
    await page.click('[data-building-action="building:galactic-arbitration-council"]');
    await page.locator('input[data-role="gac-type"][value="mercenary-readiness"]').check();
    await page.locator('input[data-role="gac-record"]').first().check();
    await page.locator('[data-role="gac-file"]').click();
    await page.locator("#trade-confirm-ok").click();
    const status = page.locator('[data-role="gac-status"]');
    await expect(status).toContainText("is filed. The respondent has been notified.");
    await expect(status.locator(".protocol-line")).toContainText("Filed, awaiting review");
    const mine = page.locator("[data-gac-mine]");
    await expect(mine.locator(".protocol-line").first()).toContainText("Filed, awaiting review");
    await expect(mine).toContainText("Ruling due");
    await status.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(SHOT_DIR, "4-case-filed-and-yours.png") });
    const docketRow = page.locator("[data-gac-docket]").first();
    await expect(docketRow.locator(".protocol-line")).toContainText("Filed, awaiting review");
    await docketRow.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(SHOT_DIR, "5-docket.png") });
    expect(s.errors).toEqual([]);
    await s.context.close();
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
