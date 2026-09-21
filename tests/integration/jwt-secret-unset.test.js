// Before the server module loads (vitest gives each test file its own copy). Set to "" rather than deleted: the
// server's env loader fills undefined keys from .env, which would hide the missing secret (see tests/setup.js).
process.env.JWT_SECRET = "";
process.env.ISP_DEV = "";

import { describe, it, expect } from "vitest";

// Bug #589: the server signed tokens with a literal from the public source when JWT_SECRET was unset.
describe("the server refuses to start with JWT_SECRET and ISP_DEV unset (Bug #589)", () => {
  it("throws while loading, naming JWT_SECRET", async () => {
    await expect(import("../../server/index.js")).rejects.toThrow(/JWT_SECRET/);
  });
});
