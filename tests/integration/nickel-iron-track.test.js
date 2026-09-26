import { describe, it, expect, afterEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getState, applyMiningOperations, applyRefineryOperations } from "../../server/gameState.js";
import { processRndCompletions } from "../../server/ticks.js";
import { resolveMetric } from "../../server/game/progression.js";
import { npcBidFor } from "../../server/economy.js";

// ISP-137 (AB#831): the Nickel-Iron track as a player plays it, through the routes the page calls: lease Mars, mine its
// Iron Ore, buy Nickel from the Belt Refining Cooperative's ask, research Ferrous Metallurgy, smelt Nickel-Iron Alloy,
// forge Pressure Vessels and sell them to Olympus Heavy Industries' standing bid. Time passes through the server's own
// tick functions (the tickers are off in tests), with each timer moved to now first.
afterEach(() => vi.restoreAllMocks());
const MARS = "mars-orbital-dock";
const HOUR = 3_600_000;

async function metallurgist() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.currentStationId = MARS;
    corp.finances.credits = 2_000_000;
    corp.buildingSlots = 6;
    // A Refinery needs Material Compression I and Nano-Lattice Weaving; Ferrous Metallurgy needs the first.
    corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-material-compression", "tt-nano-lattice"];
  });
  const api = authed(app, accessToken);
  const play = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
  const corp = () => getAccountById(account.id).state.corp;
  const held = () => ({ ...(corp().inventory?.[MARS] || {}) });
  return { account, api, play, corp, held };
}

describe("the Nickel-Iron track, from a Mars lease to a sale (AB#831)", () => {
  it("leases Mars, mines Iron Ore, smelts, forges Pressure Vessels and sells them at the bid", async () => {
    const p = await metallurgist();

    // Lease Mars and mine it: 30% of what a Mars yard mines is Iron Ore now, beside Silicates 60 and Bauxite 10 (docs/design/tier3-resources.md, section 3).
    expect((await p.play("rent-office", { stationId: MARS, durationDays: 7 })).status).toBe(200);
    expect((await p.play("hire", { count: 5 })).status).toBe(200);
    const lease = await p.play("purchase-lease", { body: "mars" });
    expect(lease.status, JSON.stringify(lease.body.error)).toBe(200);
    const leaseId = p.corp().miningLeases.find((l) => l.body === "Mars").id;
    expect((await p.play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
    const extractorId = p.corp().mining.silicateExtractors[0].id;
    const mining = await p.play(`lease/${leaseId}/start-mining`, { amount: 100, hours: 12, extractorId });
    expect(mining.status, JSON.stringify(mining.body.error)).toBe(200);
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdown
    mutateAccountState(p.account.id, (s) => applyMiningOperations(s.corp, Date.now() + 12 * HOUR));
    const mined = p.held();
    expect(mined["Iron Ore"]).toBeGreaterThanOrEqual(300);
    const total = Object.values(mined).reduce((a, b) => a + b, 0); // Silicates, Iron Ore and Bauxite (AB#833)
    expect(Math.abs(mined["Iron Ore"] / total - 0.3)).toBeLessThan(0.01);

    // Nickel from the Cooperative's ask at the Dock; a Refinery.
    const nickel = await p.api.post("/api/market/orders/npc-sell-nickel/buy").send({ quantity: 100 });
    expect(nickel.status, JSON.stringify(nickel.body)).toBe(200);
    expect(p.held().Nickel).toBe(100);
    expect((await p.play("build", { buildingId: "refinery" })).status).toBe(200);
    const refineryId = p.corp().refineries[0].id;

    // Without Ferrous Metallurgy, neither chain starts, and nothing is taken.
    for (const chainId of ["smelting-chain", "pressure-vessel-chain"]) {
      const before = p.held();
      const refused = await p.play("start-refinery", { refineryId, chainId, batches: 1 });
      expect(refused.status, chainId).toBe(400);
      expect(refused.body.error).toBe("This chain requires: Ferrous Metallurgy.");
      expect(p.held()).toEqual(before);
    }

    // Research it through the queue, and let it finish.
    expect((await p.play("queue-rnd", { techId: "tt-ferrous-metallurgy" })).status).toBe(200);
    mutateAccountState(p.account.id, (s) => { for (const item of s.queues.corporateRnD) item.startedAt = Date.now() - 11 * HOUR; });
    processRndCompletions();
    expect(p.corp().unlockedTech).toContain("tt-ferrous-metallurgy");

    // Smelt two batches: 300 Iron Ore + 100 Nickel -> 160 Nickel-Iron Alloy, counted as manufactured. Two, because the
    // one-input Pressure Vessel chain keeps AB#1255's at-least-100-units rule: 80 a batch makes its smallest run 160.
    const ironBefore = p.held()["Iron Ore"];
    const smelt = await p.play("start-refinery", { refineryId, chainId: "smelting-chain", batches: 2 });
    expect(smelt.status, JSON.stringify(smelt.body.error)).toBe(200);
    expect(p.held()["Iron Ore"]).toBe(ironBefore - 300);
    expect(p.held().Nickel).toBeUndefined();
    mutateAccountState(p.account.id, (s) => applyRefineryOperations(s.corp, Date.now() + 10 * HOUR));
    expect(p.held()["Nickel-Iron Alloy"]).toBe(160);
    expect(resolveMetric("stat:manufactured:Nickel-Iron Alloy", p.corp())).toBe(160);

    // Forge: 160 Nickel-Iron Alloy -> 50 Pressure Vessels.
    const forge = await p.play("start-refinery", { refineryId, chainId: "pressure-vessel-chain", inputQuantity: 160 });
    expect(forge.status, JSON.stringify(forge.body.error)).toBe(200);
    mutateAccountState(p.account.id, (s) => applyRefineryOperations(s.corp, Date.now() + 12 * HOUR));
    expect(p.held()["Nickel-Iron Alloy"]).toBeUndefined();
    expect(p.held()["Pressure Vessels"]).toBe(50);
    expect(resolveMetric("stat:manufactured:Pressure Vessels", p.corp())).toBe(50);

    // Sell them to Olympus Heavy Industries' standing bid: at least its floor, whatever has been sold into it today.
    const bid = getState().market.npcBuyOrders.find((o) => o.item === "Pressure Vessels");
    expect(bid).toMatchObject({ buyer: "Olympus Heavy Industries", basePrice: 129 });
    const creditsBefore = p.corp().finances.credits;
    const sale = await p.api.post(`/api/market/npc-orders/${bid.id}/sell`).send({ quantity: 50 });
    expect(sale.status, JSON.stringify(sale.body)).toBe(200);
    expect(p.held()["Pressure Vessels"]).toBeUndefined();
    const perUnitBeforeTax = (p.corp().finances.credits - creditsBefore) / 50 / (1 - p.corp().finances.exchangeSalesTaxPct / 100);
    expect(perUnitBeforeTax).toBeGreaterThanOrEqual(npcBidFor(129, Number.MAX_SAFE_INTEGER) - 0.5);
  });

  it("a level that names a product resolves to what the refineries delivered, and an unknown one is refused", () => {
    const corp = { stats: { "manufactured:Nickel-Iron Alloy": 5000 } };
    expect(resolveMetric("stat:manufactured:Nickel-Iron Alloy", corp)).toBe(5000);
    expect(resolveMetric("stat:manufactured:Pressure Vessels", corp)).toBe(0);
    // The stat the ladder named before AB#424 is not a product, so it resolves as any unknown metric does.
    expect(() => resolveMetric("stat:ironSilicateAlloysManufactured", corp)).toThrow();
  });
});
