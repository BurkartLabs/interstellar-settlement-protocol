import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// Bug #423: POST /api/dev/set-credits let anyone set any corporation's balance, because nothing checked that a route
// outside /api/accounts/:accountId required a login. This test enumerates every route Express has registered, so a new
// route cannot slip in unnoticed: each one either rejects a request without a bearer token (401 or 403) or is listed
// below as public, with the reason.
const PUBLIC = {
  "POST /api/auth/register": "creating an account",
  "POST /api/auth/login": "signing in",
  "POST /api/auth/refresh": "exchanging the refresh cookie, which is itself the credential (AB#757)",
  "POST /api/auth/logout": "revoking the refresh cookie, which is itself the credential (AB#757)",
  "GET /healthz": "the container platform's health probe (AB#735)",
  "GET /how-to-start": "the playtest briefing, a static page for people who have not registered yet (AB#748)",
  "GET /api/bootstrap": "the global game state shown before login",
  "GET /api/stations": "a static catalog",
  "GET /api/systems": "a static catalog (ISP-112, AB#804)",
  "GET /api/buildings": "a static catalog",
  "GET /api/ceo-insight": "a static catalog",
  "GET /api/mission-agents": "a static catalog",
  "GET /api/research": "a static catalog",
  "GET /api/starmap/dominance": "aggregate dominance shares per system, names and rounded shares only, for the starmap overlay (ISP-217, AB#912)",
  "POST /api/auth/verify-email": "spending a verification token, which is itself the credential (AB#987)",
  "POST /api/auth/resend-verification": "asking for a new verification link before anyone can sign in; rate-limited, one answer for every address (AB#987)",
  "POST /api/auth/forgot-password": "asking for a password-reset link by someone who cannot sign in; rate-limited, one answer for every address (AB#988)",
  "POST /api/auth/reset-password": "spending a reset token, which is itself the credential (AB#988)"
};

/** Routes that exist only when ISP_DEV=1 outside production (the test process sets it); they answer without a login by design. */
const DEV_ONLY = {
  "POST /api/auth/dummy-login": "the shared demo account",
  "POST /api/auth/dummy-reset": "resetting the shared demo account",
  "GET /kanban/api": "the developer kanban board (Bug #1069)",
  "POST /kanban/api": "the developer kanban board (Bug #1069)",
  "GET /api/dev/outbox": "the test mail transport's outbox, for local play and e2e (AB#987); there is no outbox in production"
};

/** Open today and removed by a pull request not yet merged; skipped if the route no longer exists. */
const REMOVED_ELSEWHERE = {
  "POST /api/combat/simulate": "Bug #1036, removed by !147"
};

function routes(stack, prefix = "") {
  return stack.flatMap((layer) => {
    if (layer.route) {
      return Object.keys(layer.route.methods).map((m) => ({ method: m.toUpperCase(), path: prefix + layer.route.path }));
    }
    if (layer.name === "router" && layer.handle?.stack) {
      const mount = (layer.regexp.source.match(/^\^\\\/([^\\?]+)/) || [])[1];
      return routes(layer.handle.stack, mount ? `${prefix}/${mount.replace(/\\\//g, "/")}` : prefix);
    }
    return [];
  });
}

describe("every route requires a login unless it is listed as public (Bug #423)", async () => {
  const { app } = await getApp();
  const all = routes(app._router.stack);

  it("finds the routes (the enumeration itself works)", () => {
    const keys = all.map((r) => `${r.method} ${r.path}`);
    expect(all.length).toBeGreaterThan(50);
    expect(keys).toContain("POST /api/auth/login");
    expect(keys).toContain("POST /api/accounts/:accountId/gameplay/hire");
  });

  it("has no route that sets credits from a request body", () => {
    expect(all.map((r) => r.path)).not.toContain("/api/dev/set-credits");
  });

  for (const r of all) {
    const key = `${r.method} ${r.path}`;
    if (PUBLIC[key] || DEV_ONLY[key] || REMOVED_ELSEWHERE[key]) continue;
    it(`${key} rejects a request with no login`, async () => {
      const path = r.path.replace(/:accountId/g, "acc-not-mine").replace(/:[A-Za-z]+/g, "x");
      const res = await request(app)[r.method.toLowerCase()](path).send({ accountId: "dummy", credits: 999999999 });
      expect([401, 403], `${key} answered ${res.status}`).toContain(res.status);
    });
  }

  it("lists nothing as public that does not exist", () => {
    const keys = new Set(all.map((r) => `${r.method} ${r.path}`));
    expect(Object.keys({ ...PUBLIC, ...DEV_ONLY }).filter((k) => !keys.has(k))).toEqual([]);
  });
});
