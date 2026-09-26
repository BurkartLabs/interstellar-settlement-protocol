// ISP-83 (AB#772): Lighthouse accessibility on the landing page and the main app view, on a phone and a desktop.
// Starts its own server on a temporary data directory and seeds a corporation with something on every screen
// (e2e/seed-industry-account.mjs). Lighthouse (run with npx, pinned, not a dependency) launches its own Chrome. The app
// view is /?account=<id>, which restores the session from the refresh cookie as a player's reload does: before each run
// the script logs in over HTTP and hands Lighthouse that cookie as a header (a refresh rotates it, so one per run).
//
// Usage: node scripts/a11y-lighthouse.mjs [outDir]   (writes <outDir>/<page>-<formFactor>.json and summary.json)
// Chrome: the one chrome-launcher finds, or CHROME_PATH.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIGHTHOUSE = "lighthouse@12.8.2";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(REPO_ROOT, "e2e", "screenshots", "ab-772", "lighthouse"));
const SECRET = "a11y-lighthouse-fixture-secret-0123456789ab";
const PASSWORD = "playtest-password-not-real";
fs.mkdirSync(OUT, { recursive: true });

function startServer(dir) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: SECRET, ISP_DEV: "", ISP_DISABLE_TICKERS: "1" },
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

/** A fresh session: the account id and the refresh cookie a login sets. */
async function logIn(url, email) {
  const res = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login answered ${res.status}`);
  const body = await res.json();
  const cookie = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("isp_refresh="))?.split(";")[0];
  if (!cookie) throw new Error("login set no refresh cookie");
  return { accountId: body.account.id, cookie };
}

/** One Lighthouse accessibility run; returns { score, failing, finalUrl }. */
function audit(url, name, formFactor, headers) {
  const file = path.join(OUT, `${name}-${formFactor}.json`);
  const args = ["--yes", LIGHTHOUSE, url, "--only-categories=accessibility", "--output=json", `--output-path=${file}`, "--quiet",
    "--chrome-flags=--headless=new", ...(formFactor === "desktop" ? ["--preset=desktop"] : [])];
  if (headers) {
    const headerFile = path.join(OUT, `${name}-${formFactor}.headers.json`);
    fs.writeFileSync(headerFile, JSON.stringify(headers));
    args.push(`--extra-headers=${headerFile}`);
  }
  fs.rmSync(file, { force: true });
  const run = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, { encoding: "utf8", shell: process.platform === "win32" });
  // On Windows chrome-launcher cannot always delete its temporary profile while Chrome lets go of it (EPERM in
  // destroyTmp), after the report is written; that is not a failed audit.
  const cleanupOnly = run.status !== 0 && fs.existsSync(file) && /destroyTmp/.test(run.stderr || "");
  if (run.status !== 0 && !cleanupOnly) throw new Error(`lighthouse ${name} ${formFactor} failed: ${run.stderr || run.stdout}`);
  if (headers) fs.rmSync(path.join(OUT, `${name}-${formFactor}.headers.json`)); // a session cookie is not kept
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const category = report.categories.accessibility;
  const failing = category.auditRefs
    .map((ref) => report.audits[ref.id])
    .filter((a) => a.score !== null && a.score < 1)
    .map((a) => ({ id: a.id, title: a.title, items: (a.details?.items || []).map((i) => i.node?.snippet || i.node?.selector || "").slice(0, 8) }));
  return { score: Math.round(category.score * 100), failing, finalUrl: report.finalDisplayedUrl };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-a11y-lighthouse-"));
const email = `a11y-${Date.now()}@example.test`;
const seeded = spawnSync(process.execPath, ["e2e/seed-industry-account.mjs", dir, email, PASSWORD], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, JWT_SECRET: SECRET } });
if (seeded.status !== 0) throw new Error(`seeding failed: ${seeded.stdout}\n${seeded.stderr}`);
const { child, url } = await startServer(dir);
const results = {};
try {
  for (const ff of ["mobile", "desktop"]) results[`landing-${ff}`] = audit(`${url}/`, "landing", ff);
  for (const ff of ["mobile", "desktop"]) {
    const { accountId, cookie } = await logIn(url, email);
    results[`app-${ff}`] = audit(`${url}/?account=${encodeURIComponent(accountId)}`, "app", ff, { Cookie: cookie });
  }
} finally {
  child.kill();
}

for (const [name, r] of Object.entries(results)) {
  console.log(`${name}: ${r.score}  (${r.finalUrl})`);
  for (const f of r.failing) console.log(`  - ${f.id}: ${f.title}${f.items.length ? `\n      ${f.items.join("\n      ")}` : ""}`);
}
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(results, null, 2));
