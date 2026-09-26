import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getState, applyMiningOperations } from "../../server/gameState.js";
import { makeExtractor } from "../fixtures/makeCorp.js";

// AB#712: the ledger is only as true as its coverage. Drive one corporation through every kind of spending and earning
// the routes offer, then check opening credits + income - expenses = closing credits, exactly. Before AB#712 hiring,
// leases, construction, research, CEO programs and exchange purchases moved credits and booked nothing.
async function corporation() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const c = state.corp;
    c.currentStationId = "earth-station-prime";
    c.offices = [];
    c.employeeCount = 10;
    c.completedInsights = [];
    c.inventory = { "earth-station-prime": { Silicates: 200 }, "mars-orbital-dock": { Silicates: 50 } };
    c.finances.credits = 5_000_000;
    c.finances.incomeBySource = {};
    c.finances.expensesByCategory = {};
    c.finances.lifetimeRevenue = 0;
    c.finances.lifetimeCosts = 0;
  });
  const corp = () => getAccountById(account.id).state.corp;
  return { id: account.id, api: authed(app, accessToken), corp };
}

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

describe("the corporate ledger reconciles (AB#712)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opening + income - expenses = closing, across hire, rent, lease, build, mining, research, CEO, buy, sell and transfer", async () => {
    const { id, api, corp } = await corporation();
    const opening = corp().finances.credits;
    const ok = async (res, what) => expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);

    // Bug #1124: hiring requires an active office at the docked station, so rent one before hiring.
    await ok(await api.post(`/api/accounts/${id}/gameplay/rent-office`).send({ stationId: "earth-station-prime", durationDays: 28 }), "rent");
    await ok(await api.post(`/api/accounts/${id}/gameplay/hire`).send({ count: 2 }), "hire");
    // Leases are filed at the station orbiting the body in some builds (AB#1091), so file it docked at Mars, with
    // an office there too (Bug #1124: an office elsewhere no longer authorizes a lease filed here).
    mutateAccountState(id, (state) => { state.corp.currentStationId = "mars-orbital-dock"; });
    await ok(await api.post(`/api/accounts/${id}/gameplay/rent-office`).send({ stationId: "mars-orbital-dock", durationDays: 28 }), "rent-mars");
    await ok(await api.post(`/api/accounts/${id}/gameplay/purchase-lease`).send({ body: "mars" }), "lease");
    mutateAccountState(id, (state) => { state.corp.currentStationId = "earth-station-prime"; });
    const leaseId = corp().miningLeases.at(-1).id;
    await ok(await api.post(`/api/accounts/${id}/gameplay/lease/${leaseId}/build-extractor`).send({}), "build");
    await ok(await api.post(`/api/accounts/${id}/gameplay/queue-rnd`).send({ techId: "tt-basic-extraction" }), "research");
    await ok(await api.post(`/api/accounts/${id}/gameplay/queue-ceo`).send({ programId: "ceo-risk-assessment" }), "ceo");

    // A mining tick on the stored state: an hour of an extractor's running cost.
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime roll
    const start = Date.now() - 3_600_000;
    mutateAccountState(id, (state) => {
      state.corp.miningLeases.push({ id: "lease-tick", body: "Earth" });
      state.corp.mining = state.corp.mining || {};
      state.corp.mining.silicateExtractors = [
        makeExtractor({ startedAt: start, lastTickAt: start, endsAt: start + 2 * 3_600_000, throughputPerHour: 60, operationCostPerHour: 960, leaseId: "lease-tick" })
      ];
      applyMiningOperations(state.corp, start + 3_600_000);
    });
    vi.restoreAllMocks();

    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    await ok(await api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 50 }), "sell to NPC");
    await ok(await api.post(`/api/accounts/${id}/gameplay/transfer-resources`).send({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 10 }] }), "transfer");

    // Buy from another corporation's listing, and that seller's side reconciles too.
    const seller = await corporation();
    const sellerOpening = seller.corp().finances.credits;
    const listed = await seller.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 20, unitPrice: 31 });
    await ok(listed, "list");
    const orderId = getState().market.orderBook.find((o) => o.sellerAccountId === seller.id)?.id;
    await ok(await api.post(`/api/market/orders/${orderId}/buy`).send({ quantity: 20 }), "buy");

    const f = corp().finances;
    const income = sum(f.incomeBySource);
    const expenses = sum(f.expensesByCategory);
    expect(opening + income - expenses).toBe(f.credits);
    expect([f.lifetimeRevenue, f.lifetimeCosts]).toEqual([income, expenses]);
    // Every movement landed under a named category, and each kind of action is there.
    expect(Object.keys(f.expensesByCategory).sort()).toEqual(
      // ISP-302 (AB#2285): this corporation holds two leases, so its sale books the royalty's share on its own.
      ["ceo-insight", "construction", "exchange-purchases", "exchange-tax", "hiring", "lease-royalty", "leases", "mining-ops", "office-rent", "research", "transfer-fees"]
    );
    expect(Object.keys(f.incomeBySource)).toEqual(["exchange"]);
    expect(f.expensesByCategory["exchange-purchases"]).toBe(20 * 31);
    expect(f.expensesByCategory["mining-ops"]).toBe(960);

    const s = seller.corp().finances;
    expect(sellerOpening + sum(s.incomeBySource) - sum(s.expensesByCategory)).toBe(s.credits);
    expect(s.incomeBySource.exchange).toBe(20 * 31);
  });

  it("mining charges what the balance can pay and books exactly that, never below zero", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const { id, corp } = await corporation();
    const start = Date.now() - 3_600_000;
    mutateAccountState(id, (state) => {
      state.corp.finances.credits = 500;
      state.corp.miningLeases = [{ id: "lease-tick", body: "Earth" }];
      state.corp.mining = { silicateExtractors: [makeExtractor({ startedAt: start, lastTickAt: start, endsAt: start + 2 * 3_600_000, throughputPerHour: 60, operationCostPerHour: 960, leaseId: "lease-tick" })] };
      applyMiningOperations(state.corp, start + 3_600_000);
    });
    const f = corp().finances;
    expect(f.credits).toBeGreaterThanOrEqual(0);
    expect(500 - (f.expensesByCategory["mining-ops"] || 0)).toBe(f.credits);
    expect(corp().mining.silicateExtractors[0].totalSpent).toBe(f.expensesByCategory["mining-ops"]);
  });
});
