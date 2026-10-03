// ISP-254 slice Ba (AB#4810): the Fleet tab's statuses and messages in protocol language, in the running game at
// 1280x900. The forces summary with unpaid upkeep (In arrears) and a fleet in transit (In force); a fleet order the
// server refuses (Denied) and a ship the corporation cannot fund (Unfunded), each with its next step; the Command Log
// after a ship is queued (Lodged); and the notification of ships the server's own ticker delivered (Concluded).
// Nothing is mocked: the account is seeded, and the rest is the page and the server. Shots go to e2e/screenshots/ab-4810/.
import { test, expect } from "@playwright/test";
import { openTab, toggleNotifications } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4810"); // copied into docs/ab-4810 for the record
const PASSWORD = "playtest-password-not-real";
const SECRET = "fleet-protocol-e2e-fixture-secret-0123456789";

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

test("the Fleet tab's statuses, refusals, log and notifications carry the protocol line, at 1280", async ({ browser }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-fleet-protocol-e2e-"));
  const email = `fleet-${Date.now()}@example.test`;
  const env = { ...process.env, JWT_SECRET: SECRET };
  let r = spawnSync(process.execPath, ["e2e/seed-v012-play.mjs", dir, email, `other-${email}`, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stdout}\n${r.stderr}`);
  // A shipyard with credits for a Light Fighter but not a Destroyer; 3 Light Fighters in reserve; upkeep unpaid; a
  // fleet on its way to Mars; and a finished shipyard job the server's ticker delivers once it runs.
  r = spawnSync(process.execPath, ["--input-type=module", "-e", `
    process.env.ISP_DATA_DIR = ${JSON.stringify(dir)}; process.env.NODE_ENV = "test";
    const store = await import("./server/gameState.js");
    const { accountsStore } = await import("./server/game/store.js");
    const a = Object.values(accountsStore.accounts).find((x) => x.email === ${JSON.stringify(email)});
    const now = Date.now();
    store.mutateAccountState(a.id, (s) => {
      const c = s.corp;
      c.level = Math.max(10, Number(c.level || 0));
      c.currentStationId = "earth-station-prime";
      c.unlockedTech = [...new Set([...(c.unlockedTech || []), "tt-fleet-coordination", "tt-capital-hulls"])];
      if (!c.buildings.some((b) => b.name === "Orbital Shipyard")) c.buildings.push({ name: "Orbital Shipyard", tier: 1, status: "Operational" });
      c.finances.credits = 2000;
      c.inventory = { ...(c.inventory || {}), "earth-station-prime": { ...(c.inventory?.["earth-station-prime"] || {}), "Carbon Fibre Sheets": 200, "Armour Plating": 50 } };
      c.military = { ...(c.military || {}), units: { lf: 9, ds: 0, se: 0, at: 0, dt: 0 }, readiness: 70, upkeep: { short: true },
        fleets: [{ id: "flt-lancer", name: "Lancer", units: { lf: 6 }, stationId: "earth-station-prime", formedAt: now - 60_000,
          transit: { fromStationId: "earth-station-prime", toStationId: "mars-orbital-dock", departedAt: now - 60_000, arrivesAt: now + 40 * 60_000 } }] };
      c.shipyard = { queue: [{ id: "job-delivered", unitId: "lf", quantity: 2, credits: 2300, goods: { "Carbon Fibre Sheets": 20 }, startsAt: now - 120_000, completesAt: now - 1000 }] };
    }, { sanitize: false, settleMining: false });
    await store.saveAccountsNow();`], { cwd: REPO_ROOT, encoding: "utf8", env });
  if (r.status !== 0) throw new Error(`setup failed: ${r.stdout}\n${r.stderr}`);
  const { child, url } = await startServer(dir);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${url}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForURL(/\?account=/);
    await openTab(page, "fleet");

    // 1. the forces summary (upkeep unpaid: In arrears) and the fleet in transit (In force), beside their plain words
    const summary = page.locator("#fleet-summary");
    await expect(summary.locator(".protocol-line")).toContainText("In arrears");
    const lancer = page.locator('[data-fleet="flt-lancer"]');
    await expect(lancer.locator(".protocol-line")).toContainText("In force");
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT_DIR, "1-forces-and-fleet-in-transit.png") });

    // 2. a fleet order the server refuses: more Light Fighters than the reserve holds. Denied, and how many it can take.
    const form = page.locator("[data-fleet-form]");
    await form.locator('[data-form-count="lf"]').fill("9");
    await form.locator("[data-fleet-form-submit]").click();
    const formStatus = form.locator("[role=status]");
    await expect(formStatus).toContainText("Form it with 3 or fewer.");
    await expect(formStatus.locator(".protocol-line")).toContainText("Denied");
    await form.scrollIntoViewIfNeeded();
    await form.screenshot({ path: path.join(SHOT_DIR, "2-fleet-order-denied.png") });

    // 3. a Destroyer the corporation cannot fund: Unfunded, and the next step (Bug #4820)
    const yard = page.locator("[data-shipyard-form]");
    await yard.locator("[data-ship-unit]").selectOption("ds");
    await yard.locator("[data-ship-queue]").click();
    const yardStatus = yard.locator("[role=status]");
    await expect(yardStatus).toContainText("Sell goods or finish an assignment to raise the credits, then try again.");
    await expect(yardStatus.locator(".protocol-line")).toContainText("Unfunded, balance insufficient");
    await yard.scrollIntoViewIfNeeded();
    await yard.screenshot({ path: path.join(SHOT_DIR, "3-shipyard-unfunded.png") });

    // 4. a Light Fighter queued: its receipt, then the Command Log's line with Lodged
    await yard.locator("[data-ship-unit]").selectOption("lf");
    await yard.locator("[data-ship-queue]").click();
    await acknowledgeReceipt(page);
    await openTab(page, "overview");
    const log = page.locator("#feedback-log");
    await expect(log.locator(".protocol-line").first()).toContainText("Lodged");
    await page.locator("#command-log").scrollIntoViewIfNeeded();
    await page.locator("#command-log").screenshot({ path: path.join(SHOT_DIR, "4-command-log-lodged.png") });

    // 5. the ships the server's ticker delivered: the notification, Concluded beside its plain words
    await page.evaluate(() => window.scrollTo(0, 0));
    await toggleNotifications(page);
    const note = page.locator("#notification-list li", { hasText: "Ships Delivered" });
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note.locator(".protocol-line")).toContainText("Concluded");
    await expect(page.locator("#notification-list li", { hasText: "Ship Production Queued" }).locator(".protocol-line")).toContainText("Lodged");
    await page.screenshot({ path: path.join(SHOT_DIR, "5-notification-ships-delivered.png") });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    child.kill();
  }
});
