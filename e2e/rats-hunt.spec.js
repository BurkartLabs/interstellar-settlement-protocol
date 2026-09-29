// ISP-285 (AB#992): Rats on the Starmap, and a hunt, in the running game at 1440x900 and 390x844. The cluster view's
// Pirate activity overlay and its legend; Wolf 359's Shard Belt panel with its chance and the hunt screen, which lists
// only the fleets that can hunt it and shows the expected battle before anything is sent; then the hunt, sent from
// that screen, resolved by the server's own ticker, and its battle report in the belt's panel. Nothing is mocked: the
// account is seeded with a fleet stationed at Wolf 359 and the rest is the page and the server.
// Screenshots go to e2e/screenshots/ab-992/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-992");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "rats-hunt-e2e-fixture-secret-0123456789ab";
const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900, mobile: false },
  { label: "390x844", width: 390, height: 844, mobile: true }
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

for (const viewport of VIEWPORTS) {
  test(`pirate activity on the map, and a hunt from the Shard Belt, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-rats-hunt-e2e-"));
    const email = `hunt-${Date.now()}-${viewport.width}@example.test`;
    const env = { ...process.env, JWT_SECRET: SECRET };
    let r = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, email, `other-${email}`, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stdout}\n${r.stderr}`);
    // a fleet of 6 Destroyers and 6 Attack Troops stationed at Wolf 359, and one at Earth, which cannot hunt there
    r = spawnSync(process.execPath, ["--input-type=module", "-e", `
      process.env.ISP_DATA_DIR = ${JSON.stringify(dir)}; process.env.NODE_ENV = "test";
      const store = await import("./server/gameState.js");
      const { accountsStore } = await import("./server/game/store.js");
      const { allStations } = await import("./server/game/stations.js");
      const wolf = allStations().find((s) => s.systemId === "wolf-359").id;
      const a = Object.values(accountsStore.accounts).find((x) => x.email === ${JSON.stringify(email)});
      store.mutateAccountState(a.id, (s) => {
        s.corp.finances.credits = 500000;
        s.corp.military = { ...(s.corp.military || {}), units: { lf: 0, ds: 12, se: 0, at: 12, dt: 0 }, readiness: 100,
          fleets: [
            { id: "flt-aegis", name: "Aegis", units: { ds: 6, at: 6 }, stationId: wolf, transit: null, formedAt: Date.now() },
            { id: "flt-home", name: "Bastion", units: { ds: 6, at: 6 }, stationId: "earth-station-prime", transit: null, formedAt: Date.now() }
          ] };
      }, { sanitize: false, settleMining: false });
      await store.saveAccountsNow();`], { cwd: REPO_ROOT, encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`setup failed: ${r.stdout}\n${r.stderr}`);
    const { child, url } = await startServer(dir);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${url}/login.html`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", PASSWORD);
      await page.click('#login-form button[type="submit"]');
      await page.waitForURL(/\?account=/);
      await openTab(page, "starmap");
      await page.waitForTimeout(600);

      // 1. the cluster, under Pirate activity: the server's reading, in five bands with a legend
      await page.selectOption("#map-overlay", "rats");
      const legend = page.locator("#starmap-dominance-legend");
      await expect(legend.locator("[data-rats-legend]")).toBeVisible();
      await expect(legend).toContainText("None is quiet now");
      const activity = await page.evaluate(async () => {
        const { appState } = await import("/scripts/state.js");
        const id = appState.accountId;
        const { apiFetch, parseJsonResponse } = await import("/scripts/apiClient.js");
        return parseJsonResponse(await apiFetch(`/api/accounts/${id}/gameplay/rats/activity`));
      });
      const wolf = activity.systems.find((s) => s.id === "wolf-359");
      await page.locator("#starmap-canvas").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `1-cluster-pirate-activity-${viewport.label}.png`) });

      // 2. Wolf 359's Shard Belt: its chance (the server's), and the hunt screen with the expected battle
      expect(await mapShow(page, { systemId: "wolf-359", bodyId: "wf-shards" })).toBe(true);
      const details = page.locator("#map-details");
      await expect(details.locator("[data-belt-rats]")).toContainText(`${Math.round(wolf.chance * 100)}%`);
      await details.locator("#hunt-open-btn").click();
      const form = details.locator("[data-hunt-form]");
      await expect(form).toBeVisible();
      // only the fleet at Wolf 359 is offered; the one at Earth is counted, not listed
      await expect(form.locator('input[name="hunt-fleet"]')).toHaveCount(1);
      await expect(form.locator('input[name="hunt-fleet"]')).toHaveValue("flt-aegis");
      await expect(form.locator("[data-hunt-expected]")).toContainText("Expected: Your fleet clears them");
      await expect(form.locator("[data-hunt-expected]")).toContainText("10,593 credits"); // the design's bounty for this fight
      await details.locator("[data-belt-rats]").scrollIntoViewIfNeeded();
      await details.screenshot({ path: path.join(SHOT_DIR, `2-belt-hunt-panel-${viewport.label}.png`) });

      // 3. sent from that screen; the receipt says when it is back
      await details.locator("#hunt-send-btn").click();
      const receipt = page.locator("#action-receipt-modal");
      await expect(receipt).toContainText("Hunt Declared");
      await page.screenshot({ path: path.join(SHOT_DIR, `3-hunt-receipt-${viewport.label}.png`) });
      await acknowledgeReceipt(page);

      // 4. resolved by the server's ticker; the page reads the account again and the belt shows the battle report
      await expect(details.locator("[data-hunt-report]")).toBeVisible({ timeout: 60_000 });
      const report = details.locator("[data-hunt-report]");
      await expect(report).toContainText("Hunt won");
      await expect(report).toContainText("10,593 credits");
      await expect(report.locator(".raid-table").first()).toBeVisible();
      await expect(details.locator("[data-belt-quiet]")).toBeVisible();
      await expect(details.locator("#hunt-open-btn")).toHaveCount(0);
      await report.scrollIntoViewIfNeeded();
      await report.screenshot({ path: path.join(SHOT_DIR, `4-hunt-battle-report-${viewport.label}.png`) });

      // 5. back on the cluster, the Shard Belt's system is ringed as quiet and the legend says so
      await page.click("#map-reset");
      await expect(legend).toContainText("1 system is quiet now");
      await page.locator("#starmap-canvas").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOT_DIR, `5-cluster-quiet-belt-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
