import { describe, it, expect } from "vitest";
import config from "../../vitest.config.js";

// Bug #2055: every integration file boots the server in beforeAll through tests/helpers/app.js, and importing
// server/index.js on a machine busy with other panes' suites took longer than vitest's default 10s hookTimeout.
// The whole file then went red with its tests reported as skipped. Hooks get a 30s margin; a hung test still
// fails at the default testTimeout, which stays unset on purpose.
describe("vitest timeouts", () => {
  it("gives beforeAll hooks enough time to boot the server under CPU load", () => {
    expect(config.test.hookTimeout).toBeGreaterThanOrEqual(30_000);
  });

  it("leaves the per-test timeout at vitest's default, so a hung test still fails quickly", () => {
    expect(config.test.testTimeout).toBeUndefined();
  });
});
