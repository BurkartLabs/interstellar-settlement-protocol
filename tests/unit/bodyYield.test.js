import { describe, it, expect, afterEach, vi } from "vitest";
import { applyMiningOperations } from "../../server/gameState.js";
import { ensureCorpMiningModel, startExtractorCycle } from "../../server/game/mining.js";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";
import { bodyProfile, cycleItems, cycleItemsText, profileText } from "../../public/scripts/bodyYield.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// AB#829: the lease picker shows what each body yields, from the catalog, and the extractor row shows this cycle's
// output per item (AB#575: this cycle, not the lifetime), from the server's minedThisCycleByItem.
afterEach(() => vi.restoreAllMocks());
const START = 1_700_000_000_000;
const HOUR = 3_600_000;

describe("what a body yields, from the catalog (AB#829)", () => {
  it("names each item and its share, in the catalog's order", () => {
    expect(profileText(bodyProfile(SYSTEMS_DATA, "Earth"))).toBe("Silicates 100%");
    expect(profileText(bodyProfile(SYSTEMS_DATA, "Jupiter"))).toBe("Hydrogen 55% · Helium-3 30% · Deuterium 15%");
    expect(profileText(bodyProfile(SYSTEMS_DATA, "Venus"))).toBe("Silicates 45% · Bauxite 25% · Carbon 15% · Water Ice 15%");
    expect(profileText(bodyProfile(SYSTEMS_DATA, "Atlantis"))).toBe("Not surveyed");
  });

  it("reads the field the catalog carries, not a list of its own", () => {
    const fixture = [{ id: "x", bodies: [{ name: "Fixture Rock", resourceProfile: [{ item: "Iron Ore", concentration: 0.7 }, { item: "Bauxite", concentration: 0.3 }] }] }];
    expect(profileText(bodyProfile(fixture, "Fixture Rock"))).toBe("Iron Ore 70% · Bauxite 30%");
  });
});

describe("an extractor's output this cycle, per item (AB#829)", () => {
  function yardOn(body) {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdown
    return makeCorp({
      currentStationId: "earth-station-prime",
      miningLeases: [{ id: "lease-1", body }],
      mining: { silicateExtractors: [makeExtractor({ startedAt: START, lastTickAt: START, endsAt: START + 10 * HOUR, throughputPerHour: 600, operationCostPerHour: 0, leaseId: "lease-1" })] }
    });
  }

  it("counts each item this cycle, and a new cycle starts from nothing while the lifetime keeps", () => {
    const corp = yardOn("Venus");
    applyMiningOperations(corp, START + HOUR); // 600 units
    const ex = corp.mining.silicateExtractors[0];
    expect(cycleItems(ex).map((i) => i.item)).toEqual(["Silicates", "Bauxite", "Carbon", "Water Ice"]);
    expect(cycleItems(ex).reduce((n, i) => n + i.units, 0)).toBe(ex.minedThisCycle);
    expect(cycleItemsText(ex)).toMatch(/^Silicates 270 t · Bauxite 150 t · (Carbon|Water Ice) 90 t · (Carbon|Water Ice) 90 t$/);
    startExtractorCycle(ex, { now: START + HOUR, hours: 1, throughputPerHour: 600, operationCostPerHour: 0, startupCost: 0 });
    expect(cycleItemsText(ex)).toBe("Nothing yet");
    expect(Object.values(ex.minedByItem).reduce((a, b) => a + b, 0)).toBe(600);
  });

  it("a cycle started before per-item counts shows its output as Silicates", () => {
    const legacy = { minedThisCycle: 412 };
    expect(cycleItemsText(legacy)).toBe("Silicates 412 t");
    const corp = makeCorp({ mining: { silicateExtractors: [makeExtractor({ minedThisCycle: 412 })] } });
    ensureCorpMiningModel(corp);
    expect(corp.mining.silicateExtractors[0].minedThisCycleByItem).toEqual({ Silicates: 412 });
  });
});
