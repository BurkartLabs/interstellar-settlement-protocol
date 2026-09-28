// AB#958 (ISP-262): the mutation gate's grouping, and that it fails closed. A store that cannot count refuses the request
// with 503 rather than letting it through, and nothing is logged with the caller's address.
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createMutationLimits } from "../../server/rateLimiters.js";
import { groupOf, MUTATION_GROUPS, RATE_LIMITS } from "../../server/rateLimitConfig.js";

afterEach(() => vi.restoreAllMocks());

describe("which cost group a route belongs to (AB#958)", () => {
  it.each([
    ["/api/market/orders", "trade"],
    ["/api/accounts/a1/equity/offerings/o1/buy", "trade"],
    ["/api/accounts/a1/loan-offers", "trade"],
    ["/api/accounts/a1/messages/send", "chat"],
    ["/api/accounts/a1/conversations/send", "chat"],
    ["/api/forums/threads/t1/replies", "chat"],
    ["/api/accounts/a1/arbitration/cases", "filing"],
    ["/api/accounts/a1/patents", "filing"],
    ["/api/accounts/a1/lobbying/c1/pledges", "filing"],
    ["/api/accounts/a1/gameplay/build", "construction"],
    ["/api/accounts/a1/gameplay/build-refinery", "construction"],
    ["/api/accounts/a1/gameplay/buildings/b1/upgrade", "construction"],
    ["/api/accounts/a1/gameplay/lease/l1/build-extractor", "construction"],
    ["/api/accounts/a1/conglomerates/c1/station-project/contribute", "construction"],
    ["/api/accounts/a1/gameplay/travel", "default"],
    ["/api/auth/login", "default"]
  ])("%s is %s", (path, group) => expect(groupOf(path)).toBe(group));

  it("keeps every limit in the one configuration, with a production default and a window", () => {
    for (const g of MUTATION_GROUPS) {
      expect(g.address.productionDefault).toBeGreaterThan(0);
      if (g.account) expect(g.account.productionDefault).toBeGreaterThan(0);
    }
    expect(RATE_LIMITS.register).toMatchObject({ windowMs: 60 * 60_000, productionDefault: 5 });
  });
});

describe("the gate fails closed (AB#958)", () => {
  const broken = () => ({
    increment: async () => { throw new Error("store unreachable"); },
    decrement: async () => {},
    resetKey: async () => {}
  });

  function appWith(gate) {
    const app = express();
    app.set("trust proxy", 1);
    app.use(gate);
    app.all("/api/market/orders", (_req, res) => res.json({ ok: true }));
    return app;
  }

  it("refuses a mutating request with 503 when its counter cannot be written, and logs no address", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { address } = createMutationLimits(broken);
    const res = await request(appWith(address)).post("/api/market/orders").set("X-Forwarded-For", "203.0.113.99").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/could not be processed right now/);
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain("203.0.113.99");
  });

  it("leaves reads alone, whatever the store", async () => {
    const { address } = createMutationLimits(broken);
    expect((await request(appWith(address)).get("/api/market/orders")).status).toBe(200);
  });
});
