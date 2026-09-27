import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { amountsText, chainRecipe, chainTitle, consumersOf, defaultBatches, inputRows, outputRows, producersOf, startLabel } from "../../public/scripts/chainPlan.js";

// ISP-142 (AB#836): what the Refinery Chains panel shows of a chain, over the chains in data.
const CHAINS = JSON.parse(readFileSync(new URL("../../data/refinery-chains.json", import.meta.url), "utf8")).chains;
const byId = (id) => CHAINS.find((c) => c.id === id);

describe("a chain's title", () => {
  it("keeps a one-input chain's name, and names a chain of several inputs for what it makes", () => {
    expect(chainTitle(byId("silicates-chain"))).toBe("Silicates Refining");
    expect(chainTitle(byId("pressure-vessel-chain"))).toBe("Nickel-Iron Alloy Refining");
    expect(chainTitle(byId("smelting-chain"))).toBe("Nickel-Iron Alloy");
    expect(chainTitle(byId("fusion-core-chain"))).toBe("Fusion Reactor Cores");
  });
});

describe("what feeds what", () => {
  it("links an input to the chains that make it, and an output to the chains that take it", () => {
    expect(producersOf("Nickel-Iron Alloy", CHAINS)).toEqual([{ id: "smelting-chain", title: "Nickel-Iron Alloy", recipe: "Iron Ore + Nickel → Nickel-Iron Alloy" }]);
    expect(producersOf("Iron Ore", CHAINS)).toEqual([]); // mined, not made
    expect(consumersOf("Pressure Vessels", CHAINS)[0]).toEqual({ id: "fission-module-chain", title: "Compact Fission Modules", recipe: "Thorium Fuel Rods + Pressure Vessels → Compact Fission Modules" });
    expect(consumersOf("Pressure Vessels", CHAINS).map((c) => c.id)).toEqual(["fission-module-chain", "breeder-core-chain"]); // ISP-189 (AB#883): and the Tier 4 breeder
    // ISP-189 (AB#883): superconductor-chain takes them too, in the Synthesis Array (v0.11-tier4.md, section 4).
    expect(consumersOf("Rare-Earth Magnets", CHAINS).map((c) => c.id).sort()).toEqual(["fusion-core-chain", "ion-thruster-chain", "superconductor-chain"]);
    expect(consumersOf("Fusion Reactor Cores", CHAINS)).toEqual([]); // a final product
  });

  it("every chain's inputs and outputs resolve both ways over the data", () => {
    for (const c of CHAINS) {
      for (const o of c.outputs) expect(producersOf(o.item, CHAINS).map((p) => p.id), o.item).toContain(c.id);
      for (const i of c.inputs) expect(consumersOf(i.item, CHAINS).map((p) => p.id), i.item).toContain(c.id);
    }
  });
});

describe("the rows of a run", () => {
  const fusion = byId("fusion-core-chain");
  it("say what each input needs for the run, what is held, and which is short and by how much", () => {
    const rows = inputRows(fusion, 2, { "Fusion Pellets": 40, "Rare-Earth Magnets": 12, "Cryogenic Coolant": 55 }, CHAINS);
    expect(rows.map(({ item, needed, held, short, shortBy }) => ({ item, needed, held, short, shortBy }))).toEqual([
      { item: "Fusion Pellets", needed: 40, held: 40, short: false, shortBy: 0 },
      { item: "Rare-Earth Magnets", needed: 20, held: 12, short: true, shortBy: 8 },
      { item: "Cryogenic Coolant", needed: 40, held: 55, short: false, shortBy: 0 }
    ]);
    expect(rows[1].madeBy).toEqual([{ id: "magnet-chain", title: "Rare-Earth Magnets", recipe: "Rare Earths + Cobalt → Rare-Earth Magnets" }]);
    expect(chainRecipe(fusion)).toBe("Fusion Pellets + Rare-Earth Magnets + Cryogenic Coolant → Fusion Reactor Cores");
    expect(startLabel(rows)).toBe("Short: Rare-Earth Magnets");
    expect(amountsText(rows[0])).toBe("Needs 40 · holds 40");
  });

  it("start when nothing is short, and name every short input when several are", () => {
    expect(startLabel(inputRows(fusion, 1, { "Fusion Pellets": 20, "Rare-Earth Magnets": 10, "Cryogenic Coolant": 20 }, CHAINS))).toBe("Start Run");
    expect(startLabel(inputRows(fusion, 1, {}, CHAINS))).toBe("Short: Fusion Pellets, Rare-Earth Magnets, Cryogenic Coolant");
  });

  it("say what a run makes and where it goes next", () => {
    expect(outputRows(byId("smelting-chain"), 3, CHAINS)).toEqual([
      { item: "Nickel-Iron Alloy", perBatch: 80, made: 240, usedBy: [{ id: "pressure-vessel-chain", title: "Nickel-Iron Alloy Refining", recipe: "Nickel-Iron Alloy → Pressure Vessels" }] }
    ]);
  });
});

describe("the batches offered before anything is typed", () => {
  it("are as many as every input covers, at least one and at most a week", () => {
    const smelting = byId("smelting-chain"); // 150 Iron Ore + 50 Nickel, 5 h: a week is 33
    expect(defaultBatches(smelting, { "Iron Ore": 450, Nickel: 120 })).toBe(2); // Nickel covers 2
    expect(defaultBatches(smelting, {})).toBe(1);
    expect(defaultBatches(smelting, { "Iron Ore": 1e7, Nickel: 1e7 })).toBe(33);
  });
});
