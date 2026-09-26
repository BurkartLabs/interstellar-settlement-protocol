import { describe, it, expect } from "vitest";
import config from "../../vitest.config.js";

// Bug #2055: every integration file boots the server in beforeAll through tests/helpers/app.js, and importing
// server/index.js on a machine busy with other panes' suites took longer than vitest's default 10s hookTimeout.
// The whole file then went red with its tests reported as skipped. Hooks get a 30s margin.
//
// Bug #2051: the same load pushed ordinary integration tests past the 5s default testTimeout, in different files on
// every run (under 16 busy loops, 21 tests in 6 files timed out at 5s; under 8, the slowest took 3.2s). Tests get 20s.
describe("vitest timeouts", () => {
  it("gives beforeAll hooks enough time to boot the server under CPU load", () => {
    expect(config.test.hookTimeout).toBeGreaterThanOrEqual(30_000);
  });

  it("gives each test enough time to register, log in and make its requests under CPU load", () => {
    expect(config.test.testTimeout).toBeGreaterThanOrEqual(20_000);
  });
});
