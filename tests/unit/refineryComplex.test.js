import { describe, it, expect } from "vitest";
import { applyRefineryOperations, REFINERY_CHAINS } from "../../server/gameState.js";
import { resolveMetric } from "../../server/game/progression.js";
import { ECONOMY } from "../../server/economy.js";
import { playerBuilding } from "../../server/playerBuildings.js";
import { construct } from "../../server/construction.js";
import { refineryOutput } from "../../public/scripts/refineryOutput.js";
import { makeCorp } from "../fixtures/makeCorp.js";

// ISP-97 (AB#787): the Refinery Complex, an upgrade of one Refinery in place (docs/design/buildings.md, v0.6-01). It
// takes no slot; the refinery it upgrades records tier 2 and its cycles produce 1.5 times their outputs, rounded down.

const COMPLEX = playerBuilding("refinery-complex");
const MULTIPLIER = ECONOMY.buildings.refineryComplexOutputMultiplier;
const refinery = (n) => ({ id: `ref-${n}`, name: `Refinery #${n}`, tier: 1, active: false, chainId: null, startedAt: null, lastTickAt: null, endsAt: null, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0 });

/** A corporation with `count` refineries built the way the build path builds them, the research, and credits. */
function refiner(count, over = {}) {
  return {
    unlockedTech: ["tt-material-compression", "tt-nano-lattice"],
    buildingSlots: 4,
    buildings: [{ id: "bld-hq", name: "Headquarters", tier: 1, status: "Operational" }, ...Array.from({ length: count }, (_, i) => ({ id: `bld-r${i + 1}`, name: "Refinery", tier: 1, status: "Operational" }))],
    refineries: Array.from({ length: count }, (_, i) => refinery(i + 1)),
    finances: { credits: 1_000_000, assets: 0 },
    ...over
  };
}

describe("the Refinery Complex (ISP-97)", () => {
  it("is the catalogue's upgrade of a Refinery, at the design's price, gate and cap", () => {
    expect(COMPLEX).toMatchObject({ name: "Refinery Complex", slot: "upgrade", upgrades: "refinery", researchGates: ["tt-nano-lattice"], cap: { perBuilding: 1 }, cost: 100_000, assetValue: 70_000 });
    expect(MULTIPLIER).toBe(1.5);
  });

  it("a tier-2 refinery's output is 1.5 times, rounded down; a tier-1 refinery's is as it was", () => {
    expect(refineryOutput(60, 1, 1, MULTIPLIER)).toBe(60);
    expect(refineryOutput(60, 1, 2, MULTIPLIER)).toBe(90);
    expect(refineryOutput(15, 1, 2, MULTIPLIER)).toBe(22);
    expect(refineryOutput(15, 3, 2, MULTIPLIER)).toBe(67);
    expect(refineryOutput(15, 3, undefined, MULTIPLIER)).toBe(45);
  });

  it("upgrades the first Refinery not yet a complex, in place: no slot, tier 2, charged its price", () => {
    const corp = refiner(2);
    const done = construct(corp, COMPLEX, null);
    expect(done).toMatchObject({ outcome: "ok", cost: 100_000, assetValue: 70_000, refineryName: "Refinery #1" });
    expect(corp.buildings).toHaveLength(3); // no building added, no slot taken
    expect(corp.buildings[1]).toMatchObject({ name: "Refinery", tier: 2, upgrades: ["Refinery Complex"] });
    expect(corp.refineries.map((r) => r.tier)).toEqual([2, 1]);
    expect(corp.finances).toMatchObject({ credits: 900_000, assets: 70_000 });

    expect(construct(corp, COMPLEX, null)).toMatchObject({ outcome: "ok", refineryName: "Refinery #2" });
    expect(corp.refineries.map((r) => r.tier)).toEqual([2, 2]);
    const before = JSON.stringify(corp);
    expect(construct(corp, COMPLEX, null)).toEqual({ outcome: "at-cap" });
    expect(JSON.stringify(corp)).toBe(before);
  });

  it("with every corporation slot full it still upgrades, and refuses in order: research, a Refinery, the price", () => {
    expect(construct(refiner(1, { buildingSlots: 2 }), COMPLEX, null).outcome).toBe("ok");
    for (const [corp, outcome] of [
      [refiner(1, { unlockedTech: ["tt-material-compression"] }), "missing-research"],
      [refiner(0), "nothing-to-upgrade"],
      [refiner(1, { finances: { credits: 99_999, assets: 0 } }), "insufficient-credits"]
    ]) {
      const before = JSON.stringify(corp);
      expect(construct(corp, COMPLEX, null).outcome).toBe(outcome);
      expect(JSON.stringify(corp)).toBe(before);
    }
    expect(construct(refiner(1), COMPLEX, "lease-earth").outcome).toBe("not-on-lease");
  });

  it("a completed cycle on the upgraded refinery delivers 1.5 times each output, on the other as before", () => {
    const chain = Object.values(REFINERY_CHAINS).find((c) => c.outputs.some((o) => o.quantityPerCycle % 2 === 1)) || Object.values(REFINERY_CHAINS)[0];
    const start = 1_700_000_000_000;
    const running = (r, tier) => ({ ...r, tier, active: true, chainId: chain.id, stationId: "earth-station-prime", startedAt: start, lastTickAt: start, endsAt: start + 1_000, cycleScale: 1 });
    const corp = makeCorp({ refineries: [running(refinery(1), 2), running(refinery(2), 1)], inventory: {} });
    applyRefineryOperations(corp, start + 1_001);
    const held = corp.inventory["earth-station-prime"];
    for (const o of chain.outputs) expect(held[o.item], o.item).toBe(Math.floor(o.quantityPerCycle * 1.5) + o.quantityPerCycle);
    expect(corp.refineries[0].totalOutputProduced).toBe(chain.outputs.reduce((s, o) => s + Math.floor(o.quantityPerCycle * 1.5), 0));
  });

  it("the ladder's building: metric counts a complex, and the Refinery still counts as a Refinery", () => {
    const corp = refiner(1);
    expect(resolveMetric("building:Refinery Complex", corp)).toBe(0);
    construct(corp, COMPLEX, null);
    expect(resolveMetric("building:Refinery Complex", corp)).toBe(1);
    expect(resolveMetric("building:Refinery", corp)).toBe(1);
  });
});
