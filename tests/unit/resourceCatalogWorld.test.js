import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeStateShape } from "../../server/game/shape.js";
import { getSeedState } from "../../server/game/world.js";

// AB#2353: the Refinery Chains screen's Resource catalog was a copy of data/refinery-chains.json's list kept in the page,
// and missed Iron Ore when AB#831 added it. The world now carries the data file's list, and the page renders that.
const CATALOG = JSON.parse(readFileSync(new URL("../../data/refinery-chains.json", import.meta.url), "utf8")).resourceCatalog;

describe("the world carries the resource catalog (AB#2353)", () => {
  it("a fresh world has the data file's list, Iron Ore included", () => {
    expect(getSeedState().world.resourceCatalog).toEqual(CATALOG);
    expect(CATALOG).toContain("Iron Ore");
  });

  it("a saved world without it, or with an old copy, gets the data file's list", () => {
    expect(normalizeStateShape({ world: { systems: [] } }).world.resourceCatalog).toEqual(CATALOG);
    expect(normalizeStateShape({ world: { systems: [], resourceCatalog: ["Silicates"] } }).world.resourceCatalog).toEqual(CATALOG);
  });

  it("the page keeps no copy of it", () => {
    const view = readFileSync(new URL("../../public/scripts/views/refinery.js", import.meta.url), "utf8");
    expect(view).not.toMatch(/RESOURCE_CATALOG\s*=/);
    expect(view).toContain("data.world?.resourceCatalog");
  });
});
