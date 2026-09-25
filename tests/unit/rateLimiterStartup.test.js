// AB#1747: express-rate-limit logs (does not throw) a ValidationError at setup time if a custom keyGenerator's
// source text contains "req.ip" without "ipKeyGenerator". loginAccountLimiter's no-email fallback used to do
// exactly that. This file gets its own fresh module instance (see tests/helpers/app.js), so it is the first
// import of server/index.js — and therefore the first construction of every limiter — in this test run.
import { describe, it, expect, vi, afterEach } from "vitest";

describe("rate limiter setup (AB#1747)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log an express-rate-limit ValidationError on import", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../../server/index.js");
    const flagged = errorSpy.mock.calls.filter(([msg]) =>
      String(msg?.message ?? msg ?? "").includes("ERR_ERL_KEY_GEN_IPV6")
    );
    expect(flagged).toEqual([]);
  });
});
