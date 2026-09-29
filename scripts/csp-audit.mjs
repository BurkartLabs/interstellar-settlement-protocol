// scripts/csp-audit.mjs (AB#959): runs the Playwright suite with CSP violation reports on, and fails if the production
// policy (server/securityHeaders.js) blocked anything. Every server in the run writes to one report file: the shared
// one this script starts (for the specs that use BASE_URL) and every server a spec starts itself, which inherit
// ISP_CSP_REPORT_FILE from this process's environment.
//
//   npm run audit:csp                      the whole suite
//   npm run audit:csp -- e2e/nav.spec.js   some specs (arguments go to playwright test)
//
// What it cannot see: a page no spec opens, and a violation in a browser other than Chromium.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The report file's violations, grouped by directive and blocked resource, most frequent first. */
export function summarize(text) {
  const lines = String(text || "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const groups = new Map();
  for (const v of lines) {
    const key = `${v.directive} blocked ${v.blocked || "(inline)"}`;
    const g = groups.get(key) || { key, count: 0, pages: new Set(), sources: new Set() };
    g.count += 1;
    if (v.page) g.pages.add(String(v.page).replace(/^https?:\/\/[^/]+/, "").split("?")[0]);
    if (v.source) g.sources.add(`${String(v.source).replace(/^https?:\/\/[^/]+/, "")}:${v.line ?? "?"}`);
    groups.set(key, g);
  }
  return { total: lines.length, groups: [...groups.values()].sort((a, b) => b.count - a.count) };
}

function waitForListening(child) {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`the shared server did not start:\n${out}`)), 60_000);
    const onData = (chunk) => {
      out += chunk;
      const m = out.match(/listening on port (\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => { out += chunk; });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`the shared server exited (${code}):\n${out}`)); });
  });
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "isp-csp-audit-"));
  const reportFile = path.join(work, "csp-violations.jsonl");
  fs.writeFileSync(reportFile, "");
  const env = { ...process.env, ISP_CSP_REPORT_FILE: reportFile };

  // The shared server, as playwright.config.js describes it: ISP_DEV=1 for the test outbox, NODE_ENV=test for the limits.
  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env: { ...env, ISP_DEV: "1", NODE_ENV: "test", PORT: "0", ISP_DATA_DIR: path.join(work, "data") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  fs.mkdirSync(path.join(work, "data"), { recursive: true });
  let exitCode = 1;
  try {
    const port = await waitForListening(server);
    const cli = path.join(REPO_ROOT, "node_modules", "@playwright", "test", "cli.js");
    const run = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
      cwd: REPO_ROOT,
      env: { ...env, BASE_URL: `http://127.0.0.1:${port}` },
      stdio: "inherit"
    });
    const playwrightCode = await new Promise((resolve) => run.on("exit", (code) => resolve(code ?? 1)));
    const { total, groups } = summarize(fs.readFileSync(reportFile, "utf8"));
    console.log(`\nCSP audit: ${total} violation${total === 1 ? "" : "s"} reported (report: ${reportFile})`);
    for (const g of groups) {
      console.log(`  ${g.count} x ${g.key}`);
      console.log(`      pages: ${[...g.pages].slice(0, 5).join(", ") || "?"}`);
      if (g.sources.size) console.log(`      from: ${[...g.sources].slice(0, 5).join(", ")}`);
    }
    if (playwrightCode !== 0) console.log(`Playwright exited ${playwrightCode}: the specs that failed may not have reached every page.`);
    exitCode = total === 0 && playwrightCode === 0 ? 0 : 1;
  } finally {
    server.kill();
  }
  process.exit(exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
