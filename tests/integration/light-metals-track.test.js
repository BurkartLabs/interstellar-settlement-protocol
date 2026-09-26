import { describe, it, expect, afterEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, applyRefineryOperations } from "../../server/gameState.js";
import { miningTick, processRndCompletions } from "../../server/ticks.js";
import { REFINERY_CHAINS_DATA } from "../../server/game/catalog.js";
import { ECONOMY, npcBidFor } from "../../server/economy.js";
import { refineMinimum } from "../../public/scripts/refineQuantity.js";

// ISP-139 (AB#833): the Light Metals track (docs/design/tier3-recipes.md) through the routes. A corporation leases Luna,
// whose extraction now yields Bauxite, mines it on the server's tick, researches Light-Metal Electrolysis, runs every
// chain in the track to its last output and sells what comes out to the NPC bids.
//
// Fixtures, and why: the corporation is placed at Luna Gateway with an office there (as purchase-lease.test.js does),
// holds the tier-1 research, Material Compression (the gate's prerequisite) and Nano-Lattice Weaving (a Refinery's),
// and is handed the Lithium and Cobalt that the Aluminium-Lithium and Battery chains take. Those two come from belt
// expeditions, which this track does not change. Everything the track adds (the Bauxite, the research, the three chains and the bids) goes through routes.

afterEach(() => vi.restoreAllMocks());

const STATION = "luna-gateway";
const TECH = "tt-light-metal-electrolysis";
const LIGHT = REFINERY_CHAINS_DATA.chains.filter((c) => c.requiresTechIds.includes(TECH));
const HOUR = 3_600_000;

async function lightCorp() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const { RESEARCH_LIBRARY } = await import("../../server/gameState.js");
  const tier1 = Object.values(RESEARCH_LIBRARY).filter((t) => t.tier === 1).map((t) => t.id);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.finances.credits = 2_000_000;
    corp.currentStationId = STATION;
    corp.currentSystemId = "sol";
    corp.travel = null;
    corp.offices = [{ stationId: STATION, rentedAt: Date.now(), rentedUntil: Date.now() + 7 * 86_400_000 }];
    corp.unlockedTech = [...tier1, "tt-energy-routing", "tt-material-compression", "tt-nano-lattice"];
  });
  const api = authed(app, accessToken);
  const play = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
  const sell = (item, quantity) => api.post(`/api/market/npc-orders/npc-buy-${item.toLowerCase().replace(/\s+/g, "-")}-daily/sell`).send({ quantity });
  const corp = () => getAccountById(account.id).state.corp;
  const held = () => ({ ...(corp().inventory?.[STATION] || {}) });
  const give = (items) => mutateAccountState(account.id, (s) => {
    const inv = (s.corp.inventory[STATION] ||= {});
    for (const [item, n] of Object.entries(items)) inv[item] = (inv[item] || 0) + n;
  });
  /** The server's refinery tick, a year on: every running cycle has ended. */
  const finish = () => mutateAccountState(account.id, (s) => applyRefineryOperations(s.corp, Date.now() + 365 * 24 * HOUR));
  return { id: account.id, play, sell, corp, held, give, finish };
}

describe("the Light Metals track in data (AB#833)", () => {
  it("is three chains behind one research node, every output with a standing NPC bid", () => {
    expect(LIGHT.map((c) => c.id)).toEqual(["aluminium-chain", "al-li-chain", "battery-chain"]);
    const bids = new Set(ECONOMY.npcBuyers.map((b) => b.item));
    for (const c of LIGHT) for (const o of c.outputs) expect(bids.has(o.item), o.item).toBe(true);
    for (const raw of ["Bauxite", "Lithium"]) expect(bids.has(raw), raw).toBe(true);
  });
});

describe("a corporation runs the Light Metals track through the routes (AB#833)", () => {
  it("leases Luna, mines Bauxite, is refused every chain until it researches, then refines to the last outputs and sells them", async () => {
    const c = await lightCorp();

    // 1. The source body: a lease on Luna, a yard, a day's cycle settled by the server's mining tick.
    expect((await c.play("hire", { count: 20 })).status).toBe(200);
    const leased = await c.play("purchase-lease", { body: "luna" });
    expect(leased.status, JSON.stringify(leased.body.error)).toBe(200);
    const leaseId = c.corp().miningLeases[0].id;
    expect((await c.play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
    const extractorId = c.corp().mining.silicateExtractors[0].id;
    const mining = await c.play(`lease/${leaseId}/start-mining`, { amount: 1000, hours: 24, extractorId });
    expect(mining.status, JSON.stringify(mining.body.error)).toBe(200);
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime
    mutateAccountState(c.id, (s) => {
      const ex = s.corp.mining.silicateExtractors[0];
      for (const k of ["startedAt", "lastTickAt", "endsAt"]) ex[k] -= 24 * HOUR;
    }, { settleMining: false });
    miningTick();
    const ex = c.corp().mining.silicateExtractors[0];
    const mined = ex.minedByItem;
    expect(Object.keys(mined).sort()).toEqual(["Bauxite", "Helium-3", "Silicates"]); // AB#830's Helium-3 too
    expect(mined.Bauxite / Object.values(mined).reduce((s, n) => s + n, 0)).toBeCloseTo(0.15, 2);
    const bauxite = c.held().Bauxite;
    expect(bauxite).toBe(mined.Bauxite);
    expect(bauxite).toBeGreaterThanOrEqual(400);

    // 2. A Refinery, and every chain in the track refused without the research, changing nothing.
    const built = await c.play("build", { buildingId: "refinery" });
    expect(built.status, JSON.stringify(built.body.error)).toBe(200);
    const refineryId = c.corp().refineries[0].id;
    c.give({ Lithium: 100, Cobalt: 20, "Aluminium Ingots": 40 });
    for (const chain of LIGHT) {
      const body = chain.inputs.length === 1 ? { inputQuantity: refineMinimum(chain.inputs[0].quantityPerCycle) } : { batches: 1 };
      const before = JSON.stringify(c.corp());
      const res = await c.play("start-refinery", { refineryId, chainId: chain.id, ...body });
      expect(res.status, chain.id).toBe(400);
      expect(res.body.error, chain.id).toBe("This chain requires: Light-Metal Electrolysis.");
      expect(JSON.stringify(c.corp()), chain.id).toBe(before);
    }
    mutateAccountState(c.id, (s) => { s.corp.inventory[STATION]["Aluminium Ingots"] -= 40; if (!s.corp.inventory[STATION]["Aluminium Ingots"]) delete s.corp.inventory[STATION]["Aluminium Ingots"]; });

    // 3. The research, queued through the route and completed by the server's R&D tick.
    const credits = c.corp().finances.credits;
    const queued = await c.play("queue-rnd", { techId: TECH });
    expect(queued.status, JSON.stringify(queued.body.error)).toBe(200);
    expect(c.corp().finances.credits).toBe(credits - 8000);
    mutateAccountState(c.id, (s) => {
      for (const q of s.queues.corporateRnD) for (const k of ["startedAt", "endsAt", "queuedAt"]) if (q[k]) q[k] -= 11 * HOUR;
    }, { settleMining: false });
    processRndCompletions();
    expect(c.corp().unlockedTech).toContain(TECH);

    // 4. Bauxite to Aluminium Ingots: two cycles (400 Bauxite, 10 hours) for 100 ingots.
    const run = async (chainId, body) => {
      const res = await c.play("start-refinery", { refineryId, chainId, ...body });
      expect(res.status, `${chainId}: ${JSON.stringify(res.body.error)}`).toBe(200);
      c.finish();
    };
    await run("aluminium-chain", { inputQuantity: 400 });
    expect(c.held()).toMatchObject({ Bauxite: bauxite - 400, "Aluminium Ingots": 100 });

    // 5. Ingots and Lithium to Aluminium-Lithium Alloy (stage 2); Lithium and Cobalt to Battery Cells.
    await run("al-li-chain", { batches: 2 });
    expect(c.held()).toMatchObject({ "Aluminium Ingots": 20, Lithium: 60, "Aluminium-Lithium Alloy": 80 });
    await run("battery-chain", { batches: 2 });
    expect(c.held()["Battery Cells"]).toBe(60);
    expect(c.held().Lithium).toBeUndefined();
    expect(c.held().Cobalt).toBeUndefined();

    // 6. Every output sold to its NPC bid, at the price the server's bid rule gives for today's volume.
    for (const [item, qty] of [["Aluminium Ingots", 20], ["Aluminium-Lithium Alloy", 80], ["Battery Cells", 60], ["Bauxite", 100]]) {
      const seed = ECONOMY.npcBuyers.find((b) => b.item === item);
      const before = c.corp().finances.credits;
      const res = await c.sell(item, qty);
      expect(res.status, `${item}: ${JSON.stringify(res.body.error)}`).toBe(200);
      expect(res.body.traded.unitPrice, item).toBe(npcBidFor(seed.unitPrice, 0));
      expect(res.body.traded.total, item).toBe(seed.unitPrice * qty);
      expect(c.corp().finances.credits, item).toBeGreaterThan(before);
    }
    expect(c.held()["Aluminium-Lithium Alloy"]).toBeUndefined();
    expect(c.held()["Battery Cells"]).toBeUndefined();
  });
});
