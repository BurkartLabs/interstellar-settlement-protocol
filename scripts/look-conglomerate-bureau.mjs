// ISP-200 (AB#894): the Conglomerate Affairs Bureau from the running app, played as two players would, with screenshots
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
async function stopServer() {
  await wait(2000); // the accounts snapshot is written 500 ms after a change
  server.removeAllListeners("exit");
  server.kill();
  await wait(500);
}

const browser = await chromium.launch();
const shots = [];
async function shot(page, name, { wide = true, narrow = true, role = "cong-body", viewport = false } = {}) {
  for (const [w, h, on] of [[1280, 800, wide], [375, 812, narrow]]) {
    if (!on) continue;
    await page.setViewportSize({ width: w, height: h });
    await wait(300);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = path.join(outDir, `ab894-${name}-${w}.png`);
    // From the top of the page, so the sticky header sits where a player sees it; a panel is cut from the full page.
    if (viewport) { await page.screenshot({ path: file }); shots.push(path.basename(file)); continue; } // a modal, as it is seen
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(150);
    const clip = role ? await page.evaluate((r) => {
      const box = document.querySelector(`[data-role="${r}"]`)?.getBoundingClientRect();
      return box ? { x: Math.max(0, box.left - 8), y: box.top + window.scrollY - 8, width: Math.min(box.width + 16, document.documentElement.clientWidth), height: box.height + 16 } : null;
    }, role) : null;
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
  await a.context().close();
  await stopServer();

  // 2. Eight days on: the founder's save is moved back, as if it had been playing a week.
  const snapshot = path.join(dataDir, "accounts-snapshot.json");
  const store = JSON.parse(fs.readFileSync(snapshot, "utf8"));
  store.accounts[founder.accountId].createdAt -= 8 * DAY;
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
} finally {
  await browser.close();
  if (server) server.kill();
  console.log(shots.join("\n"));
}
