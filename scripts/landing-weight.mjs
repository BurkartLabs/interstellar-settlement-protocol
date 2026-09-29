// Bug #4836: what a logged-out visitor downloads, and what a signed-in one does. Starts its own server on a scratch data
// directory, opens the bare landing (/) with empty storage and counts every request under /scripts/ and /vendor/ and
// their bytes; then signs a seeded corporation in through the login page and counts the same for the game view.
// With --lighthouse, also runs Lighthouse's performance category on the landing on its mobile profile, three runs,
// and prints the median score and LCP (Lighthouse run with npx, pinned, as scripts/a11y-lighthouse.mjs does).
//
// Usage: node scripts/landing-weight.mjs [--lighthouse]
// The byte counts are the bodies as served (compressed where the server compresses), from the browser's own sizes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { ALLOW_RESTRICTED_PORTS_ARG } from "./chromium-ports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIGHTHOUSE = "lighthouse@12.8.2";
const SECRET = "exchange-e2e-fixture-secret-0123456789abcd";
const PASSWORD = "playtest-password-not-real";
const email = `weight-${Date.now()}@example.test`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-weight-"));

const seeded = spawnSync(process.execPath, ["e2e/seed-exchange-account.mjs", dir, email, PASSWORD], { cwd: ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
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

/** The requests under /scripts/ and /vendor/ while `step` runs, and their body bytes. */
async function measure(page, step) {
  const seen = [];
  const onDone = async (req) => {
    const u = new URL(req.url());
    if (!/^\/(scripts|vendor)\//.test(u.pathname)) return;
    const sizes = await req.sizes().catch(() => null);
    seen.push({ path: u.pathname, bytes: sizes ? sizes.responseBodySize : 0 });
  };
  page.on("requestfinished", onDone);
  await step();
  await page.waitForLoadState("networkidle");
  page.off("requestfinished", onDone);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  const scripts = seen.filter((r) => r.path.startsWith("/scripts/"));
  const vendor = seen.filter((r) => r.path.startsWith("/vendor/") && r.path.endsWith(".js"));
  return { scripts: scripts.length, scriptBytes: kb(scripts.reduce((s, r) => s + r.bytes, 0)), vendorScripts: vendor.map((r) => r.path), list: scripts.map((r) => r.path) };
}

const browser = await chromium.launch({ args: [ALLOW_RESTRICTED_PORTS_ARG] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const landing = await measure(page, () => page.goto(`${base}/`));
  console.log(`landing (logged out): ${landing.scripts} script modules, ${landing.scriptBytes}; vendor scripts: ${landing.vendorScripts.join(", ") || "none"}`);
  console.log(`  ${landing.list.join(" ")}`);
  const game = await measure(page, async () => {
    await page.goto(`${base}/login.html`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForURL(/\/\?account=|\/$/);
    await page.locator("#game-shell:not([hidden])").waitFor({ timeout: 20_000 });
  });
  console.log(`game (signed in): ${game.scripts} script modules, ${game.scriptBytes}; vendor scripts: ${game.vendorScripts.join(", ") || "none"}; game shell shown`);
  // a reload with the account remembered opens the game again, not the landing
  const again = await measure(page, () => page.goto(`${base}/`));
  const shown = await page.locator("#game-shell:not([hidden])").isVisible().catch(() => false);
  console.log(`reload of / signed in: ${again.scripts} script modules; game shell shown: ${shown}`);
} finally {
  await browser.close();
}

if (process.argv.includes("--lighthouse")) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "isp-lh-"));
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const file = path.join(out, `landing-${i}.json`);
    const args = ["--yes", LIGHTHOUSE, `${base}/`, "--only-categories=performance", "--output=json", `--output-path=${file}`, "--quiet", "--chrome-flags=--headless=new"];
    const run = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, { encoding: "utf8", shell: process.platform === "win32" });
    // on Windows chrome-launcher can fail to remove Chrome's profile after the report is written (EPERM): the report counts
    if (!fs.existsSync(file)) { console.log(`lighthouse run ${i + 1} wrote no report: ${(run.stderr || run.stdout).slice(-400)}`); continue; }
    const lhr = JSON.parse(fs.readFileSync(file, "utf8"));
    runs.push({ score: Math.round(lhr.categories.performance.score * 100), lcp: lhr.audits["largest-contentful-paint"].numericValue, requests: lhr.audits["network-requests"]?.details?.items?.length });
  }
  runs.sort((a, b) => a.score - b.score);
  const mid = runs[Math.floor(runs.length / 2)];
  console.log(`lighthouse, landing, mobile: scores ${runs.map((r) => r.score).join(", ")}; median ${mid?.score}, LCP ${mid ? (mid.lcp / 1000).toFixed(1) : "?"} s, ${mid?.requests} requests`);
  fs.rmSync(out, { recursive: true, force: true });
}
server.kill();
await new Promise((r) => (server.exitCode !== null ? r() : server.once("exit", r)));
fs.rmSync(dir, { recursive: true, force: true });
