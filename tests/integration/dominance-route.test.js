import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { getState, mutateAccountState, applyMiningOperations } from "../../server/gameState.js";
import { dayKeyOf } from "../../server/game/dominanceCounters.js";
import { dominanceTick, resetDominanceCache } from "../../server/dominanceService.js";
import { paySeller } from "../../server/marketSettlement.js";
import { makeExtractor } from "../fixtures/makeCorp.js";

// ISP-217 (AB#912): the counters are written where the work settles (a mining span, a sale to an NPC, a listing bought,
// but not by a partner), and GET /api/starmap/dominance serves names and rounded shares from the daily cache, which a
// failed computation leaves as it was.
const DAY = 24 * 60 * 60 * 1000;

async function player() {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  return { id: reg.account.id, app, api: authed(app, reg.accessToken), raw: accountsStore.accounts[reg.account.id] };
}

describe("the counters are written where the work settles (AB#912)", () => {
  it("a mining span counts its tonnes in the lease body's system", async () => {
    const p = await player();
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdowns
    const start = Date.now() - 3_600_000;
    mutateAccountState(p.id, (state) => {
      state.corp.miningLeases.push({ id: "lease-dom", body: "Earth" });
      state.corp.mining = state.corp.mining || {};
      state.corp.mining.silicateExtractors = [makeExtractor({ startedAt: start, lastTickAt: start, endsAt: start + 2 * 3_600_000, throughputPerHour: 60, operationCostPerHour: 0, leaseId: "lease-dom" })];
      applyMiningOperations(state.corp, start + 3_600_000);
    });
    vi.restoreAllMocks();
    const days = p.raw.state.corp.dominance.extraction;
    const total = Object.values(days).reduce((s, d) => s + (d.sol || 0), 0);
    expect(total).toBe(60);
  });

  it("a sale to an NPC counts at the station it was made at", async () => {
    const p = await player();
    mutateAccountState(p.id, (state) => { state.corp.inventory = { ...state.corp.inventory, "earth-station-prime": { Silicates: 100 } }; });
    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const res = await p.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 50 });
    expect(res.status).toBe(200);
    expect(p.raw.state.corp.dominance.sales[dayKeyOf(Date.now())]["earth-station-prime"]).toBeGreaterThan(0);
  });

  it("a listing bought by a conglomerate partner counts nothing; by anyone else it counts", async () => {
    const [seller, partner, stranger] = [await player(), await player(), await player()];
    seller.raw.state.corp.conglomerateId = "cgl-dom";
    partner.raw.state.corp.conglomerateId = "cgl-dom";
    const order = { id: "ord-dom", type: "sell", item: "Silicates", quantity: 10, unitPrice: 30, seller: "S", sellerAccountId: seller.id, stationId: "luna-gateway", createdAt: Date.now() };
    paySeller(order, 5, "Partner", partner.id);
    expect(seller.raw.state.corp.dominance?.sales?.[dayKeyOf(Date.now())]?.["luna-gateway"] ?? 0).toBe(0);
    paySeller(order, 5, "Stranger", stranger.id);
    expect(seller.raw.state.corp.dominance.sales[dayKeyOf(Date.now())]["luna-gateway"]).toBe(150);
  });
});

describe("GET /api/starmap/dominance (AB#912)", () => {
  it("serves names and rounded shares only, summing to 100, with no account ids, credits or volumes", async () => {
    const [a, b] = [await player(), await player()];
    const yesterday = dayKeyOf(Date.now()) - DAY;
    a.raw.state.corp.dominance = { extraction: { [yesterday]: { "tau-ceti": 750 } }, sales: {} };
    b.raw.state.corp.dominance = { extraction: { [yesterday]: { "tau-ceti": 250 } }, sales: {} };
    resetDominanceCache();
    const res = await request(a.app).get("/api/starmap/dominance");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["computedAt", "stale", "systems", "window"]);
    const tau = res.body.systems["tau-ceti"];
    expect(tau.byCorporation.leaders).toEqual([{ name: a.raw.state.corp.corporationName, share: 75 }, { name: b.raw.state.corp.corporationName, share: 25 }]);
    for (const s of Object.values(res.body.systems)) {
      for (const v of [s.byCorporation, s.byConglomerate]) {
        if (s.activity) expect(v.leaders.reduce((t, l) => t + l.share, 0) + v.others).toBe(100);
        else expect(v).toEqual({ leaders: [], others: 0 });
      }
    }
    const text = JSON.stringify(res.body);
    for (const who of [a, b]) {
      expect(text).not.toContain(who.id);
      expect(text).not.toContain(who.raw.state.corp.publicId);
      expect(text).not.toContain(who.raw.email);
    }
    expect(text).not.toMatch(/750|250|credits|tonnes|leases"/);
  });

  it("filters to one system, and refuses a system the catalog does not have", async () => {
    const { app } = await getApp();
    const one = await request(app).get("/api/starmap/dominance?systemId=sol");
    expect(Object.keys(one.body.systems)).toEqual(["sol"]);
    expect((await request(app).get("/api/starmap/dominance?systemId=atlantis")).status).toBe(400);
    expect((await request(app).get("/api/starmap/dominance?systemId[]=sol")).status).toBe(400);
  });

  it("keeps serving the last good result, with its timestamp, when a computation fails", async () => {
    const { app } = await getApp();
    resetDominanceCache();
    expect(dominanceTick(Date.now())).toBe("computed");
    const good = (await request(app).get("/api/starmap/dominance")).body;
    const tomorrow = Date.now() + DAY;
    expect(dominanceTick(tomorrow, () => { throw new Error("injected"); })).toBe("failed");
    expect(dominanceTick(tomorrow, () => ({ computedAt: tomorrow }))).toBe("failed"); // partial: no systems
    const after = (await request(app).get("/api/starmap/dominance")).body;
    expect(after.computedAt).toBe(good.computedAt);
    expect(after.systems).toEqual(good.systems);
    expect(dominanceTick(Date.now())).toBe("cached"); // today's is there: nothing to do until 00:00 UTC
  });

  it("shows a corporation its own components, behind its login", async () => {
    const a = await player();
    const yesterday = dayKeyOf(Date.now()) - DAY;
    a.raw.state.corp.dominance = { extraction: { [yesterday]: { "epsilon-eridani": 100 } }, sales: {} };
    resetDominanceCache();
    const own = await a.api.get(`/api/accounts/${a.id}/dominance`);
    expect(own.status).toBe(200);
    expect(own.body.systems["epsilon-eridani"].corporation).toMatchObject({ extraction: 100, dominance: 100 });
    expect((await request(a.app).get(`/api/accounts/${a.id}/dominance`)).status).toBe(401);
  });
});
