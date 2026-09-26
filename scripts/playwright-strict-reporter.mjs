/**
 * A Playwright reporter that fails a run in which any test did not run (AB#2144, P-GREEN-AND-EMPTY).
 *
 * Playwright passes a run whose tests were skipped, and one that collected nothing when `--pass-with-no-tests` is set;
 * after an interruption or a failed beforeAll, the tests it never reached are "did not run". None of those is a pass.
 * This counts what executed, prints it as the run's last line, and turns the run's status to failed when a test was
 * skipped, never ran, or nothing was collected at all.
 */

/** Files, tests, and the tests that did not run, from the root suite's tests. */
export function tally(tests) {
  const files = new Set(tests.map((t) => t.location?.file));
  const notRun = tests.filter((t) => t.outcome() === "skipped");
  const failed = tests.filter((t) => t.outcome() === "unexpected");
  return { files: files.size, tests: tests.length, failed: failed.length, notRun, passed: tests.length - failed.length - notRun.length };
}

export default class StrictReporter {
  onBegin(config, suite) {
    this.suite = suite;
  }

  printsToStdio() {
    return true;
  }

  onEnd(result) {
    const t = tally(this.suite?.allTests() ?? []);
    const summary = `${t.files} spec files, ${t.tests} tests: ${t.passed} passed, ${t.failed} failed, ${t.notRun.length} not run`;
    const bad = t.tests === 0 || t.notRun.length > 0;
    if (t.tests === 0) console.error("\n[playtest-strict] no tests were collected. That is a failure, not a pass.");
    if (t.notRun.length) {
      console.error(`\n[playtest-strict] ${t.notRun.length} test(s) did not run (skipped, or never reached):`);
      for (const test of t.notRun) console.error(`  - ${test.titlePath().filter(Boolean).join(" > ")}`);
    }
    if (bad || result.status !== "passed") {
      console.error(`\n[playtest-strict] FAILED: ${summary}`);
      return { status: "failed" };
    }
    console.log(`\n[playtest-strict] every test executed: ${summary}`);
  }
}
