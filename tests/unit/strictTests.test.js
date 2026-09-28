import { describe, it, expect } from "vitest";
import vitestConfig from "../../vitest.config.js";
import playwrightConfig from "../../playwright.config.js";
import { judge } from "../../scripts/strict-pass.mjs";
import { tally } from "../../scripts/playwright-strict-reporter.mjs";
import { VITEST_MAX_WORKERS, PLAYWRIGHT_WORKERS, workers } from "../../scripts/test-workers.mjs";

// AB#2144: with several Builder panes' suites on one PC, a beforeAll timed out booting the server and vitest reported
// the whole file as skipped (Bug #2055), which read as nothing wrong. npm test now judges a run by what executed, and
// each runner is bounded so one suite cannot take the whole machine.

const file = (name, statuses, extra = {}) => ({
  name: `/repo/tests/${name}`,
  assertionResults: statuses.map((status, i) => ({ fullName: `${name} ${i}`, status })),
  ...extra
});
const report = (...files) => ({ testResults: files });

describe("npm test's verdict", () => {
  it("passes a run in which every file ran and every test passed", () => {
    const v = judge(report(file("a.test.js", ["passed", "passed"]), file("b.test.js", ["passed"])), [], 0, "/repo");
    expect(v.ok).toBe(true);
    expect(v.summary).toBe("2 test files, 3 tests: 3 passed, 0 failed, 0 not run");
  });

  it("fails a file whose tests were all skipped because its beforeAll timed out, though vitest counted no failure", () => {
    const hookErrors = [{ file: "/repo/tests/boot.test.js", where: "the file", message: "Hook timed out in 30000ms." }];
    const v = judge(report(file("a.test.js", ["passed"]), file("boot.test.js", ["skipped", "skipped"])), hookErrors, 0, "/repo");
    expect(v.ok).toBe(false);
    expect(v.summary).toContain("2 not run");
    expect(v.problems.flat().join("\n")).toContain("Hook timed out");
  });

  it("fails a file that ran no tests at all", () => {
    const v = judge(report(file("a.test.js", ["passed"]), file("empty.test.js", [], { message: "Cannot find module" })), [], 1, "/repo");
    expect(v.ok).toBe(false);
    expect(v.problems.flat().join("\n")).toContain("empty.test.js: Cannot find module");
  });

  it("fails a todo, a missing report, an empty run and a non-zero exit with every test passing", () => {
    expect(judge(report(file("a.test.js", ["passed", "todo"])), [], 0).ok).toBe(false);
    expect(judge(null).ok).toBe(false);
    expect(judge(report()).ok).toBe(false);
    expect(judge(report(file("a.test.js", ["passed"])), [], 1).ok).toBe(false);
  });
});

describe("the playtest's verdict", () => {
  const test = (file, outcome) => ({ location: { file }, outcome: () => outcome, titlePath: () => [file, outcome] });

  it("counts a skipped or never-reached test as not run", () => {
    const t = tally([test("a.spec.js", "expected"), test("a.spec.js", "skipped"), test("b.spec.js", "unexpected")]);
    expect(t).toMatchObject({ files: 2, tests: 3, passed: 1, failed: 1 });
    expect(t.notRun).toHaveLength(1);
  });
});

describe("test worker bounds", () => {
  it("keep each runner to a few workers, set in one place", () => {
    expect(vitestConfig.test.maxWorkers).toBe(VITEST_MAX_WORKERS);
    expect(playwrightConfig.workers).toBe(PLAYWRIGHT_WORKERS);
    // AB#4768: two and one, unless the environment raises them for a lone run or a bigger machine.
    expect(VITEST_MAX_WORKERS).toBe(workers(process.env.TEST_MAX_WORKERS, 2));
    expect(PLAYWRIGHT_WORKERS).toBe(workers(process.env.TEST_PLAYWRIGHT_WORKERS, 1));
    if (!process.env.TEST_MAX_WORKERS) expect(VITEST_MAX_WORKERS).toBe(2);
    if (!process.env.TEST_PLAYWRIGHT_WORKERS) expect(PLAYWRIGHT_WORKERS).toBe(1);
  });

  it("take a worker count or a percentage from the environment, and nothing else", () => {
    expect(workers("6", 2)).toBe(6);
    expect(workers("50%", 2)).toBe("50%");
    for (const bad of [undefined, "", "0", "-1", "0%", "150%", "lots", "2.5"]) expect(workers(bad, 2)).toBe(2);
  });

  it("uses the strict reporter in every playtest", () => {
    expect(playwrightConfig.reporter.map(([name]) => name)).toContain("./scripts/playwright-strict-reporter.mjs");
  });
});
