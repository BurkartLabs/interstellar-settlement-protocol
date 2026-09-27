import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, applyMiningOperations, applyAsteroidExpeditions } from "../../server/gameState.js";
import { REFINERY_CHAINS, RESEARCH_LIBRARY } from "../../server/game/catalog.js";
import { ITEM_RESEARCH_GATES, canRecover, chainResearchMissing } from "../../server/game/researchGates.js";
import { catalogueRefusal } from "../../server/playerBuildings.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// ISP-186 (AB#880): docs/design/v0.11-tier4.md section 5's six research nodes, in data/research.json (the file the
// server reads), each tested as a gate: the action it opens is refused before the node and allowed after
// (P-INERT-FEATURE). Four gate an item's recovery; one the Synthesis Array; one the antimatter chains.
const DOC = readFileSync(new URL("../../docs/design/v0.11-tier4.md", import.meta.url), "utf8");
const RESEARCH = JSON.parse(readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes;
const section5 = DOC.split(/^## /m).find((s) => s.startsWith("5."));
const DESIGNED = section5.split("\n").filter((l) => /^\| `tt-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
  .map(([id, name, tier, needs, cost, hours]) => ({ id: id.replace(/`/g, ""), name, tier: Number(tier), prereqs: needs.match(/`[^`]+`/g).map((s) => s.replace(/`/g, "")), costCredits: Number(cost.replace(/,/g, "")), durationHours: Number(hours) }));

const START = 1_700_000_000_000;
const MIN = 60_000;
afterEach(() => vi.restoreAllMocks());

describe("ISP-186 the Tier 4 research nodes are in the catalog the server reads", () => {
  it("has the design's six nodes, with its names, tiers, prerequisites, costs and hours, and the server's list agrees", () => {
    expect(DESIGNED).toHaveLength(6);
    for (const d of DESIGNED) {
      expect(RESEARCH.find((n) => n.id === d.id), d.id).toMatchObject({ name: d.name, tier: d.tier, prereqs: d.prereqs, costCredits: d.costCredits, durationHours: d.durationHours });
      expect(RESEARCH_LIBRARY[d.id], d.id).toMatchObject({ name: d.name, prereqs: d.prereqs });
    }
  });

  it("every prerequisite exists, and the whole tree has no cycle", () => {
    const byId = new Map(RESEARCH.map((n) => [n.id, n]));
    for (const n of RESEARCH) for (const p of n.prereqs) expect(byId.has(p), `${n.id} needs ${p}`).toBe(true);
    const state = new Map(); // 1 visiting, 2 done
    const visit = (id, path) => {
      if (state.get(id) === 2) return;
      expect(state.get(id), `cycle: ${[...path, id].join(" -> ")}`).not.toBe(1);
      state.set(id, 1);
      for (const p of byId.get(id).prereqs) visit(p, [...path, id]);
      state.set(id, 2);
    };
    for (const n of RESEARCH) visit(n.id, []);
  });

  it("the four extraction nodes each gate the item the design names, and nothing else is gated", () => {
    expect(ITEM_RESEARCH_GATES).toEqual({
      Uranium: "tt-actinide-handling", "Exotic Matter": "tt-exotic-containment",
      "Platinum-Group Metals": "tt-deep-core-extraction", "Metallic Hydrogen": "tt-deep-atmosphere-extraction"
    });
    expect(canRecover({ unlockedTech: [] }, "Silicates")).toBe(true);
  });
});

/** One expedition on a belt that is all `item`, settled half-way, for a corporation with `research`. */
function expeditionYield(item, research) {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const key = "epsilon-eridani:ee-crown";
  const corp = makeCorp({
    currentStationId: "earth-station-prime", unlockedTech: research, inventory: {},
    asteroidMining: { probeCount: 0, maxProbes: 2, completedExpeditions: [], activeExpeditions: [{ id: "exp-t4", status: "active", beltKey: key,
      systemId: "epsilon-eridani", generation: 1, duration: "standard", deployedAt: START, lastTickAt: START, completesAt: START + 120 * MIN, yields: {} }] }
  });
  const world = { belts: { [key]: { key, generation: 1, rarity: "exotic", composition: { [item]: 100 }, reserve: 1e6, remaining: 1e6 } } };
  applyAsteroidExpeditions(corp, START + 60 * MIN, world);
  return { got: corp.asteroidMining.activeExpeditions[0].yields[item] || 0, dug: 1e6 - world.belts[key].remaining };
}

describe("ISP-186 an extraction node gates its item on expeditions", () => {
  for (const [item, node] of [["Uranium", "tt-actinide-handling"], ["Exotic Matter", "tt-exotic-containment"],
    ["Platinum-Group Metals", "tt-deep-core-extraction"], ["Metallic Hydrogen", "tt-deep-atmosphere-extraction"]]) {
    it(`${item}: dug but not recovered without ${node}, recovered with it`, () => {
      const without = expeditionYield(item, []);
      expect(without.dug).toBeGreaterThan(0);
      expect(without.got).toBe(0);
      const withIt = expeditionYield(item, [node]);
      expect(withIt.got).toBe(withIt.dug);
    });
  }
});

describe("ISP-186 an extraction node gates its item on extractors", () => {
  // The Crown Belt's profile carries both Uranium and Exotic Matter today (data/systems.json).
  const yard = (research) => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdown
    const corp = makeCorp({ currentStationId: "earth-station-prime", unlockedTech: research, miningLeases: [{ id: "lease-1", body: "Crown Belt" }],
      mining: { silicateExtractors: [makeExtractor({ startedAt: START, lastTickAt: START, endsAt: START + 600 * MIN, throughputPerHour: 600, operationCostPerHour: 0, leaseId: "lease-1" })] } });
    applyMiningOperations(corp, START + 600 * MIN);
    return Object.values(corp.inventory).reduce((sum, inv) => ({ ...sum, ...inv }), {});
  };
  it("Uranium and Exotic Matter are left behind without their nodes, and deposited with them; the rest either way", () => {
    const without = yard([]);
    expect(without.Uranium).toBeUndefined();
    expect(without["Exotic Matter"]).toBeUndefined();
    expect(without["Rare Earths"]).toBeGreaterThan(0);
    const withIt = yard(["tt-actinide-handling", "tt-exotic-containment"]);
    expect(withIt.Uranium).toBeGreaterThan(0);
    expect(withIt["Exotic Matter"]).toBeGreaterThan(0);
    expect(withIt["Rare Earths"]).toBe(without["Rare Earths"]);
  });

  it("nothing a corporation already holds is taken back", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const corp = makeCorp({ currentStationId: "earth-station-prime", unlockedTech: [], inventory: { "earth-station-prime": { Uranium: 40, "Exotic Matter": 3 } },
      miningLeases: [{ id: "lease-1", body: "Crown Belt" }],
      mining: { silicateExtractors: [makeExtractor({ startedAt: START, lastTickAt: START, endsAt: START + 60 * MIN, throughputPerHour: 600, operationCostPerHour: 0, leaseId: "lease-1" })] } });
    applyMiningOperations(corp, START + 60 * MIN);
    expect(corp.inventory["earth-station-prime"]).toMatchObject({ Uranium: 40, "Exotic Matter": 3 });
  });
});

describe("ISP-186 High-Energy Synthesis gates the building that names it", () => {
  // The Synthesis Array itself is AB#883's; the build routes ask catalogueRefusal of every building in the catalogue.
  const array = { id: "synthesis-array", name: "Synthesis Array", researchGates: ["tt-high-energy-synthesis"], cap: { perCorporation: 1 } };
  it("refuses it without the node, and allows it with", () => {
    expect(catalogueRefusal(array, { unlockedTech: ["tt-integrated-manufacturing"], buildings: [] })).toBe("missing-research");
    expect(catalogueRefusal(array, { unlockedTech: ["tt-high-energy-synthesis"], buildings: [] })).toBeNull();
  });
});

describe("ISP-186 Antimatter Confinement gates the chains that name it", () => {
  // The antimatter chains are AB#883's, and the start route takes only chain ids in the data, so a fixture chain is
  // put to the route's own check (chainResearchMissing), and a real chain shows the route still asks it.
  it("a chain naming it is refused without the node, and passes with it", () => {
    const antimatter = { id: "antimatter-chain", requiresTechIds: ["tt-antimatter-confinement"] };
    expect(chainResearchMissing(antimatter, { unlockedTech: ["tt-exotic-containment", "tt-high-energy-synthesis"] })).toBe("tt-antimatter-confinement");
    expect(chainResearchMissing(antimatter, { unlockedTech: ["tt-antimatter-confinement"] })).toBeNull();
  });

  it("the start route refuses a real chain by that check, changing nothing", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    mutateAccountState(account.id, (s) => {
      s.corp.currentStationId = "earth-station-prime";
      s.corp.unlockedTech = [];
      s.corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: false, chainId: null, totalInputConsumed: 0, totalOutputProduced: 0 }];
      s.corp.inventory = { "earth-station-prime": { Silicates: 500 } };
    });
    const refused = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/start-refinery`).send({ refineryId: "ref-1", chainId: "silicates-chain", batches: 1 });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain(REFINERY_CHAINS["silicates-chain"].requiresResearch[0]);
    expect(getAccountById(account.id).state.corp.inventory["earth-station-prime"].Silicates).toBe(500);
  });
});
