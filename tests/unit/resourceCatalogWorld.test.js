import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeStateShape } from "../../server/game/shape.js";
import { getSeedState } from "../../server/game/world.js";

// AB#2353: the Refinery Chains screen's Resource catalog was a copy of data/refinery-chains.json's list kept in the page,
// and missed Iron Ore when AB#831 added it. The world now carries the data file's list, and the page renders that.
const read = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));
const CATALOG = read("data/refinery-chains.json").resourceCatalog;

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

// AB#2359: the Light Metals track (AB#833) gave Bauxite a bid and Mars and Luna leases, but not a resourceCatalog
// entry, so it could not be listed on the Exchange or charted, and the Refinery screen's catalog left it out. The
// catalog is every raw item the catalog of items names: a track that adds one fails here until it is listed.
describe("the resource catalog is every raw item (AB#2359)", () => {
  const RAW = read("data/items.json").items.filter((i) => i.category === "raw").map((i) => i.name);

  it("lists every raw item in data/items.json once, and nothing else", () => {
    expect([...CATALOG].sort()).toEqual([...RAW].sort());
    expect(new Set(CATALOG).size).toBe(CATALOG.length);
  });

  it("includes every raw item a standing bid buys or a body yields", () => {
    const raw = new Set(RAW);
    const bought = read("data/economy.json").npcBuyers.map((b) => b.item).filter((item) => raw.has(item));
    const yielded = read("data/systems.json").flatMap((s) => s.bodies.flatMap((b) => [...(b.resourceProfile || []).map((p) => p.item), ...Object.keys(b.composition || {})]));
    for (const item of new Set([...bought, ...yielded])) expect(CATALOG, item).toContain(item);
    expect(CATALOG).toContain("Bauxite");
  });
});
