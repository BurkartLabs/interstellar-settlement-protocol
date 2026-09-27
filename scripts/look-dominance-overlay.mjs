// ISP-218 (AB#913): the Starmap's dominance overlays from the running app, at 1280x800 and 375x812. The script starts its
// own server on a scratch data directory, registers the viewer through the page and three rival corporations through the
// API, stops the server, and gives them a week of leases, mining and sales (and the viewer a conglomerate) in the save,
// as a week of play would. After a restart the server computes the reading itself (GET /api/starmap/dominance, ISP-217);
// nothing here draws or computes a share.
//
// Usage: node scripts/look-dominance-overlay.mjs <outDir>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { verifyAndLogIn } from "../e2e/verification.mjs";
import { openSystem, recordCanvas } from "../e2e/starmapCanvas.mjs";

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error("usage: node scripts/look-dominance-overlay.mjs <outDir>");
fs.mkdirSync(outDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "look-dominance-"));
const DAY = 86_400_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PASSWORD = "look only throwaway password";

let server = null;
async function startServer() {
  const child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, ISP_DATA_DIR: dataDir, PORT: "0", ISP_DEV: "1", NODE_ENV: "test", ISP_DISABLE_TICKERS: "1", JWT_SECRET: "look-dominance-secret-0123456789abcdef" },
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
async function stopServer(emails) {
  const snapshot = path.join(dataDir, "accounts-snapshot.json");
  for (let i = 0; i < 60; i += 1) {
    await wait(250);
    try {
      const held = Object.values(JSON.parse(fs.readFileSync(snapshot, "utf8")).accounts || {}).map((a) => a.email);
      if (emails.every((e) => held.includes(e))) break;
    } catch { /* not written yet */ }
  }
  server.removeAllListeners("exit");
  server.kill();
  await wait(500);
}

/** Register and verify a corporation through the API (the outbox holds its link: ISP_DEV=1). */
async function registerByApi(base, corpName) {
  const email = `${corpName.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}@example.test`;
  const r = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD, ceoName: "Look Ceo", corpName }) });
  if (r.status !== 201) throw new Error(`register ${corpName}: ${r.status} ${await r.text()}`);
  const outbox = await (await fetch(`${base}/api/dev/outbox`)).json();
  const token = outbox.messages.filter((m) => m.to === email).at(-1)?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  const v = await fetch(`${base}/api/auth/verify-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  if (v.status !== 200) throw new Error(`verify ${corpName}: ${v.status}`);
  return { email, corpName };
}

const browser = await chromium.launch();
const shots = [];
async function shot(page, name, sel) {
  for (const [w, h] of [[1280, 800], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h });
    await wait(700); // the map redraws for its new size
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(150);
    const clip = await page.evaluate((s) => {
      const boxes = [...document.querySelectorAll(s)].filter((el) => el.getClientRects().length && el.offsetParent !== null).map((el) => el.getBoundingClientRect());
      if (!boxes.length) return null;
      const top = Math.min(...boxes.map((b) => b.top)), bottom = Math.max(...boxes.map((b) => b.bottom));
      const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
      return { x: Math.max(0, left - 8), y: top + window.scrollY - 8, width: Math.min(right - left + 16, document.documentElement.clientWidth), height: bottom - top + 16 };
    }, sel);
    const file = path.join(outDir, `ab913-${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: true, ...(clip ? { clip } : {}) });
    shots.push(`${path.basename(file)} (sideways scroll ${sideways}px)`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(500);
}

try {
  let base = await startServer();
  // The viewer, through the page; three rivals, through the API.
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await recordCanvas(page);
  const stamp = String(Date.now()).slice(-4);
  const viewer = { email: `viewer-${stamp}@example.test`, corpName: `Halcyon Freight ${stamp}` };
  await page.goto(`${base}/register.html`);
  await page.fill("#register-email", viewer.email);
  await page.fill("#register-password", PASSWORD);
  await page.fill("#register-ceo", "Look Ceo");
  await page.fill("#register-corp", viewer.corpName);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, base, viewer.email, PASSWORD);
  await page.waitForURL(/\/\?account=/);
  const rivals = [await registerByApi(base, `Birch Freight ${stamp}`), await registerByApi(base, `Cedar Trading ${stamp}`), await registerByApi(base, `Dune Works ${stamp}`)];
  await stopServer([viewer.email, ...rivals.map((r) => r.email)]);

  // A week of play, in the save: leases, tonnes mined per system and sales per station, yesterday.
  const snapshot = path.join(dataDir, "accounts-snapshot.json");
  const store = JSON.parse(fs.readFileSync(snapshot, "utf8"));
  const byEmail = (email) => Object.values(store.accounts).find((a) => a.email === email);
  const yesterday = Math.floor(Date.now() / DAY) * DAY - DAY;
  const play = {
    [viewer.email]: { leases: ["Earth", "Mars"], extraction: { sol: 900, "tau-ceti": 200 }, sales: { "earth-station-prime": 40_000 } },
    [rivals[0].email]: { leases: ["Venus"], extraction: { sol: 300, "alpha-centauri": 800, "barnards-star": 500 }, sales: { "centauri-prime-station": 30_000 } },
    [rivals[1].email]: { leases: [], extraction: { "tau-ceti": 700, "wolf-359": 400 }, sales: { "halo-anchorage": 12_000 } },
    [rivals[2].email]: { leases: [], extraction: { "barnards-star": 600, sirius: 300 }, sales: { "ironwell-depot": 20_000 } }
  };
  for (const [email, p] of Object.entries(play)) {
    const corp = byEmail(email).state.corp;
    corp.miningLeases = p.leases.map((body, i) => ({ id: `lease-look-${i}-${corp.publicId}`, body, leaseType: "Silicate Extraction", issuedAt: yesterday, cost: 0, buildingSlots: 2, extractorIds: [] }));
    corp.dominance = { extraction: { [yesterday]: p.extraction }, sales: { [yesterday]: p.sales } };
  }
  // The viewer and Cedar Trading are one conglomerate.
  const v = byEmail(viewer.email).state.corp, cedar = byEmail(rivals[1].email).state.corp;
  const cid = "cgl-look-accord";
  store.conglomerates = [{ id: cid, name: `Halcyon Accord ${stamp}`, emblem: 6, colour: 5, level: 1, maxMembers: 5, foundedAt: yesterday, levelSince: yesterday, founder: v.publicId,
    members: [{ corp: v.publicId, role: "founder", joinedAt: yesterday }, { corp: cedar.publicId, role: "member", joinedAt: yesterday }],
    treasury: { credits: 10_000 }, invitations: [], applications: [], arrearsSince: null }];
  v.conglomerateId = cid;
  cedar.conglomerateId = cid;
  fs.writeFileSync(snapshot, JSON.stringify(store));
  fs.rmSync(path.join(dataDir, "dominance.json"), { force: true });
  base = await startServer();

  // The viewer logs in again and opens the Starmap.
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", viewer.email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  const modal = page.locator("#dialogue-modal");
  if (await modal.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) {
    await modal.getByRole("button", { name: "I'll find my own way" }).click({ timeout: 20_000 });
    await modal.waitFor({ state: "hidden", timeout: 10_000 });
  }
  await openTab(page, "starmap");
  await wait(800);
  console.log("reading:", JSON.stringify((await (await fetch(`${base}/api/starmap/dominance?systemId=sol`)).json()).systems.sol));

  for (const [overlay, name] of [["corp-dominance", "corporate"], ["cong-dominance", "conglomerate"]]) {
    await page.locator("#map-overlay").selectOption(overlay);
    await page.locator("#starmap-dominance-legend [data-dominance-legend]").waitFor({ timeout: 15_000 });
    await wait(500);
    console.log(`${name} legend:`, (await page.locator("#starmap-dominance-legend").innerText()).replace(/\s+/g, " ").trim());
    await shot(page, `${name}-cluster`, "#starmap .starmap__toolbar, #starmap-canvas, #starmap-dominance-legend");
    // Sol's panel: its top three
    const canvas = page.locator("#starmap-canvas");
    await page.evaluate(() => { window.__labels = []; window.__arcs = []; });
    await page.locator("#map-reset").click();
    await wait(600);
    await openSystem(page, canvas, "Sol");
    await page.locator("#map-details [data-dominance-details]").waitFor({ timeout: 15_000 });
    console.log(`${name} Sol:`, (await page.locator("#map-details [data-dominance-details]").innerText()).replace(/\s+/g, " ").trim());
    await shot(page, `${name}-sol-details`, "#map-details");
    await page.locator("#map-reset").click();
    await wait(600);
  }
} finally {
  await browser.close();
  if (server) server.kill();
  console.log(shots.join("\n"));
}
