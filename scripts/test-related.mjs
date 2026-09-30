#!/usr/bin/env node
// test-related.mjs: run only the tests that relate to what this branch changed (AB#4889, decision 5: "only related
// tests while building; the full suite once per Feature PR, before merge").
//
// Canonical copy: hq ops/test/test-related.mjs. Product repos carry a byte-identical copy at scripts/test-related.mjs;
// `node ops/test/install.mjs <repo>` refreshes it and `--check` reports drift. No dependencies beyond Node and git.
//
//   npm run test:related                  the branch against its merge-base with origin/main
//   npm run test:related -- --base HEAD~1 against another ref
//   npm run test:related -- --base M^1 --head M   what a merged change M relates to (the working tree ignored)
//   npm run test:related -- --dry         list the changed files and the tests chosen; run nothing
//
// What it runs: every test file vitest itself collects (`vitest list --filesOnly`) that
//   1. changed,
//   2. imports a changed file, directly or through other files (relative import/export/require/import()/new URL), or
//   3. names a changed file by its path, a changed non-code file (data, fixtures, styles) by its file name, or the
//      changed file's folder (two levels deep or more), or
//   4. is one of the repo's whole-tree scanners (package.json "testRelated.alwaysRun"), whenever anything else runs.
// A change to a config or setup file (package.json, vitest/vite/ts config, or package.json "testRelated.runAllOn")
// runs everything, and so does a selection larger than "testRelated.maxFiles" (default 200).
// The chosen files go to the repo's own strict runner ("testRelated.runner", default `node scripts/test-strict.mjs`),
// which judges what executed rather than the exit code.
//
// Its blind class, said every run: a test that reaches a file without naming it (a directory scan, a glob, a path
// built at runtime) is not chosen. The full suite (npm run test:gate) is where those are caught.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CODE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx"];
const DEFAULT_RUN_ALL_ON = ["package.json", "package-lock.json", "**/vitest.config.*", "**/vite.config.*", "**/vitest.*.config.*", "**/tsconfig*.json"];
const DEFAULT_MAX_FILES = 200;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

const toPosix = (p) => p.split(path.sep).join("/");
const isCode = (file) => CODE_EXTENSIONS.includes(path.extname(file));

/** The relative specifiers a source file imports: import/export ... from, bare import, import(), require(), new URL(). */
export function importSpecifiers(source) {
  const out = new Set();
  const patterns = [
    /(?:^|[^\w$.])(?:import|export)\s[^'"`;]*?\sfrom\s*["']([^"']+)["']/g,
    /(?:^|[^\w$.])import\s*["']([^"']+)["']/g,
    /(?:^|[^\w$.])import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /(?:^|[^\w$.])require\s*\(\s*["']([^"']+)["']\s*\)/g,
    /new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) if (m[1].startsWith(".")) out.add(m[1]);
  return [...out];
}

/**
 * Where a relative specifier from `fromFile` lands, as a repo-relative posix path, given the set of files that exist.
 * TypeScript's ESM style names a .ts file with .js, so a .js specifier also tries .ts/.tsx; a bare one tries each
 * extension and an index file. Returns the path even when nothing exists there (a deleted file still matches).
 */
export function resolveSpecifier(fromFile, spec, files) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec.split("?")[0]));
  const ext = path.posix.extname(target);
  const stem = ext ? target.slice(0, -ext.length) : target;
  const candidates = [target];
  if ([".js", ".mjs", ".cjs", ".jsx"].includes(ext)) candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  if (!ext) candidates.push(...CODE_EXTENSIONS.map((e) => `${target}${e}`), ...CODE_EXTENSIONS.map((e) => `${target}/index${e}`));
  return candidates.find((c) => files.has(c)) ?? target;
}

/** Map each file to the files that import it. `sources` maps repo-relative paths to their text. */
export function reverseImports(sources) {
  const files = new Set(sources.keys());
  const importers = new Map();
  for (const [file, text] of sources) {
    for (const spec of importSpecifiers(text)) {
      const target = resolveSpecifier(file, spec, files);
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  return importers;
}

/** A glob with * and ** as a RegExp over posix paths. A pattern with no slash matches that name anywhere. */
export function globToRegExp(glob) {
  const body = glob.split("**/").map((part) => part.split("**").map((p) => p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*")).join("(?:.*/)?");
  return new RegExp(glob.includes("/") ? `^${body}$` : `(?:^|/)${body}$`);
}

/**
 * Which test files relate to `changed`. `sources` holds the text of every code file and test file (repo-relative
 * posix paths); `testFiles` is what vitest collects. Returns { tests, runAll, reasons } where reasons says, for each
 * test, why it was chosen.
 */
export function relatedTests({ changed, sources, testFiles, runAllOn = DEFAULT_RUN_ALL_ON, alwaysRun = [] }) {
  const triggers = runAllOn.map(globToRegExp);
  const runAllBy = changed.filter((f) => triggers.some((re) => re.test(f)));
  if (runAllBy.length) return { tests: [...testFiles], runAll: true, reasons: new Map(), runAllBy };

  const tests = new Set(testFiles);
  const reasons = new Map();
  const choose = (test, why) => { if (tests.has(test) && !reasons.has(test)) reasons.set(test, why); };
  const importers = reverseImports(sources);

  for (const file of changed) {
    if (tests.has(file)) choose(file, "changed");
    // everything that imports the file, transitively
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length) {
      const next = queue.shift();
      for (const importer of importers.get(next) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        queue.push(importer);
        choose(importer, `imports ${file}`);
      }
    }
    // tests that name it: by path always, by file name when it is not code (data read at runtime, fixtures, styles),
    // and by its folder when that is two levels deep or more ("public/themes", not "public"): a test that scans it
    const name = path.posix.basename(file);
    const dir = path.posix.dirname(file);
    const namesDir = dir.split("/").length >= 2;
    for (const test of tests) {
      const text = sources.get(test) ?? "";
      if (text.includes(file) || (!isCode(file) && text.includes(name))) choose(test, `names ${file}`);
      else if (namesDir && (text.includes(`"${dir}"`) || text.includes(`'${dir}'`) || text.includes(`${dir}/`))) choose(test, `names ${dir}`);
    }
  }
  // the repo's whole-tree scanners (package.json "testRelated.alwaysRun"): they reach every file without naming it
  if (changed.length) for (const test of alwaysRun) choose(test, "scans the repo");
  return { tests: [...reasons.keys()].sort(), runAll: false, reasons, runAllBy: [] };
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/**
 * Files changed since `base`, relative to `cwd`: committed, staged, unstaged and untracked, deleted files included.
 * With `head`, only what changed between the two refs.
 */
export function changedFiles(base, cwd, head = null) {
  const tracked = git(["diff", "--name-only", "--relative", base, ...(head ? [head] : [])], cwd).split("\n");
  const untracked = head ? [] : git(["ls-files", "--others", "--exclude-standard"], cwd).split("\n");
  return [...new Set([...tracked, ...untracked].map((f) => f.trim()).filter(Boolean))].sort();
}

function walk(dir, root, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(path.join(dir, entry.name), root, out); }
    else if (isCode(entry.name)) out.push(toPosix(path.relative(root, path.join(dir, entry.name))));
  }
  return out;
}

/** What vitest collects here, as repo-relative posix paths (its own include/exclude, whatever the config says). */
function vitestFiles(cwd) {
  const vitest = path.join(cwd, "node_modules", "vitest", "vitest.mjs");
  const r = spawnSync(process.execPath, [vitest, "list", "--filesOnly", "--json"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const start = r.stdout.indexOf("[");
  if (r.status !== 0 || start < 0) throw new Error(`vitest list failed (run npm ci?): ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return JSON.parse(r.stdout.slice(start)).map((t) => toPosix(path.relative(cwd, t.file)));
}

function readConfig(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).testRelated ?? {};
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const opts = { base: "origin/main", head: null, dry: false, extra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base") opts.base = argv[++i];
    else if (argv[i] === "--head") opts.head = argv[++i];
    else if (argv[i] === "--dry") opts.dry = true;
    else opts.extra.push(argv[i]);
  }
  return opts;
}

async function main() {
  const cwd = process.cwd();
  const started = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  const config = readConfig(cwd);
  let base;
  try {
    base = git(["merge-base", "HEAD", opts.base], cwd);
  } catch {
    base = git(["rev-parse", opts.base], cwd); // a ref with no common history: diff against it directly
  }
  const changed = changedFiles(base, cwd, opts.head);
  console.log(`[test-related] ${changed.length} file(s) changed since ${base.slice(0, 8)} (merge-base with ${opts.base})${opts.head ? ` up to ${opts.head}` : ""}`);
  if (!changed.length) {
    console.log("[test-related] nothing changed, so nothing to run.");
    return 0;
  }

  const testFiles = vitestFiles(cwd);
  const sources = new Map();
  for (const file of new Set([...walk(cwd, cwd, []), ...testFiles])) {
    try { sources.set(file, fs.readFileSync(path.join(cwd, file), "utf8")); } catch { /* deleted or unreadable */ }
  }
  const runAllOn = [...DEFAULT_RUN_ALL_ON, ...(config.runAllOn ?? [])];
  const picked = relatedTests({ changed, sources, testFiles, runAllOn, alwaysRun: config.alwaysRun ?? [] });
  const maxFiles = Number(config.maxFiles) || DEFAULT_MAX_FILES;
  const runAll = picked.runAll || picked.tests.length > maxFiles;

  if (picked.runAll) console.log(`[test-related] ${picked.runAllBy.join(", ")} changed: every test relates. Running the full suite.`);
  else if (runAll) console.log(`[test-related] ${picked.tests.length} of ${testFiles.length} test files relate (over ${maxFiles}): running the full suite.`);
  else for (const t of picked.tests) console.log(`  ${t}  (${picked.reasons.get(t)})`);

  if (!runAll && !picked.tests.length) {
    const code = changed.filter(isCode);
    console.log(`[test-related] no test relates to the ${changed.length} changed file(s).` + (code.length ? ` Untested code: ${code.join(", ")}.` : ""));
    return 0;
  }
  console.log(`[test-related] ${runAll ? testFiles.length : picked.tests.length} of ${testFiles.length} test files. Not seen: tests that reach a file without naming it (a directory scan, a glob); npm run test:gate runs them.`);
  if (opts.dry) return 0;

  const runner = config.runner ?? ["node", "scripts/test-strict.mjs"];
  const [cmd, ...cmdArgs] = runner;
  const args = [...cmdArgs, ...(runAll ? [] : picked.tests), ...opts.extra];
  const status = await new Promise((resolve) => {
    const child = spawn(cmd === "node" ? process.execPath : cmd, args, { cwd, stdio: "inherit" });
    child.on("close", (c) => resolve(c ?? 1));
  });
  console.log(`[test-related] ${status === 0 ? "passed" : "FAILED"} in ${Math.round((Date.now() - started) / 1000)} s`);
  return status;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => process.exit(code), (error) => { console.error(`[test-related] ${error.message}`); process.exit(1); });
}
