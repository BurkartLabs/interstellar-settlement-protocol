import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { applyRefineryOperations } from "../../server/game/refining.js";

// ISP-189 (AB#883): the Synthesis Array is built through the authenticated build route, refused with nothing debited
// without its research or a free slot, and runs the Tier 4 chains, and only those; one chain runs from raw input to a
// Tier 4 product, with time injected by settling the facilities at their runs' end.
const ESP = "earth-station-prime";
const GATES = ["tt-integrated-manufacturing", "tt-high-energy-synthesis"];

async function corporation({ tech = GATES, slots = 6, buildings = [] } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const raw = accountsStore.accounts[account.id];
  Object.assign(raw.state.corp, { unlockedTech: [...tech], buildingSlots: slots, buildings: [...buildings], currentStationId: ESP });
  raw.state.corp.finances.credits = 2_000_000;
  const api = authed(app, accessToken);
  return {
    id: account.id, raw, api, corp: () => raw.state.corp,
    build: (buildingId) => api.post(`/api/accounts/${account.id}/gameplay/build`).send({ buildingId }),
    start: (body) => api.post(`/api/accounts/${account.id}/gameplay/start-refinery`).send(body)
  };
}

/** What a refusal must leave untouched: the balance and what has been booked against it. */
const money = (c) => { const f = c.corp().finances; return JSON.stringify([f.credits, f.expensesByCategory, f.lifetimeCosts]); };

/** Settle every facility just after its run ends: injected time. */
function finishRuns(c) {
  const corp = c.corp();
  const ends = [...(corp.refineries || []), ...(corp.synthesisArrays || [])].map((f) => Number(f.endsAt) || 0);
  applyRefineryOperations(corp, Math.max(...ends, Date.now()) + 1);
}

describe("building the Synthesis Array (AB#883)", () => {
  it("is built through the authenticated route, at its catalogue price, as the corporation's one Array", async () => {
    const c = await corporation();
    const before = c.corp().finances.credits;
    const res = await c.build("synthesis-array");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.receipt.title).toBe("Synthesis Array Commissioned");
    expect(c.corp().finances.credits).toBe(before - 200_000);
    expect(c.corp().synthesisArrays).toEqual([expect.objectContaining({ id: "syn-1", name: "Synthesis Array", active: false })]);
    expect(c.corp().refineries).toEqual([]); // it is not a refinery
    const again = await c.build("synthesis-array");
    expect(again.status).toBe(400); // one per corporation
    expect(c.corp().finances.credits).toBe(before - 200_000);
  });

  it("is refused, with nothing debited, without its research", async () => {
    const c = await corporation({ tech: ["tt-integrated-manufacturing"] });
    const before = money(c);
    const res = await c.build("synthesis-array");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/High-Energy Synthesis|research/i);
    expect(money(c)).toBe(before);
    expect(c.corp().synthesisArrays || []).toEqual([]);
  });

  it("is refused, with nothing debited, without a free building slot", async () => {
    const c = await corporation({ slots: 1, buildings: [{ name: "Assembly Facility", id: "bld-1" }] });
    const before = money(c);
    const res = await c.build("synthesis-array");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slot/i);
    expect(money(c)).toBe(before);
  });
});

describe("running Tier 4 chains (AB#883)", () => {
  it("runs one chain from raw input to a Tier 4 product: Helium-3 and Deuterium to Fusion Pellets, then Antimatter", async () => {
    const c = await corporation({ tech: [...GATES, "tt-fusion-fuel-cycle", "tt-material-compression", "tt-nano-lattice", "tt-exotic-containment", "tt-antimatter-confinement"] });
    expect((await c.build("refinery")).status).toBe(200);
    expect((await c.build("synthesis-array")).status).toBe(200);
    c.corp().inventory = { ...(c.corp().inventory || {}), [ESP]: { "Helium-3": 40, Deuterium: 80, "Exotic Matter": 5 } };

    // Stage 1, in the Refinery: raw Helium-3 and Deuterium to Fusion Pellets.
    const pellets = await c.start({ chainId: "fusion-fuel-chain", batches: 1, refineryId: "ref-1" });
    expect(pellets.status, JSON.stringify(pellets.body)).toBe(200);
    finishRuns(c);
    expect(c.corp().inventory[ESP]["Fusion Pellets"]).toBe(40);

    // Tier 4, in the Synthesis Array: Exotic Matter 5 + Fusion Pellets 20 to Antimatter 2, in 24 hours.
    const antimatter = await c.start({ chainId: "antimatter-chain", batches: 1, refineryId: "syn-1" });
    expect(antimatter.status, JSON.stringify(antimatter.body)).toBe(200);
    const array = c.corp().synthesisArrays[0];
    expect(array).toMatchObject({ active: true, chainId: "antimatter-chain" });
    expect(array.endsAt - array.startedAt).toBe(24 * 60 * 60 * 1000);
    expect(c.corp().inventory[ESP]).toMatchObject({ "Fusion Pellets": 20 });
    expect(c.corp().inventory[ESP]["Exotic Matter"] ?? 0).toBe(0);
    finishRuns(c);
    expect(c.corp().inventory[ESP].Antimatter).toBe(2);
    expect(c.corp().synthesisArrays[0]).toMatchObject({ active: false, chainId: null, cyclesCompleted: 1 });
  });

  it("refuses a Tier 4 chain without an Array, and each kind of chain in the other kind of facility, moving nothing", async () => {
    const c = await corporation({ tech: [...GATES, "tt-fusion-fuel-cycle", "tt-material-compression", "tt-nano-lattice", "tt-exotic-containment", "tt-antimatter-confinement"] });
    expect((await c.build("refinery")).status).toBe(200);
    c.corp().inventory = { ...(c.corp().inventory || {}), [ESP]: { "Helium-3": 40, Deuterium: 80, "Exotic Matter": 5, "Fusion Pellets": 20 } };
    const stock = () => JSON.stringify(c.corp().inventory[ESP]);
    const before = stock();
    const none = await c.start({ chainId: "antimatter-chain", batches: 1, refineryId: "ref-1" });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/Tier 4 chains run in a Synthesis Array/);
    expect(stock()).toBe(before);

    expect((await c.build("synthesis-array")).status).toBe(200);
    const refineryChain = await c.start({ chainId: "fusion-fuel-chain", batches: 1, refineryId: "syn-1" });
    expect(refineryChain.status).toBe(400);
    expect(refineryChain.body.error).toBe("This chain runs in a Refinery, not the Synthesis Array.");
    expect(stock()).toBe(before);
    expect(c.corp().synthesisArrays[0].active).toBe(false);
    const tier4InRefinery = await c.start({ chainId: "antimatter-chain", batches: 1, refineryId: "ref-1" });
    expect(tier4InRefinery.body.error).toBe("This is a Tier 4 chain: it runs in the Synthesis Array, not a Refinery.");
    expect(stock()).toBe(before);
    expect(c.corp().refineries[0].active).toBe(false);
  });

  it("refuses a Tier 4 chain whose own research is missing, even with an Array", async () => {
    const c = await corporation({ tech: [...GATES, "tt-exotic-containment"] }); // no Antimatter Confinement
    expect((await c.build("synthesis-array")).status).toBe(200);
    c.corp().inventory = { ...(c.corp().inventory || {}), [ESP]: { "Exotic Matter": 5, "Fusion Pellets": 20 } };
    const res = await c.start({ chainId: "antimatter-chain", batches: 1, refineryId: "syn-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Antimatter Confinement/);
    expect(c.corp().inventory[ESP]).toEqual({ "Exotic Matter": 5, "Fusion Pellets": 20 });
  });
});
