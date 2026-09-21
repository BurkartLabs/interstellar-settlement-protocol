import { describe, it, expect, vi } from "vitest";
import { resolveJwtSecret, JWT_SECRET_MIN_BYTES } from "../../server/jwtSecret.js";

// Bug #589: the signing key fell back to a string in the public source, so an unset JWT_SECRET let anyone mint a
// token for any account. The server now refuses to start without a real secret, unless the dev surface is on.
const strong = "s".repeat(48);

describe("resolveJwtSecret (Bug #589)", () => {
  it("returns a secret of at least 32 bytes as it is", () => {
    expect(JWT_SECRET_MIN_BYTES).toBe(32);
    expect(resolveJwtSecret({ JWT_SECRET: strong }, { devSurface: false })).toBe(strong);
  });

  it("refuses to start without one, naming the variable and how to make one", () => {
    for (const JWT_SECRET of [undefined, ""]) {
      expect(() => resolveJwtSecret({ JWT_SECRET }, { devSurface: false })).toThrow(/JWT_SECRET[\s\S]*not set[\s\S]*openssl rand -base64 48/);
    }
  });

  it("refuses a short secret without repeating it", () => {
    let message = "";
    try { resolveJwtSecret({ JWT_SECRET: "hunter2-short" }, { devSurface: false }); } catch (e) { message = e.message; }
    expect(message).toMatch(/JWT_SECRET[\s\S]*13 bytes/);
    expect(message).not.toContain("hunter2");
  });

  it("allows the development secret only on the dev surface, and says so loudly", () => {
    const warn = vi.fn();
    const secret = resolveJwtSecret({ JWT_SECRET: "" }, { devSurface: true, warn });
    expect(secret.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/ISP_DEV=1/);
  });
});
