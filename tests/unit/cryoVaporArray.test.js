import { describe, it, expect, afterEach, vi } from "vitest";
import { applyMiningOperations } from "../../server/gameState.js";
import { resolveMetric } from "../../server/game/progression.js";
import { ECONOMY } from "../../server/economy.js";
import { playerBuilding } from "../../server/playerBuildings.js";
import { construct } from "../../server/construction.js";
import { leaseSlotsUsed } from "../../public/scripts/leaseSlots.js";
import { miningEfficiency } from "../../public/scripts/miningEfficiency.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// ISP-98 (AB#788): the Cryo-vapor Extractor Array, built on a Luna lease like an extractor (a lease slot and a
// corporation slot), one per Luna lease. Its effect is the design's fallback (docs/design/buildings.md, v0.6-01):
// that lease's extractors mine 1.2 times, since Helium-3 extraction is v0.8's (DEVELOPMENT_PHASES.md, AB#830).

const ARRAY = playerBuilding("cryo-vapor-extractor-array");
const YARD = playerBuilding("basic-extractor-yard");
const MULTIPLIER = ECONOMY.buildings.cryoVaporExtractorArrayMiningMultiplier;
const lease = (id, body, extractorIds = []) => ({ id, body, leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds });
const corp = (over = {}) => ({ unlockedTech: ["tt-containment-physics"], buildingSlots: 6, buildings: [], finances: { credits: 1_000_000, assets: 0 }, miningLeases: [lease("lease-luna", "Luna"), lease("lease-earth", "Earth")], ...over });

afterEach(() => vi.restoreAllMocks());

describe("the Cryo-vapor Extractor Array (ISP-98)", () => {
  it("is the catalogue's, on a Luna lease only, at the design's price, gate and cap", () => {
    expect(ARRAY).toMatchObject({ name: "Cryo-vapor Extractor Array", slot: "corporation+lease", lease: "luna", researchGates: ["tt-containment-physics"], cap: { perLease: 1 }, cost: 80_000, assetValue: 58_000 });
    expect(MULTIPLIER).toBe(1.2);
  });

  it("is built on a Luna lease: a corporation slot, a slot on that lease, and its price", () => {
    const c = corp();
    expect(construct(c, ARRAY, "lease-luna")).toMatchObject({ outcome: "ok", cost: 80_000, assetValue: 58_000 });
    expect(c.buildings.map((b) => b.name)).toEqual(["Cryo-vapor Extractor Array"]);
    expect(c.miningLeases[0].facilities).toEqual(["Cryo-vapor Extractor Array"]);
    expect(leaseSlotsUsed(c.miningLeases[0])).toBe(1);
    expect(c.finances).toMatchObject({ credits: 920_000, assets: 58_000 });
  });

  it("refuses, changing nothing: another body's lease, a second on one lease, a full lease, no research", () => {
    const withArray = corp();
    construct(withArray, ARRAY, "lease-luna");
    for (const [c, leaseId, outcome] of [
      [corp(), "lease-earth", "wrong-lease"],
      [withArray, "lease-luna", "lease-at-cap"],
      [corp({ miningLeases: [lease("lease-luna", "Luna", ["ext-1", "ext-2"])] }), "lease-luna", "lease-slots-full"],
      [corp({ unlockedTech: [] }), "lease-luna", "missing-research"],
      [corp(), null, "no-lease-named"]
    ]) {
      const before = JSON.stringify(c);
      expect(construct(c, ARRAY, leaseId).outcome).toBe(outcome);
      expect(JSON.stringify(c)).toBe(before);
    }
  });

  it("takes a lease slot a yard would have had", () => {
    const c = corp({ miningLeases: [lease("lease-luna", "Luna", ["ext-1"])] });
    expect(construct(c, ARRAY, "lease-luna").outcome).toBe("ok");
    expect(construct(c, YARD, "lease-luna").outcome).toBe("lease-slots-full");
  });

  it("multiplies the mining efficiency of its lease's extractors only", () => {
    const c = corp({ unlockedTech: ["tt-containment-physics", "tt-basic-extraction"] });
    construct(c, ARRAY, "lease-luna");
    expect(miningEfficiency(c, c.miningLeases[0], ECONOMY.buildings)).toBeCloseTo(1.1 * 1.2, 10);
    expect(miningEfficiency(c, c.miningLeases[1], ECONOMY.buildings)).toBeCloseTo(1.1, 10);
    expect(miningEfficiency(c, undefined, ECONOMY.buildings)).toBeCloseTo(1.1, 10);
  });

  it("the mining tick: an hour on its Luna lease mines 1.2 times what the same yard mines on Earth", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime
    const start = 1_700_000_000_000;
    const running = (id, leaseId) => makeExtractor({ id, leaseId, startedAt: start, lastTickAt: start, endsAt: start + 2 * 3_600_000, throughputPerHour: 100, operationCostPerHour: 0 });
    const c = makeCorp({
      miningLeases: [{ ...lease("lease-luna", "Luna", ["ext-luna"]), facilities: ["Cryo-vapor Extractor Array"] }, lease("lease-earth", "Earth", ["ext-earth"])],
      mining: { silicateExtractors: [running("ext-luna", "lease-luna"), running("ext-earth", "lease-earth")] }
    });
    applyMiningOperations(c, start + 3_600_000);
    expect(c.inventory["earth-station-prime"].Silicates).toBe(100);
    // AB#830, AB#833: Luna yields Silicates 60, Helium-3 25, Bauxite 15; the array multiplies the whole yield.
    expect(c.inventory["luna-gateway"]).toEqual({ Silicates: 72, "Helium-3": 30, Bauxite: 18 });
  });

  it("the ladder's building: metric resolves to 1 once it is built", () => {
    const c = corp();
    expect(resolveMetric("building:Cryo-vapor Extractor Array", c)).toBe(0);
    construct(c, ARRAY, "lease-luna");
    expect(resolveMetric("building:Cryo-vapor Extractor Array", c)).toBe(1);
  });
});
