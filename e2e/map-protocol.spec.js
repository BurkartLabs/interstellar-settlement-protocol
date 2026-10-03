// ISP-255 slice c2 (AB#4831): the Map group in protocol language, in the running game at 1280x800. Two worlds, each
// seeded with the server's own code:
//   - a members-only conglomerate station (seed-construction-account cg-station-closed): the refused dock, with what to
//     do instead, Denied; then a dock elsewhere: the Travel screen In force, and its notice;
//   - concessions (seed-concessions): a holder's concession In force, and a petition under review Filed, awaiting review.
// Hunts and their reports are ISP-255d's (AB#4826).
// Shots go to e2e/screenshots/ab-4831/.
import { test, expect } from "@playwright/test";
import { openTab, toggleNotifications } from "./nav.mjs";
import { acknowledgeReceipt } from "./receipt.mjs"; // the dock's receipt
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", "ab-4831");
const PASSWORD = "playtest-password-not-real";
const SECRET = "map-protocol-e2e-fixture-secret-0123456789";

function startServer(dir, extraEnv = {}) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${port}` }); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}
const seed = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
  if (r.status !== 0) throw new Error(`${args[0]} failed: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
async function signIn(browser, url, email) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForURL(/\?account=/);
  return { page, errors, context };
}
const mapShow = (page, where) => page.evaluate(async (w) => (await import("/scripts/views/starmap.js")).starmap.show(w), where);
const openStation = (page, id) => page.evaluate(async (s) => (await import("/scripts/views/starmap.js")).starmap.openStation(s), id);
const shot = (locator, name) => locator.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
/** A Starmap panel, in a viewport tall enough to hold it: a page shot clipped to its box, once it is on screen. */
async function clipShot(page, selector, name) {
  let box = null;
  for (let i = 0; i < 20 && !box; i++) { box = await page.locator(selector).boundingBox(); if (!box) await page.waitForTimeout(250); }
  if (!box) throw new Error(`${selector} never settled on screen`);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
}

test("a refused dock: what to do instead, then Denied, at 1280", async ({ browser }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-map-dock-e2e-"));
  const email = `map-dock-${Date.now()}@example.test`;
  seed(["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "cg-station-closed"]);
  const { child, url } = await startServer(dir);
  const { page, errors, context } = await signIn(browser, url, email);
  try {
    await openTab(page, "starmap");
    await page.waitForTimeout(800);
    expect(await mapShow(page, { systemId: "sol" })).toBe(true);
    // 1. the members-only station refuses the dock, says what to do instead, then Denied
    await openStation(page, "cg-venus");
    const modal = page.locator("#starmap-station-modal");
    await modal.locator("[data-role=starmap-station-dock]").click();
    const why = modal.locator(".starmap__dock-refused");
    await expect(why).toContainText("Dock at another station in this system.");
    await expect(why.locator(".protocol-line")).toContainText("Denied");
    await page.screenshot({ path: path.join(SHOT_DIR, "1-dock-refused.png") });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    child.kill();
  }
});

test("a journey: the Travel screen In force, and the course's notice, at 1280", async ({ browser }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-map-travel-e2e-"));
  const email = `map-travel-${Date.now()}@example.test`;
  seed(["e2e/seed-construction-account.mjs", dir, email, PASSWORD, "cg-station-closed"]);
  const { child, url } = await startServer(dir);
  const { page, errors, context } = await signIn(browser, url, email);
  try {
    await openTab(page, "starmap");
    await page.waitForTimeout(800);
    expect(await mapShow(page, { systemId: "sol" })).toBe(true);
    // 2. a dock the server takes: the Travel screen says the journey is In force
    await openStation(page, "luna-gateway");
    await page.locator("#starmap-station-modal [data-role=starmap-station-dock]").click();
    await acknowledgeReceipt(page);
    const lede = page.locator("#travel .ui-screen__lede");
    await expect(lede.locator(".protocol-line")).toContainText("In force");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOT_DIR, "2-travel-in-force.png") });
    // 3. its notice: In force on the Travel screen, beside its plain words
    await toggleNotifications(page);
    const note = page.locator("#notification-list li", { hasText: "Undocking" });
    await expect(note.locator(".protocol-line")).toContainText("In force");
    await page.locator("#notification-panel").screenshot({ path: path.join(SHOT_DIR, "3-notice-course-set.png") });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    child.kill();
  }
});

test("concessions: a holder's In force, and a petition under review, at 1280", async ({ browser }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-map-concessions-e2e-"));
  const logins = JSON.parse(seed(["e2e/seed-concessions.mjs", dir, PASSWORD]).trim().split("\n").at(-1));
  const { child, url } = await startServer(dir, { ISP_DISABLE_TICKERS: "1" });
  try {
    // 4. Halcyon Mining's concession at Alpha Centauri: Active, In force
    const halcyon = await signIn(browser, url, logins.halcyon);
    await halcyon.page.setViewportSize({ width: 1280, height: 2400 }); // the whole panel on screen
    await openTab(halcyon.page, "starmap");
    await halcyon.page.waitForTimeout(800);
    await halcyon.page.selectOption("#map-overlay", "concessions");
    expect(await mapShow(halcyon.page, { systemId: "alpha-centauri" })).toBe(true);
    const holder = halcyon.page.locator("#map-details [data-concession-holder]");
    await expect(holder.locator(".protocol-line", { hasText: "In force" })).toBeVisible({ timeout: 15_000 });
    await halcyon.page.waitForTimeout(1500); // the panel redraws as the system's status arrives
    await clipShot(halcyon.page, "#map-details [data-concession-holder]", "4-concession-in-force");
    expect(halcyon.errors).toEqual([]);
    await halcyon.context.close();
    // 5. Barnard's Star: Kestrel Mining's petition under review, Filed, awaiting review
    const nova = await signIn(browser, url, logins.nova);
    await nova.page.setViewportSize({ width: 1280, height: 2400 }); // the whole panel on screen
    await openTab(nova.page, "starmap");
    await nova.page.waitForTimeout(800);
    await nova.page.selectOption("#map-overlay", "concessions");
    expect(await mapShow(nova.page, { systemId: "barnards-star" })).toBe(true);
    const petitions = nova.page.locator("#map-details [data-concession-petitions]");
    await expect(petitions.locator(".protocol-line")).toContainText("Filed, awaiting review", { timeout: 15_000 });
    const section = nova.page.locator("#map-details [data-concession-details]");
    await nova.page.waitForTimeout(1500);
    await clipShot(nova.page, "#map-details [data-concession-details]", "5-petition-under-review");
    expect(nova.errors).toEqual([]);
    await nova.context.close();
  } finally {
    child.kill();
  }
});
