// ISP-200 (AB#894), ISP-201 (AB#895), ISP-206 (AB#901): the Conglomerate Affairs Bureau, the Conglomerate tab (with its
// Treasury and Hangar) and the Overview's card from
// the running app, played as two players would, with screenshots
// at 1280x800 and 375x812. The script starts its own server on a scratch data directory, because a corporation must be
// seven days old to found a conglomerate and nothing in the page can age one: the founder registers, is refused (the
// requirement shown), the server stops, the save's createdAt is moved back eight days, and the server starts again.
// Then: the founder files a charter (with the confirmation), a second corporation finds it, applies, and the founder
// accepts it and makes it a director. Nothing is drawn by this script; every screen is the app's.
//
// Usage: node scripts/look-conglomerate-bureau.mjs <outDir>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { verifyAndLogIn } from "../e2e/verification.mjs";
import { openSystem, recordCanvas } from "../e2e/starmapCanvas.mjs";

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error("usage: node scripts/look-conglomerate-bureau.mjs <outDir>");
fs.mkdirSync(outDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "look-bureau-"));
const DAY = 86_400_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server = null;
async function startServer() {
  const child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, ISP_DATA_DIR: dataDir, PORT: "0", ISP_DEV: "1", NODE_ENV: "test", ISP_DISABLE_TICKERS: "1", JWT_SECRET: "look-bureau-secret-0123456789abcdef" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const base = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 30_000);
    const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
  server = child;
  return base;
}
async function stopServer(mustHold = []) {
  await wait(2000); // the accounts snapshot is written 500 ms after a change
  // Under load the write can come later: wait until the snapshot holds every account the next step edits.
  const snapshot = path.join(dataDir, "accounts-snapshot.json");
  for (let i = 0; i < 40; i += 1) {
    try {
      const held = Object.values(JSON.parse(fs.readFileSync(snapshot, "utf8")).accounts || {}).map((a) => a.email);
      if (mustHold.every((email) => held.includes(email))) break;
    } catch { /* not written yet */ }
    await wait(250);
  }
  server.removeAllListeners("exit");
  server.kill();
  await wait(500);
}

const browser = await chromium.launch();
const shots = [];
async function shot(page, name, { wide = true, narrow = true, role = "cong-body", sel, viewport = false, prefix = "ab894" } = {}) {
  const selector = sel || (role ? `[data-role="${role}"]` : null);
  for (const [w, h, on] of [[1280, 800, wide], [375, 812, narrow]]) {
    if (!on) continue;
    await page.setViewportSize({ width: w, height: h });
    await wait(300);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = path.join(outDir, `${prefix}-${name}-${w}.png`);
    // From the top of the page, so the sticky header sits where a player sees it; a panel is cut from the full page.
    if (viewport) { await page.screenshot({ path: file }); shots.push(path.basename(file)); continue; } // a modal, as it is seen
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(150);
    // The visible matches, as one box: the Bureau's panel and the Conglomerate tab both hold a cong-body, one of them
    // hidden; a selector list ("a, b") takes in every visible element it names.
    const clip = selector ? await page.evaluate((s) => {
      const boxes = [...document.querySelectorAll(s)].filter((el) => el.getClientRects().length && el.offsetParent !== null).map((el) => el.getBoundingClientRect());
      if (!boxes.length) return null;
      const top = Math.min(...boxes.map((b) => b.top)), bottom = Math.max(...boxes.map((b) => b.bottom));
      const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
      return { x: Math.max(0, left - 8), y: top + window.scrollY - 8, width: Math.min(right - left + 16, document.documentElement.clientWidth), height: bottom - top + 16 };
    }, selector) : null;
    await page.screenshot({ path: file, fullPage: true, ...(clip ? { clip } : {}) });
    shots.push(`${path.basename(file)} (sideways scroll ${sideways}px)`);
    if (sideways > 0) console.log(`!! ${name} at ${w}px scrolls sideways by ${sideways}px`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function register(base, label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const who = { email: `${label}-${stamp}@example.test`, password: "look only throwaway password", corp: `${label === "founder" ? "Halcyon" : "Meridian"} Freight ${stamp.slice(-4)}` };
  await page.goto(`${base}/register.html`);
  await page.fill("#register-email", who.email);
  await page.fill("#register-password", who.password);
  await page.fill("#register-ceo", "Look Ceo");
  await page.fill("#register-corp", who.corp);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, base, who.email, who.password);
  await page.waitForURL(/\/\?account=/);
  who.accountId = new URL(page.url()).searchParams.get("account");
  await page.close();
  return who;
}

async function logIn(base, who) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await recordCanvas(page); // ISP-208 (AB#903): the Starmap's labels and arcs, to find Sol's belt on the canvas
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", who.email);
  await page.fill("#login-password", who.password);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  // The liaison's welcome opens once the app has loaded: wait for it, then decline the walkthrough.
  const modal = page.locator("#dialogue-modal");
  if (await modal.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) {
    const skip = modal.getByRole("button", { name: "I'll find my own way" });
    await skip.click({ timeout: 20_000 }); // it appears once the liaison has finished typing
    await modal.waitFor({ state: "hidden", timeout: 10_000 });
  }
  return page;
}

async function openBureau(page) {
  await openTab(page, "station");
  const back = page.locator("#station-back-btn");
  if (await back.isVisible().catch(() => false)) await back.click(); // already inside a building: back to the station
  await page.locator('[data-building-action="building:conglomerate-affairs-bureau"]').click();
  await page.locator('[data-role="cong-directory"]').waitFor({ timeout: 15_000 });
  await wait(300);
}

try {
  // 1. A new corporation: the charter is refused, and says why and when.
  let base = await startServer();
  const founder = await register(base, "founder");
  const joiner = await register(base, "joiner");
  let a = await logIn(base, founder);
  await openBureau(a);
  console.log("refused charter:", (await a.locator('[data-role="cong-charter"] .cong-refusal').innerText()).trim());
  await shot(a, "charter-refused", { role: "cong-charter" });
  await shot(a, "bureau-new-corporation");
  await openTab(a, "overview");
  await a.locator("#overview-cards .ui-card", { hasText: "Independent" }).waitFor({ timeout: 15_000 });
  await shot(a, "overview-independent", { sel: "#overview-cards", prefix: "ab895" });
  await openTab(a, "conglomerate");
  await a.locator('#conglomerate [data-role="cong-independent"]').waitFor({ timeout: 15_000 });
  await shot(a, "hq-independent", { sel: "#conglomerate", prefix: "ab895" });
  await a.context().close();
  await stopServer([founder.email, joiner.email]);

  // 2. Eight days on: the founder's save is moved back, as if it had been playing a week.
  const snapshot = path.join(dataDir, "accounts-snapshot.json");
  const store = JSON.parse(fs.readFileSync(snapshot, "utf8"));
  // The account ids from the save, by email: the page's URL is rewritten after login, so the id read from it can be missing.
  for (const who of [founder, joiner]) who.accountId = Object.values(store.accounts).find((a) => a.email === who.email.toLowerCase())?.id;
  if (!founder.accountId || !joiner.accountId) throw new Error("the save does not hold both corporations");
  store.accounts[founder.accountId].createdAt -= 8 * DAY;
  // ISP-206 (AB#901): goods at Earth Station Prime, as a week of mining would leave them, for the hangar.
  const corpInv = store.accounts[founder.accountId].state.corp.inventory ||= {};
  corpInv["earth-station-prime"] = { ...(corpInv["earth-station-prime"] || {}), Silicates: 5_000, Nickel: 800 };
  // ISP-208 (AB#903): the founder has scouted Sol's belt this generation; the joiner has the research and probes to go.
  const world = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));
  const generation = world.belts?.["sol:belt"]?.generation ?? 1;
  for (const who of [founder, joiner]) {
    const c = store.accounts[who.accountId].state.corp;
    c.unlockedTech = [...new Set([...(c.unlockedTech || []), "tt-asteroid-prospecting"])];
    c.asteroidMining = { ...(c.asteroidMining || {}), probeCount: 2, maxDeployments: 2, activeExpeditions: c.asteroidMining?.activeExpeditions || [] };
  }
  Object.assign(store.accounts[founder.accountId].state.corp.asteroidMining, { scoutedBelts: ["sol:belt"], scoutedGenerations: { "sol:belt": generation } });
  // Two listings on the Exchange: the founder's, and one from a corporation in no conglomerate.
  const now = Date.now();
  world.market ||= {};
  world.market.orderBook = [
    { id: "ord-look-partner", type: "sell", item: "Nickel", quantity: 300, unitPrice: 88, seller: founder.corp, sellerAccountId: founder.accountId, stationId: "earth-station-prime", createdAt: now - 60_000 },
    { id: "ord-look-outsider", type: "sell", item: "Nickel", quantity: 120, unitPrice: 84, seller: "Outer Rim Salvage", sellerAccountId: "acc-look-outsider", stationId: "earth-station-prime", createdAt: now - 120_000 },
    ...(world.market.orderBook || [])
  ];
  fs.writeFileSync(path.join(dataDir, "state.json"), JSON.stringify(world));
  fs.writeFileSync(snapshot, JSON.stringify(store));
  base = await startServer();

  // 3. The founder: the empty directory, the charter form, the confirmation, and the conglomerate it made.
  a = await logIn(base, founder);
  await openBureau(a);
  await shot(a, "empty-directory", { role: "cong-directory" });
  await a.fill("#cong-name", "Halcyon Accord");
  await a.locator('input[name="emblem"][value="6"]').check();
  await a.locator('input[name="colour"][value="5"]').check();
  await shot(a, "charter-form", { role: "cong-charter" });
  await a.locator('[data-role="cong-charter-submit"]').click();
  await a.locator("#trade-confirm-modal").waitFor({ state: "visible" });
  await shot(a, "charter-confirm", { viewport: true });
  await a.click("#trade-confirm-ok");
  await a.locator('[data-role="cong-mine"]').waitFor({ timeout: 15_000 });
  await wait(300);
  await shot(a, "founded");

  // 4. The second corporation: no invitations, the directory, and its application.
  const b = await logIn(base, joiner);
  await openBureau(b);
  await shot(b, "invitations-empty", { role: "cong-invitations" });
  await shot(b, "directory", { role: "cong-directory" });
  await b.locator('[data-role="cong-apply"]').first().click();
  await b.locator('[data-role="cong-application"]').waitFor({ timeout: 15_000 });
  await shot(b, "applied");

  // 5. The founder accepts it and makes it a director; the succession line names the heir.
  await openTab(a, "station");
  await openBureau(a);
  await shot(a, "application-waiting", { role: "cong-admissions" });
  await a.locator('[data-role="cong-application-accept"]').first().click();
  await a.locator('[data-role="cong-promote"]').first().waitFor({ timeout: 15_000 });
  await a.locator('[data-role="cong-promote"]').first().click();
  await a.locator('[data-role="cong-transfer"]').first().waitFor({ timeout: 15_000 });
  await wait(300);
  await shot(a, "roster-founder");
  console.log("succession:", (await a.locator('[data-role="cong-succession"]').innerText()).trim());

  // 6. The new director's own view: its controls are the director's, not the founder's.
  await openTab(b, "station");
  await openBureau(b);
  await b.locator('[data-role="cong-mine"]').waitFor({ timeout: 15_000 });
  await shot(b, "roster-director");
  console.log("director's controls:", await b.locator('[data-role="cong-body"] button[data-role]').evaluateAll((els) => els.map((e) => e.dataset.role)));

  // 7. ISP-201 (AB#895): the Overview's card for a member, and the Conglomerate tab for the founder and the director.
  for (const [who, page] of [["founder", a], ["director", b]]) {
    await openTab(page, "overview");
    await page.locator("#overview-cards .ui-card", { hasText: "Halcyon Accord" }).waitFor({ timeout: 15_000 });
    await shot(page, `overview-${who}`, { sel: "#overview-cards", prefix: "ab895" });
    console.log(`${who}'s card:`, (await page.locator("#overview-cards .ui-card", { hasText: "Halcyon Accord" }).innerText()).replace(/\s+/g, " "));
    await page.locator("#overview-cards .ui-card", { hasText: "Halcyon Accord" }).click();
    await page.locator('#conglomerate [data-role="cong-roster"]').waitFor({ timeout: 15_000 });
    await shot(page, `hq-${who}`, { sel: "#conglomerate", prefix: "ab895" });
  }
  await b.locator('#conglomerate [data-role="cong-leave"]').click();
  await b.locator("#trade-confirm-modal").waitFor({ state: "visible" });
  await shot(b, "hq-leave-confirm", { viewport: true, prefix: "ab895" });
  console.log("leave confirmation:", (await b.locator("#trade-confirm-modal").innerText()).replace(/\s+/g, " "));
  await b.click("#trade-confirm-cancel");

  // 8. ISP-206 (AB#901): the Treasury and Hangar tabs. The founder deposits and withdraws; the director is refused over
  // its cap and told why; a member sees deposit only; goods go into the hangar and a director sees its share.
  const tab = async (page, name) => {
    await openTab(page, "conglomerate");
    await page.locator(`#conglomerate [data-role="cong-tab"][data-tab="${name}"]`).click();
    await page.locator(`#conglomerate #cong-panel-${name} [data-role="cong-${name}"]`).waitFor({ timeout: 15_000 });
  };
  const status = async (page, role) => (await page.locator(`#conglomerate [data-role="${role}"]`).innerText()).trim();
  await tab(a, "treasury");
  await a.fill("#cong-deposit-amount", "50,000");
  await a.locator('#conglomerate [data-role="cong-treasury-deposit"] button[type="submit"]').click();
  await a.locator("#trade-confirm-modal").waitFor({ state: "visible" });
  await shot(a, "treasury-deposit-confirm", { viewport: true, prefix: "ab901" });
  await a.click("#trade-confirm-ok");
  await a.locator('#conglomerate [data-role="cong-treasury-deposit-status"]', { hasText: "Deposited" }).waitFor({ timeout: 15_000 });
  console.log("deposit:", await status(a, "cong-treasury-deposit-status"));
  await a.fill("#cong-withdraw-amount", "1500");
  await a.locator('#conglomerate [data-role="cong-treasury-withdraw"] button[type="submit"]').click();
  await a.locator('#conglomerate [data-role="cong-treasury-withdraw-status"]', { hasText: "Withdrawn" }).waitFor({ timeout: 15_000 });
  console.log("withdraw:", await status(a, "cong-treasury-withdraw-status"));
  await shot(a, "treasury-founder", { sel: "#conglomerate", prefix: "ab901" });

  await tab(b, "treasury");
  console.log("director allowance:", await status(b, "cong-treasury-allowance"));
  await b.fill("#cong-withdraw-amount", "900");
  await b.locator('#conglomerate [data-role="cong-treasury-withdraw"] button[type="submit"]').click();
  await b.locator('#conglomerate [data-role="cong-treasury-withdraw-status"]', { hasText: /today/ }).waitFor({ timeout: 15_000 });
  console.log("director refused:", await status(b, "cong-treasury-withdraw-status"));
  await shot(b, "treasury-director-over-cap", { sel: "#conglomerate", prefix: "ab901" });

  await tab(a, "hangar");
  await a.locator("#cong-goods-in-item").selectOption("Silicates");
  await a.fill("#cong-goods-in-qty", "3000");
  await a.locator('#conglomerate [data-role="cong-hangar-deposit"] button[type="submit"]').click();
  await a.locator('#conglomerate [data-role="cong-hangar-deposit-status"]', { hasText: "Deposited" }).waitFor({ timeout: 15_000 });
  await shot(a, "hangar-founder", { sel: "#conglomerate", prefix: "ab901" });
  await tab(b, "hangar");
  await shot(b, "hangar-director", { sel: "#conglomerate", prefix: "ab901" });

  // The founder makes the director a member again; the member's Treasury offers deposit only.
  await tab(a, "roster");
  await a.locator('#conglomerate [data-role="cong-demote"]').first().click();
  await a.locator('#conglomerate [data-role="cong-promote"]').first().waitFor({ timeout: 15_000 });
  await b.reload();
  await b.locator("#dialogue-modal").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  await tab(b, "treasury");
  console.log("member forms:", await b.locator('#conglomerate form[data-role^="cong-treasury"]').evaluateAll((f) => f.map((x) => x.dataset.role)));
  await shot(b, "treasury-member", { sel: "#conglomerate", prefix: "ab901" });

  // 9. ISP-208 (AB#903): shared intel where it is used. The member's Exchange marks its partner's listing, and the Sellers
  // filter narrows the book to partners; its Starmap belt panel names the partner who scouted Sol's belt, with Launch.
  await openTab(b, "market");
  await b.locator("#exchange-buy-table tr", { hasText: "Outer Rim Salvage" }).waitFor({ timeout: 15_000 });
  await shot(b, "exchange-everyone", { sel: "#market .exchange__filters, #exchange-sell-section", prefix: "ab903" });
  await b.locator("#exchange-sellers-filter").selectOption("conglomerate");
  await b.waitForTimeout(300);
  console.log("partner rows:", await b.locator("#exchange-buy-table tr").evaluateAll((rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim())));
  await shot(b, "exchange-my-conglomerate", { sel: "#market .exchange__filters, #exchange-sell-section", prefix: "ab903" });
  await openTab(b, "starmap");
  const canvas = b.locator("#starmap-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await b.waitForTimeout(800);
  if (!(await b.evaluate(() => window.__labels.some((l) => l.t.endsWith("Back To Cluster"))))) await openSystem(b, canvas, "Sol");
  await b.waitForTimeout(400);
  const belt = await b.evaluate(() => {
    const arcs = window.__arcs;
    for (let i = arcs.length - 2; i >= 0; i -= 1) {
      const [glow, ring] = [arcs[i], arcs[i + 1]];
      if (glow.x === ring.x && glow.y === ring.y && Math.abs(glow.r - ring.r - 8) < 0.01 && ring.r >= 10) return { x: ring.x, y: ring.y };
    }
    return null;
  });
  if (!belt) throw new Error("Sol's belt is not drawn");
  console.log("map label:", await b.evaluate(() => window.__labels.filter((l) => l.t.includes("shared")).map((l) => l.t).pop()));
  // Sol's system view, the belt labelled as shared, before it is opened
  await canvas.screenshot({ path: path.join(outDir, "ab903-starmap-shared-label-1280.png") });
  await canvas.click({ position: belt });
  await b.locator("#map-details [data-belt-shared]").waitFor({ timeout: 15_000 });
  console.log("belt panel:", (await b.locator("#map-details [data-belt-shared]").innerText()).trim(), "| launch:", await b.locator("#map-details #launch-expedition-btn").count());
  await shot(b, "expedition-picker", { sel: "#map-details", prefix: "ab903" });
} finally {
  await browser.close();
  if (server) server.kill();
  console.log(shots.join("\n"));
}
