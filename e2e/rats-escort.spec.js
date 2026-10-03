// AB#821 (docs/design/rats.md, section 7): the belt panel's escort picker and Rats figures, and the report of an
// escorted expedition that met them, from the running app. A corporation in Wolf 359 (density 31) with two fleets there
// and one at Earth picks its strong fleet as escort for a Deep Core Drill: the panel shows the chance of meeting Rats
// with and without it (checked against server/game/rats.js's encounterChance for the same inputs), the chance the escort
// holds, the haul expected home and the provisions, and says why the fleet at Earth cannot escort. Then it launches.
//
// The encounters are drawn at settlement from an HMAC of the server's secret and the expedition's id, and the id is made
// at launch; so the launch runs on a server with no ticks, and the expedition is settled by a second server on the same
// data whose secret is one under which that id meets Rats (found here with the server's own planEncounters). Everything
// the report says is the tick's: the fight, the losses and the haul taken. At 1440x900 and 390x844; screenshots go to
// e2e/screenshots/ab-821/.
import { test, expect } from "@playwright/test";
import { openTab, toggleNotifications } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encounterChance, forcePower, planEncounters, seedFor } from "../server/game/rats.js";
import { outlookPct } from "../public/scripts/launchOutlook.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-821");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";
const WOLF = "wolf-359", BELT = "wf-shards", DENSITY = 31, HOURS = 2;
const STRONG = { ds: 6, at: 6 }, WEAK = { lf: 4 };
const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900, mobile: false },
  { label: "390x844", width: 390, height: 844, mobile: true }
];

function startServer(dir, env = {}) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ...env },
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
const stop = (child) => new Promise((resolve) => { if (child.exitCode !== null) resolve(); else { child.once("exit", resolve); child.kill(); } });
const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);
async function signIn(browser, url, viewport, email) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
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
/** Run a module script against the data directory (the server is stopped). */
function onData(dir, code) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
    process.env.ISP_DATA_DIR = ${JSON.stringify(dir)}; process.env.NODE_ENV = "test";
    const store = await import("./server/gameState.js");
    const { accountsStore } = await import("./server/game/store.js");
    const { allStations } = await import("./server/game/stations.js");
    ${code}
    await store.saveAccountsNow();`], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (r.status !== 0) throw new Error(`data script failed: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

for (const viewport of VIEWPORTS) {
  test(`an escort chosen at launch, and the report of the Rats it fought, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-rats-escort-e2e-"));
    const email = `escort-${Date.now()}-${viewport.width}@example.test`;
    const r = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, email, `other-${email}`, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stdout}\n${r.stderr}`);
    // docked in Wolf 359 with its belt scouted, probes, and three fleets: two at the Wolf station, one at Earth
    onData(dir, `
      const a = Object.values(accountsStore.accounts).find((x) => x.email === ${JSON.stringify(email)});
      const wolf = allStations().find((s) => s.systemId === ${JSON.stringify(WOLF)}).id;
      store.mutateAccountState(a.id, (s) => {
        s.corp.currentSystemId = ${JSON.stringify(WOLF)};
        s.corp.currentStationId = wolf;
        s.corp.asteroidMining = { probeCount: 2, maxDeployments: 2, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [], scoutedBelts: [${JSON.stringify(`${WOLF}:${BELT}`)}], scoutedGenerations: { ${JSON.stringify(`${WOLF}:${BELT}`)}: 1 } };
        s.corp.military = { units: { lf: 4, ds: 12, se: 0, at: 12, dt: 0 }, readiness: 100, fleets: [
          { id: "flt-a", name: "Aegis", units: ${JSON.stringify(STRONG)}, stationId: wolf, transit: null, formedAt: Date.now() },
          { id: "flt-c", name: "Corsair", units: ${JSON.stringify(WEAK)}, stationId: wolf, transit: null, formedAt: Date.now() },
          { id: "flt-b", name: "Bastion", units: ${JSON.stringify(STRONG)}, stationId: "earth-station-prime", transit: null, formedAt: Date.now() }
        ] };
      }, { sanitize: false, settleMining: false });`);

    // 1. the launch, on a server that settles nothing
    let server = await startServer(dir, { ISP_DISABLE_TICKERS: "1" });
    let session = await signIn(browser, server.url, viewport, email);
    try {
      const { page } = session;
      await openTab(page, "starmap");
      await page.waitForTimeout(600);
      expect(await mapShow(page, { systemId: WOLF, bodyId: BELT })).toBe(true);
      await page.locator("#expedition-duration").selectOption("extended");
      await expect(page.locator("#expedition-escort option[value='own:flt-a']")).toBeEnabled();
      await page.locator("#expedition-escort").selectOption("own:flt-a");
      const risk = (role) => page.locator(`[data-risk="${role}"]`);
      // the figures shown are the server's formula for these inputs
      await expect(risk("chance-unescorted")).toHaveText(outlookPct(encounterChance(DENSITY, HOURS, 0)));
      await expect(risk("chance-escorted")).toHaveText(outlookPct(encounterChance(DENSITY, HOURS, forcePower(STRONG))));
      await expect(risk("hold-chance")).not.toBeEmpty();
      await expect(risk("provisions")).toContainText("1,800");
      // the fleet at Earth is offered disabled, with the reason
      await expect(page.locator("#expedition-escort option[value='own:flt-b']")).toBeDisabled();
      await expect(page.locator("[data-role=escort-unable]")).toContainText("Bastion cannot escort: An escort must be stationed in the belt's system");
      await page.locator("#expedition-escort").evaluate((el) => el.scrollIntoView({ block: "center" })); // the picker and the figures in sight
      await page.screenshot({ path: path.join(SHOT_DIR, `launch-panel-escort-${viewport.label}.png`) });
      await page.locator("#launch-expedition-btn").click();
      const receipt = page.locator("#action-receipt-modal");
      await expect(receipt).toBeVisible();
      await expect(receipt).toContainText(/Chance of meeting Rats\s*\d+% with the escort/);
      await page.waitForTimeout(1500); // the accounts snapshot is written 500 ms after a change
      expect(session.errors).toEqual([]);
    } finally {
      await session.context.close();
      await stop(server.child);
    }

    // 2. a seed secret under which this expedition meets Rats, found with the server's own plan
    const expId = onData(dir, `
      const a = Object.values(accountsStore.accounts).find((x) => x.email === ${JSON.stringify(email)});
      const exp = a.state.corp.asteroidMining.activeExpeditions[0];
      if (!exp?.rats?.escortFleetId) throw new Error("no escorted expedition was launched");
      console.log("ID=" + exp.id);`).match(/ID=(\S+)/)[1];
    let ratSecret = null;
    for (let i = 0; i < 500 && !ratSecret; i += 1) {
      const candidate = `rats-e2e-seed-secret-${i}`;
      if (planEncounters(seedFor(expId, candidate), DENSITY, HOURS, forcePower(STRONG)).length >= 1) ratSecret = candidate;
    }
    expect(ratSecret).not.toBeNull();

    // 3. the tick settles it: the notification and the probe-return report
    server = await startServer(dir, { ISP_RAT_SEED_SECRET: ratSecret });
    session = await signIn(browser, server.url, viewport, email);
    try {
      const { page } = session;
      await toggleNotifications(page);
      const item = page.locator("#notification-list li", { hasText: "Expedition Complete" }).first();
      await expect(item).toBeVisible({ timeout: 45_000 });
      await expect(item).toContainText(/Met Rats (once|twice|\d+ times)\. The escort (held|was beaten)/);
      await expect(item).toContainText(/The haul is intact\.|Rats took [\d,]+ units of the haul\./);
      await item.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `report-notification-${viewport.label}.png`) });
      await toggleNotifications(page); // closes the list (Escape does not on a phone)
      await openTab(page, "inbox");
      await page.locator("#inbox-message-list .inbox__message", { hasText: "Mining Probe Return" }).first().click();
      const detail = page.locator("#inbox-detail-view");
      await expect(detail).toContainText("PIRATE ACTIVITY");
      await expect(detail).toContainText(/Encounter 1, \d+% of the way through: \d+ Light Fighters and \d+ Destroyers\. The escort (held|was beaten)/);
      await detail.getByText("PIRATE ACTIVITY").scrollIntoViewIfNeeded().catch(() => {});
      await page.screenshot({ path: path.join(SHOT_DIR, `report-inbox-${viewport.label}.png`) });
      expect(session.errors).toEqual([]);
    } finally {
      await session.context.close();
      await stop(server.child);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
