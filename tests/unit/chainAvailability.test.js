import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chainBlockers, splitChains } from "../../public/scripts/chainAvailability.js";

// AB#2485 (Board review 2026-09-26, item 31): "Available chains" lists only the chains a corporation can run now, and
// "Unavailable chains" the rest, each with what it is missing. Read against the real chains and buildings.
const read = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));
const CHAINS = read("data/refinery-chains.json").chains;
const BUILDINGS = read("data/player-buildings.json").buildings;
const chain = (id) => CHAINS.find((c) => c.id === id);
const ids = (list) => list.map((c) => c.id);

describe("which refinery chains a corporation can run (AB#2485)", () => {
  it("a new corporation can run none, and Silicates Refining (Aerogel) is missing only the Refinery's two researches", () => {
    const { available, unavailable } = splitChains(CHAINS, { playerBuildings: BUILDINGS });
    expect(available).toEqual([]);
    expect(unavailable).toHaveLength(CHAINS.length);
    const silicates = chainBlockers(chain("silicates-chain"), { playerBuildings: BUILDINGS });
    expect(silicates).toEqual({ available: false, research: ["tt-material-compression", "tt-nano-lattice"], building: { id: "refinery", name: "Refinery", owned: false, minLevel: 0 } });
  });

  it("with the Refinery's research done, the chains that need nothing more run: Silicates (Aerogel), Nickel and Carbon", () => {
    const ctx = { unlockedTech: ["tt-material-compression", "tt-nano-lattice"], playerBuildings: BUILDINGS };
    const { available, unavailable } = splitChains(CHAINS, ctx);
    expect(ids(available)).toEqual(["silicates-chain", "nickel-chain", "carbon-chain"]);
    expect(unavailable).toHaveLength(CHAINS.length - 3);
    expect(chainBlockers(chain("fusion-fuel-chain"), ctx).research).toEqual(["tt-fusion-fuel-cycle"]);
  });

  it("a chain whose research is done is still unavailable while its building cannot be built, and names that research", () => {
    // Carbon needs only Nano-Lattice Weaving, but a Refinery also needs Material Compression I.
    const b = chainBlockers(chain("carbon-chain"), { unlockedTech: ["tt-nano-lattice"], playerBuildings: BUILDINGS });
    expect(b.available).toBe(false);
    expect(b.research).toEqual(["tt-material-compression"]);
    // Owning a Refinery is enough, whatever research built it.
    expect(chainBlockers(chain("carbon-chain"), { unlockedTech: ["tt-nano-lattice"], refineries: [{ id: "r1" }], playerBuildings: BUILDINGS }).available).toBe(true);
  });

  it("a Tier 4 chain needs the Synthesis Array's research as well as its own, until one is built", () => {
    const b = chainBlockers(chain("antimatter-chain"), { unlockedTech: ["tt-integrated-manufacturing", "tt-antimatter-confinement"], playerBuildings: BUILDINGS });
    expect(b).toMatchObject({ available: false, research: ["tt-high-energy-synthesis"], building: { id: "synthesis-array", owned: false } });
    expect(chainBlockers(chain("antimatter-chain"), { unlockedTech: ["tt-integrated-manufacturing", "tt-antimatter-confinement"], synthesisArrays: [{ id: "sa" }] }).available).toBe(true);
  });

  it("inputs never make a chain unavailable, and a building's Corporation Level does", () => {
    const ctx = { unlockedTech: ["tt-material-compression", "tt-nano-lattice"], playerBuildings: [{ id: "refinery", name: "Refinery", researchGates: [], minLevel: 3 }], level: 1 };
    expect(chainBlockers(chain("silicates-chain"), ctx)).toMatchObject({ available: false, research: [], building: { minLevel: 3 } });
    expect(chainBlockers(chain("silicates-chain"), { ...ctx, level: 3 }).available).toBe(true);
  });

  it("falls back to the buildings' own research when the catalogue has not loaded", () => {
    expect(chainBlockers(chain("silicates-chain"), {}).research).toEqual(["tt-material-compression", "tt-nano-lattice"]);
  });
});
