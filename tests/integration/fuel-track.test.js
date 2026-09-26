import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { applyRefineryOperations, getAccountById, getState, mutateAccountState } from "../../server/gameState.js";
import { miningTick, shipmentTick } from "../../server/ticks.js";
import { npcBidFor } from "../../server/economy.js";

// ISP-136 (AB#830): the Helium-3 and Deuterium track, from a lease to a sale, through the server's routes. Luna's lease
// yields Helium-3; Rime's (Ross 248, filed at Frost Relay Depot) yields Deuterium, Water Ice and Hydrogen. The three
// Fuel chains (he3-chain, fusion-fuel-chain, cryogenics-chain) run to their last outputs, each gated by the research
// docs/design/tier3-recipes.md names, and every output sells to its Lunar Helium Consortium bid.
// What is seeded rather than played: research (granted, not queued), the move from Luna to Ross 248 (docked there, not
// travelled), the yards' clocks (an hour of running, rewound), and the refinery's (a year on).
afterEach(() => vi.restoreAllMocks());

const HOUR = 3_600_000;
const RESEARCH = ["tt-basic-extraction", "tt-material-compression", "tt-nano-lattice", "tt-energy-routing", "tt-containment-physics", "tt-exotic-energy-routing",
  "tt-proxima-navigation", "tt-deep-star-navigation"];

async function corporation() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const api = authed(app, accessToken);
  mutateAccountState(account.id, (s) => {
    s.corp.finances.credits = 2_000_000;
    s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), ...RESEARCH])];
    s.corp.currentSystemId = "sol";
    s.corp.currentStationId = "luna-gateway";
  }, { sanitize: false, settleMining: false });
  const play = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
  const corp = () => getAccountById(account.id).state.corp;
  const held = (station) => ({ ...(corp().inventory?.[station] || {}) });
  const ok = async (res, what) => { expect(res.status, `${what}: ${JSON.stringify(res.body?.error)}`).toBe(200); return res; };
  /** Lease a body at the station the corporation is docked at, build a yard on it, and run the yard an hour. */
  async function mineAn_hour(body, station) {
    await ok(await play("rent-office", { stationId: station, durationDays: 7 }), `rent an office at ${station}`);
    await ok(await play("hire", { count: 5 }), "hire");
    await ok(await play("purchase-lease", { body }), `lease ${body}`);
    const lease = corp().miningLeases.find((l) => l.body === body);
    await ok(await play(`lease/${lease.id}/build-extractor`), `a yard on ${body}`);
    const yard = corp().mining.silicateExtractors.find((x) => x.leaseId === lease.id);
    await ok(await play(`lease/${lease.id}/start-mining`, { amount: 40, hours: 2, extractorId: yard.id }), `mine ${body}`);
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime
    const now = Date.now();
    mutateAccountState(account.id, (s) => {
      const ex = s.corp.mining.silicateExtractors.find((x) => x.id === yard.id);
      Object.assign(ex, { startedAt: now - HOUR, lastTickAt: now - HOUR, endsAt: now + HOUR, throughputPerHour: 1000, operationCostPerHour: 0 });
    }, { settleMining: false });
    miningTick();
    vi.restoreAllMocks();
  }
  const refine = (body) => play("start-refinery", { refineryId: corp().refineries[0].id, ...body });
  /** The server's refinery tick, a year on: the running cycle has ended. */
  const finishRefining = () => mutateAccountState(account.id, (s) => applyRefineryOperations(s.corp, Date.now() + 365 * 24 * HOUR));
  /** Sell everything held of `item` here to its standing order; returns what the order paid a unit. */
  async function sellAll(item, station) {
    const order = getState().market.npcBuyOrders.find((o) => o.item === item);
    expect(order, `a standing bid for ${item}`).toBeDefined();
    expect(order.buyer).toBe("Lunar Helium Consortium");
    const quantity = held(station)[item];
    const credits = corp().finances.credits;
    const price = npcBidFor(order.basePrice, order.soldToday);
    await ok(await authed((await getApp()).app, accessToken).post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity }), `sell ${item}`);
    expect(held(station)[item] || 0, item).toBe(0);
    expect(corp().finances.credits, `${item} paid`).toBeGreaterThan(credits);
    expect(price, `${item} at or above its floor`).toBeGreaterThanOrEqual(npcBidFor(order.basePrice, Number.MAX_SAFE_INTEGER));
    return { quantity, price };
  }
  return { account, play, corp, held, ok, mineAn_hour, refine, finishRefining, sellAll };
}

describe("the Fuel track, from a lease to a sale (AB#830)", () => {
  it("Luna's Helium-3 and Rime's Deuterium, Water Ice and Hydrogen run through all three chains and sell to the Consortium", async () => {
    const c = await corporation();

    // Luna: Silicates 60, Helium-3 25, Bauxite 15 (AB#833), of an hour at 1,000 t/h times Basic Extraction's 1.1.
    await c.mineAn_hour("Luna", "luna-gateway");
    expect(c.held("luna-gateway")).toEqual({ Silicates: 660, "Helium-3": 275, Bauxite: 165 });
    await c.ok(await c.play("build-refinery"), "build a Refinery");

    // he3-chain at Luna Gateway: Helium-3 into Plasma Conduits and Dark-Matter Capacitors, sold there.
    await c.ok(await c.refine({ chainId: "he3-chain", inputQuantity: 100 }), "he3-chain");
    c.finishRefining();
    expect(c.held("luna-gateway")).toMatchObject({ "Helium-3": 175, "Plasma Conduits": 40, "Dark-Matter Capacitors": 10 });
    expect((await c.sellAll("Plasma Conduits", "luna-gateway")).price).toBe(159);
    expect((await c.sellAll("Dark-Matter Capacitors", "luna-gateway")).price).toBe(423);

    // Rime, at Frost Relay Depot in Ross 248: Water Ice 55, Deuterium 20, Hydrogen 15, Silicates 10.
    mutateAccountState(c.account.id, (s) => { s.corp.currentSystemId = "ross-248"; s.corp.currentStationId = "frost-relay-depot"; },
      { sanitize: false, settleMining: false });
    await c.mineAn_hour("Rime", "frost-relay-depot");
    expect(c.held("frost-relay-depot")).toEqual({ "Water Ice": 605, Deuterium: 220, Hydrogen: 165, Silicates: 110 });

    // Helium-3 shipped from Luna Gateway to where the Deuterium is.
    await c.ok(await c.play("transfer-resources", { fromStationId: "luna-gateway", lines: [{ item: "Helium-3", quantity: 40 }] }), "ship Helium-3");
    mutateAccountState(c.account.id, (s) => { for (const sh of s.corp.shipments || []) sh.arrivesAt = Date.now() - 1; }, { sanitize: false, settleMining: false });
    shipmentTick();
    expect(c.held("frost-relay-depot")["Helium-3"]).toBe(40);

    // fusion-fuel-chain: refused without Fusion Fuel Cycle, taking nothing; with it, 40 Helium-3 + 80 Deuterium make 40 Fusion Pellets.
    const before = c.held("frost-relay-depot");
    const refused = await c.refine({ chainId: "fusion-fuel-chain", batches: 1 });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/Fusion Fuel Cycle/);
    expect(c.held("frost-relay-depot")).toEqual(before);
    mutateAccountState(c.account.id, (s) => { s.corp.unlockedTech.push("tt-fusion-fuel-cycle"); }, { sanitize: false, settleMining: false });
    await c.ok(await c.refine({ chainId: "fusion-fuel-chain", batches: 1 }), "fusion-fuel-chain");
    c.finishRefining();
    expect(c.held("frost-relay-depot")).toMatchObject({ Deuterium: 140, "Fusion Pellets": 40 });
    expect(c.held("frost-relay-depot")["Helium-3"] || 0).toBe(0); // a spent item leaves the inventory

    // cryogenics-chain: 200 Water Ice + 200 Hydrogen make 60 Cryogenic Coolant; there are 165 Hydrogen, so one run is
    // refused naming it, and with 35 more (seeded) it runs.
    const short = await c.refine({ chainId: "cryogenics-chain", batches: 1 });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/^Not enough Hydrogen at this station/);
    mutateAccountState(c.account.id, (s) => { s.corp.inventory["frost-relay-depot"].Hydrogen += 35; }, { sanitize: false, settleMining: false });
    await c.ok(await c.refine({ chainId: "cryogenics-chain", batches: 1 }), "cryogenics-chain");
    c.finishRefining();
    expect(c.held("frost-relay-depot")).toMatchObject({ "Water Ice": 405, "Cryogenic Coolant": 60 });
    expect(c.held("frost-relay-depot").Hydrogen || 0).toBe(0);

    // Every last output sells to its standing bid, here at its base (nothing sold into it today).
    expect(await c.sellAll("Fusion Pellets", "frost-relay-depot")).toEqual({ quantity: 40, price: 198 });
    expect(await c.sellAll("Cryogenic Coolant", "frost-relay-depot")).toEqual({ quantity: 60, price: 54 });
    // And the raw items the track names have bids of their own.
    expect((await c.sellAll("Deuterium", "frost-relay-depot")).price).toBe(40);
    expect((await c.sellAll("Water Ice", "frost-relay-depot")).price).toBe(8);
  });

  it("each chain is refused without the research the design names: 400, and nothing taken", async () => {
    const c = await corporation();
    mutateAccountState(c.account.id, (s) => {
      s.corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: false, chainId: null, totalInputConsumed: 0, totalOutputProduced: 0 }];
      s.corp.inventory = { "luna-gateway": { "Helium-3": 500, Deuterium: 500, "Water Ice": 500, Hydrogen: 500 } };
      s.corp.unlockedTech = s.corp.unlockedTech.filter((t) => !["tt-containment-physics", "tt-exotic-energy-routing"].includes(t));
    }, { sanitize: false, settleMining: false });
    for (const [chainId, body, research] of [
      ["he3-chain", { inputQuantity: 100 }, /Containment Physics I/],
      ["fusion-fuel-chain", { batches: 1 }, /Fusion Fuel Cycle/],
      ["cryogenics-chain", { batches: 1 }, /Containment Physics I/]
    ]) {
      const res = await c.refine({ chainId, ...body });
      expect(res.status, chainId).toBe(400);
      expect(res.body.error, chainId).toMatch(research);
      expect(c.held("luna-gateway"), chainId).toEqual({ "Helium-3": 500, Deuterium: 500, "Water Ice": 500, Hydrogen: 500 });
    }
  });
});
