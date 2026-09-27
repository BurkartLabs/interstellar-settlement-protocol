import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ISP-189 (AB#883): every Tier 4 recipe in docs/design/v0.11-tier4.md (section 3) is a chain in data/refinery-chains.json
// with its inputs, outputs, cycle, facility and research, value for value; the Synthesis Array is in the building
// catalogue, gated as section 4 says; and every id a chain names resolves in its own catalogue (T-019).
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const DESIGN = fs.readFileSync(new URL("../../docs/design/v0.11-tier4.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const CHAINS = read("refinery-chains.json").chains;
const ITEMS = new Set(read("items.json").items.map((i) => i.name));
const RESEARCH = new Map(read("research.json").nodes.map((n) => [n.id, n]));
const BUILDINGS = read("player-buildings.json").buildings;

/** "Exotic Matter 5 + Fusion Pellets 20" as [{ item, quantityPerCycle }]. */
const parts = (text) => text.split(" + ").map((p) => { const m = p.trim().match(/^(.+?) (\d+)$/); return { item: m[1], quantityPerCycle: Number(m[2]) }; });
// | `antimatter-chain` | 2 | Exotic Matter 5 + Fusion Pellets 20 | Antimatter 2 | 24 h | `tt-antimatter-confinement` | Fuel + exotic |
const ROWS = [...DESIGN.matchAll(/^\| `([a-z-]+-chain)` \| (\d) \| ([^|]+) \| ([^|]+) \| (\d+) h \| `([a-z-]+)` \| [^|]+ \|$/gm)]
  .map(([, id, stage, inputs, outputs, hours, tech]) => ({ id, stage: Number(stage), inputs: parts(inputs), outputs: parts(outputs), hours: Number(hours), tech }));

describe("the Tier 4 chains hold the design's recipes (AB#883)", () => {
  it("reads all six from the design", () => {
    expect(ROWS.map((r) => r.id)).toEqual(["antimatter-chain", "superconductor-chain", "field-emitter-chain", "breeder-core-chain", "antimatter-drive-chain", "catalyst-bed-chain"]);
  });

  it.each(ROWS.map((r) => [r.id, r]))("%s: inputs, outputs, cycle, stage, facility and research as the design has them", (id, row) => {
    const chain = CHAINS.find((c) => c.id === id);
    expect(chain, id).toBeDefined();
    expect(chain.inputs).toEqual(row.inputs);
    expect(chain.outputs).toEqual(row.outputs);
    expect(chain.cycleDurationHours).toBe(row.hours);
    expect(chain.stage).toBe(row.stage);
    expect(chain.building).toBe("synthesis-array");
    // Each needs its own node and v0.8's cross-track node, which the Synthesis Array's gate requires too (section 3).
    expect(chain.requiresTechIds).toEqual(["tt-integrated-manufacturing", row.tech]);
    expect(chain.requiresResearch).toEqual(chain.requiresTechIds.map((t) => RESEARCH.get(t)?.name));
  });

  it("names only items the catalogue has, and research that exists (T-019)", () => {
    for (const chain of CHAINS.filter((c) => c.building === "synthesis-array")) {
      for (const { item } of [...chain.inputs, ...chain.outputs]) expect(ITEMS.has(item), `${chain.id}: ${item}`).toBe(true);
      for (const t of chain.requiresTechIds) expect(RESEARCH.has(t), `${chain.id}: ${t}`).toBe(true);
    }
  });

  it("leaves every chain from before Tier 4 in a Refinery, and names no building but these two", () => {
    for (const chain of CHAINS) expect(["refinery", "synthesis-array"]).toContain(chain.building || "refinery");
    expect(CHAINS.filter((c) => c.building === "synthesis-array")).toHaveLength(ROWS.length);
    expect(CHAINS.filter((c) => !c.building).every((c) => c.category !== "Tier 4 Synthesis")).toBe(true);
  });
});

describe("the Synthesis Array (AB#883)", () => {
  it("is one per corporation, behind High-Energy Synthesis and Integrated Manufacturing, as section 4 has it", () => {
    const array = BUILDINGS.find((b) => b.id === "synthesis-array");
    expect(array).toMatchObject({ name: "Synthesis Array", slot: "corporation", cap: { perCorporation: 1 }, tiers: "none" });
    expect(array.researchGates).toEqual(["tt-high-energy-synthesis", "tt-integrated-manufacturing"]);
    expect(RESEARCH.get("tt-high-energy-synthesis").prereqs).toContain("tt-integrated-manufacturing");
    expect(DESIGN).toMatch(/`tt-high-energy-synthesis` \| High-Energy Synthesis .* \| the Synthesis Array \(AB#883\) \|/);
  });
});
