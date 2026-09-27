// ISP-189 (AB#883): the Synthesis Array and the Tier 4 chains from the running app, at 1280x800 and 375x812. The script
// starts its own server on a scratch data directory, registers a corporation through the page, and gives it (in the save,
// as research and play would) the Tier 4 research, credits, slots and the inputs of Antimatter. Then, as a player: the
// Refinery Chains tab before the Array (the Tier 4 card says where it runs), the Array built from the Station's
// construction list, and a Tier 4 run started from its card. Nothing is drawn by this script.
//
// Usage: node scripts/look-synthesis-array.mjs <outDir>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { openTab } from "../e2e/nav.mjs";
import { verifyAndLogIn } from "../e2e/verification.mjs";

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error("usage: node scripts/look-synthesis-array.mjs <outDir>");
fs.mkdirSync(outDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "look-synthesis-"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PASSWORD = "look only throwaway password";
const TECH = ["tt-material-compression", "tt-nano-lattice", "tt-fusion-fuel-cycle", "tt-integrated-manufacturing", "tt-high-energy-synthesis", "tt-exotic-containment", "tt-antimatter-confinement"];

let server = null;
async function startServer() {
  const child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, ISP_DATA_DIR: dataDir, PORT: "0", ISP_DEV: "1", NODE_ENV: "test", ISP_DISABLE_TICKERS: "1", JWT_SECRET: "look-synthesis-secret-0123456789abcdef" },
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
async function stopServer(email) {
  const snapshot = path.join(dataDir, "accounts-snapshot.json");
  for (let i = 0; i < 60; i += 1) {
    await wait(250);
    try { if (Object.values(JSON.parse(fs.readFileSync(snapshot, "utf8")).accounts || {}).some((a) => a.email === email)) break; } catch { /* not yet */ }
  }
  server.removeAllListeners("exit");
  server.kill();
  await wait(500);
}

const browser = await chromium.launch();
const shots = [];
async function shot(page, name, sel, { viewport = false } = {}) {
  for (const [w, h] of [[1280, 800], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h });
    await wait(400);
    const file = path.join(outDir, `ab883-${name}-${w}.png`);
    if (viewport) { await page.screenshot({ path: file }); shots.push(path.basename(file)); continue; }
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(150);
    const clip = await page.evaluate((s) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length && e.offsetParent !== null);
      const b = el?.getBoundingClientRect();
      return b ? { x: Math.max(0, b.left - 8), y: b.top + window.scrollY - 8, width: Math.min(b.width + 16, document.documentElement.clientWidth), height: b.height + 16 } : null;
    }, sel);
    await page.screenshot({ path: file, fullPage: true, ...(clip ? { clip } : {}) });
    shots.push(`${path.basename(file)} (sideways scroll ${sideways}px)`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

try {
  let base = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const email = `synth-${Date.now()}@example.test`;
  await page.goto(`${base}/register.html`);
  await page.fill("#register-email", email);
  await page.fill("#register-password", PASSWORD);
  await page.fill("#register-ceo", "Look Ceo");
  await page.fill("#register-corp", `Kestrel Synthesis ${String(Date.now()).slice(-4)}`);
  await page.click('#register-form button[type="submit"]');
  await verifyAndLogIn(page, base, email, PASSWORD);
  await page.waitForURL(/\/\?account=/);
  await stopServer(email);

  // Research, credits, slots and Antimatter's inputs, as a corporation deep into v0.11 would have them.
  const snapshot = path.join(dataDir, "accounts-snapshot.json");
  const store = JSON.parse(fs.readFileSync(snapshot, "utf8"));
  const corp = Object.values(store.accounts).find((a) => a.email === email).state.corp;
  corp.unlockedTech = [...new Set([...(corp.unlockedTech || []), ...TECH])];
  corp.finances.credits = 2_000_000;
  corp.buildingSlots = 6;
  corp.inventory = { ...(corp.inventory || {}), "earth-station-prime": { ...(corp.inventory?.["earth-station-prime"] || {}), "Exotic Matter": 10, "Fusion Pellets": 40 } };
  fs.writeFileSync(snapshot, JSON.stringify(store));
  base = await startServer();

  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#credential-login-btn");
  await page.waitForURL(/\/\?account=/);
  const modal = page.locator("#dialogue-modal");
  if (await modal.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) {
    await modal.getByRole("button", { name: "I'll find my own way" }).click({ timeout: 20_000 });
    await modal.waitFor({ state: "hidden", timeout: 10_000 });
  }

  // 1. The Tier 4 card before there is an Array: where it runs, and what that needs.
  await openTab(page, "refinery");
  await page.locator("#chain-antimatter-chain").waitFor({ timeout: 15_000 });
  console.log("card before:", (await page.locator("#chain-antimatter-chain").innerText()).replace(/\s+/g, " ").trim());
  await shot(page, "tier4-card-no-array", "#chain-antimatter-chain");

  // 2. The Station's construction list: the Synthesis Array, and building it.
  await openTab(page, "station");
  const section = page.locator("#station-construction-section");
  await section.locator('[data-building-row="synthesis-array"]').waitFor({ timeout: 15_000 });
  await shot(page, "construction-list", "#station-construction-section");
  await section.locator('[data-build-id="synthesis-array"]').click();
  await page.locator("#action-receipt-modal").waitFor({ state: "visible", timeout: 15_000 });
  console.log("receipt:", (await page.locator("#action-receipt-modal").innerText()).replace(/\s+/g, " ").trim().slice(0, 300));
  await shot(page, "build-receipt", "", { viewport: true });
  await page.keyboard.press("Escape");
  await page.locator("#action-receipt-modal").waitFor({ state: "hidden" });

  // 3. The Tier 4 card with an Array: start a run, and see it among the active runs.
  await openTab(page, "refinery");
  const card = page.locator("#chain-antimatter-chain");
  await card.locator(".refinery__start").waitFor({ timeout: 15_000 });
  await shot(page, "tier4-card-ready", "#chain-antimatter-chain");
  await card.locator(".refinery__start").click();
  await page.locator("#refinery-active-runs", { hasText: "Synthesis Array" }).waitFor({ timeout: 15_000 });
  await page.keyboard.press("Escape").catch(() => {});
  await wait(500);
  console.log("active runs:", (await page.locator("#refinery-active-runs").innerText()).replace(/\s+/g, " ").trim().slice(0, 300));
  await shot(page, "active-run", "#refinery-active-runs");
} finally {
  await browser.close();
  if (server) server.kill();
  console.log(shots.join("\n"));
}
