// AB#820 (docs/design/rats.md): an expedition launched from the Starmap's belt panel, from the running app. The launch
// receipt states the risk accepted at launch, the chance of meeting Rats, as the server computed it for that belt and
// length. At 1440x900 and 390x844; screenshots go to e2e/screenshots/ab-820/.
import { test, expect } from "@playwright/test";
import { openTab } from "./nav.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-820");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = "playtest-password-not-real";
const SECRET = "construction-panel-e2e-fixture-secret-0123";
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
  test(`a launch states the chance of meeting Rats, at ${viewport.label}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-rats-e2e-"));
    const email = `rats-${Date.now()}-${viewport.width}@example.test`;
    const env = { ...process.env, JWT_SECRET: SECRET };
    let r = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, email, `other-${email}`, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stdout}\n${r.stderr}`);
    // a probe on hand and Sol's belt scouted, so the launch is the only thing the page does
    r = spawnSync(process.execPath, ["--input-type=module", "-e", `
      process.env.ISP_DATA_DIR = ${JSON.stringify(dir)}; process.env.NODE_ENV = "test";
      const store = await import("./server/gameState.js");
      const { accountsStore } = await import("./server/game/store.js");
      const a = Object.values(accountsStore.accounts).find((x) => x.email === ${JSON.stringify(email)});
      store.mutateAccountState(a.id, (s) => { s.corp.asteroidMining = { probeCount: 2, maxDeployments: 2, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [], scoutedBelts: ["sol:belt"], scoutedGenerations: { "sol:belt": 1 } }; }, { sanitize: false, settleMining: false });
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
      expect(await mapShow(page, { systemId: "sol", bodyId: "belt" })).toBe(true);
      await page.locator("#launch-expedition-btn").click();
      const receipt = page.locator("#action-receipt-modal");
      await expect(receipt).toBeVisible();
      await expect(receipt).toContainText("Expedition Launched");
      // Sol, density 11: the chance for the length the panel launched, from the design's table (7%, 15% or 36%)
      await expect(receipt).toContainText(/Chance of meeting Rats\s*(7|15|36)%/);
      await page.screenshot({ path: path.join(SHOT_DIR, `launch-receipt-${viewport.label}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      child.kill();
    }
  });
}
