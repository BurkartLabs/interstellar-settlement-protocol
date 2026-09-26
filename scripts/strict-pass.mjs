/**
 * One vitest run, judged by what executed, not by its exit code (AB#2144, P-GREEN-AND-EMPTY). Ported from job-hunt's
 * scripts/strict-pass.mjs.
 *
 * Bug #2055: under load an integration file's beforeAll timed out booting the server, vitest reported the whole file's
 * tests as skipped, and a skipped file adds zero tests and reads as nothing wrong. Here every collected file must run
 * at least one test, and every test must pass or fail.
 *
 * Fails when: no JSON report; zero files or zero tests; any file that failed to load or ran no tests; any test not
 * passed or failed (skipped, todo, pending); any error outside a test; any failure; vitest exiting non-zero.
 */
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { HOOK_ERRORS_FILE } from "./hook-errors-reporter.mjs";

const vitest = path.join("node_modules", "vitest", "vitest.mjs");

/**
 * The verdict on one run: `report` is vitest's JSON report (or null when none was written), `hookErrors` what
 * hook-errors-reporter.mjs kept, `status` vitest's exit code. Returns { ok, summary, problems }, where each problem
 * is a paragraph of lines naming what did not run or failed.
 */
export function judge(report, hookErrors = [], status = 0, cwd = process.cwd()) {
  if (!report) {
    return {
      ok: false,
      summary: "no report",
      problems: [["no JSON report was produced, so nothing can be said about this run.", "the usual cause is that the runner itself is missing (run npm ci)."]]
    };
  }
  const rel = (f) => path.relative(cwd, f);
  const files = report.testResults ?? [];
  const tests = files.flatMap((f) => (f.assertionResults ?? []).map((t) => ({ file: f.name, name: t.fullName ?? t.title, status: t.status })));
  const notRun = tests.filter((t) => t.status !== "passed" && t.status !== "failed");
  const failed = tests.filter((t) => t.status === "failed");
  const emptyFiles = files.filter((f) => (f.assertionResults ?? []).length === 0);
  const problems = [];

  if (files.length === 0 || tests.length === 0) {
    problems.push([`the runner reported ${files.length} test files and ${tests.length} tests. That is a failure, not a pass.`]);
  }
  if (emptyFiles.length) {
    problems.push([
      `${emptyFiles.length} test file(s) ran no tests (they failed to load, or hold none):`,
      ...emptyFiles.map((f) => `  - ${rel(f.name)}${f.message ? `: ${String(f.message).split("\n")[0]}` : ""}`)
    ]);
  }
  if (notRun.length) {
    problems.push([`${notRun.length} test(s) never ran:`, ...notRun.map((t) => `  - ${t.status}: ${t.name} (${rel(t.file)})`)]);
  }
  // A beforeAll that throws skips every test in its file, and the JSON report leaves the file's message empty; the
  // hook-errors reporter kept the error, so name it beside the tests it cost.
  if (hookErrors.length) {
    problems.push([
      `${hookErrors.length} error(s) outside any test (a hook, a file, a worker):`,
      ...hookErrors.map((e) => `  - ${e.file ? rel(e.file) : "(no file)"}, ${e.where}: ${e.message}`)
    ]);
  }
  if (failed.length) problems.push([`${failed.length} test(s) failed; vitest's output above says why.`]);
  if (!problems.length && status !== 0) {
    problems.push([`every test passed and every file ran, but vitest exited ${status}. Look above for vitest's "Failed Suites" or "Unhandled Errors".`]);
  }
  const summary = `${files.length} test files, ${tests.length} tests: ${tests.length - failed.length - notRun.length} passed, ${failed.length} failed, ${notRun.length} not run`;
  return { ok: problems.length === 0, summary, problems };
}

/** Run vitest with `args` added, judge it, and print why it failed. Returns { ok, summary, seconds }. */
export async function strictPass({ args = [] } = {}) {
  const out = ".vitest-results.json";
  const started = Date.now();
  const status = await new Promise((resolve) => {
    const reporters = ["--reporter=default", "--reporter=json", "--reporter=./scripts/hook-errors-reporter.mjs"];
    const child = spawn(process.execPath, [vitest, "run", ...reporters, `--outputFile.json=${out}`, ...args], { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const read = (file, fallback) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return fallback;
    } finally {
      rmSync(file, { force: true });
    }
  };
  const verdict = judge(read(out, null), read(HOOK_ERRORS_FILE, []), status);
  for (const lines of verdict.problems) console.error(`\n${lines.map((l) => `[test-strict] ${l}`).join("\n")}`);
  return { ok: verdict.ok, summary: verdict.summary, seconds };
}
