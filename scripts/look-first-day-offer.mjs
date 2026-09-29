// Bug #4885: is "Your first day" offered again on a second browser? Seeds two corporations in a scratch data directory
// (verified, briefing neither finished nor declined): a new one, and one at Level 12 with an office rented, as the AB#971
// RC run's was. Starts its own server on a port the OS picks, then:
//   1. the new corporation signs in: the offer is shown; it declines ("I'll find my own way");
//   2. the same corporation signs in from a fresh browser (empty storage): is the offer shown?
//   3. the Level 12 corporation signs in from a fresh browser: is the offer shown?
// Shots of steps 2 and 3 at 1280x800 go to <outDir> with <prefix>.
//
// Usage: node scripts/look-first-day-offer.mjs <outDir> [prefix]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { ALLOW_RESTRICTED_PORTS_ARG } from "./chromium-ports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || "docs/bug-4885");
const prefix = process.argv[3] || "after";
const SECRET = "first-day-offer-look-secret-0123456789abcdef";
const PASSWORD = "playtest-password-not-real";
const stamp = Date.now();
const fresh = `fresh-${stamp}@example.test`;
const veteran = `veteran-${stamp}@example.test`;
fs.mkdirSync(outDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-first-day-"));

const SEED = `
  const store = await import("./server/gameState.js");
  const { issueVerificationToken, verifyEmailToken } = await import("./server/emailVerification.js");
  for (const [email, corpName, started] of [[${JSON.stringify(fresh)}, "Fresh Start Corp", false], [${JSON.stringify(veteran)}, "Veteran Holdings", true]]) {
    const { account } = await store.createAccount({ email, password: ${JSON.stringify(PASSWORD)}, ceoName: "QA", corpName });
    verifyEmailToken(issueVerificationToken(account.id));
    if (started) store.mutateAccountState(account.id, (s) => { s.corp.level = 12; s.corp.stats = { ...(s.corp.stats || {}), officeRented: 3 }; });
  }
  await store.saveAccountsNow();
`;
const seeded = spawnSync(process.execPath, ["--input-type=module", "-e", SEED], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ISP_DATA_DIR: dir, JWT_SECRET: SECRET, NODE_ENV: "test" } });
if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr}`);
const server = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "" }, stdio: ["ignore", "pipe", "pipe"] });
const base = await new Promise((resolve, reject) => {
  let out = "";
  const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
  const read = (chunk) => {
    out += chunk;
    const port = out.match(/listening on port (\d+)/)?.[1];
    if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
  };
  server.stdout.on("data", read);
  server.stderr.on("data", read);
  server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
});

const browser = await chromium.launch({ args: [ALLOW_RESTRICTED_PORTS_ARG] });
const errors = [];
async function signIn(email) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); // empty storage
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login.html`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.locator("#game-shell:not([hidden])").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500); // the offer, when it comes, is made as the game opens
  return page;
}
const offered = (page) => page.locator("#dialogue-modal:not([hidden])").filter({ hasText: "Your first day" }).isVisible();
try {
  const first = await signIn(fresh);
  console.log(`1. new corporation, first browser: offered ${await offered(first)}`);
  await first.getByRole("button", { name: "I'll find my own way" }).click();
  await first.waitForTimeout(800); // the decline is posted
  const second = await signIn(fresh);
  console.log(`2. same corporation, a fresh browser after declining: offered ${await offered(second)}`);
  await second.screenshot({ path: path.join(outDir, `${prefix}-declined-second-browser-1280x800.png`) });
  const vet = await signIn(veteran);
  console.log(`3. Level 12 corporation (office rented, flag never set), a fresh browser: offered ${await offered(vet)}`);
  await vet.screenshot({ path: path.join(outDir, `${prefix}-level12-fresh-browser-1280x800.png`) });
  console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => (server.exitCode !== null ? r() : server.once("exit", r)));
  fs.rmSync(dir, { recursive: true, force: true });
}
