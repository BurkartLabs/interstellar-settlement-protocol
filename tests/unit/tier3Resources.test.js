import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// AB#822: docs/design/tier3-resources.md fixes the v0.8 item names and tiers. Its section 6 lists every raw item the
// build already names, with where each appears; this holds that table to the data files, so an item renamed or added
// in data/ fails here until the design names it.
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const json = (rel) => JSON.parse(read(rel));
const DOC = read("docs/design/tier3-resources.md");
const SYSTEMS = json("data/systems.json");
const CHAINS = json("data/refinery-chains.json");
const ECONOMY = json("data/economy.json");
const MISSIONS = json("data/missions.json");

const section6 = DOC.slice(DOC.indexOf("## 6."), DOC.indexOf("## 7."));
const rows = new Map(section6.split("\n")
  .filter((l) => l.startsWith("| ") && !l.startsWith("| Item") && !l.startsWith("| ---"))
  .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
  .map(([item, tier, belts, bid, quota, chain]) => [item, { tier: Number(tier), belts, bid, quota, chain }]));

const beltCount = new Map();
for (const s of SYSTEMS) for (const b of s.bodies) for (const k of Object.keys(b.composition || {})) beltCount.set(k, (beltCount.get(k) || 0) + 1);
const bids = new Set(ECONOMY.npcBuyers.map((n) => n.item));
const quotas = new Set(MISSIONS.templates.map((t) => t.resource).filter(Boolean));
const chainInputs = new Map(CHAINS.chains.map((c) => [c.input, c.id]));
const raw = new Set([...beltCount.keys(), ...CHAINS.resourceCatalog, ...bids, ...quotas, ...chainInputs.keys()]);

describe("the v0.8 resource catalogue matches the build (AB#822)", () => {
  it("lists every raw item the build names, and no other", () => {
    expect([...rows.keys()].sort()).toEqual([...raw].sort());
  });

  it("gives each its tier: 1 or 2", () => {
    for (const [item, row] of rows) expect([1, 2], item).toContain(row.tier);
  });

  it("says in how many belts, whether a standing bid buys it, whether a mission asks for it and which chain takes it", () => {
    for (const [item, row] of rows) {
      const n = beltCount.get(item) || 0;
      expect(row.belts, `${item} belts`).toBe(n ? `${n} belt${n === 1 ? "" : "s"}` : "");
      expect(row.bid === "yes", `${item} bid`).toBe(bids.has(item));
      expect(row.quota === "yes", `${item} quota`).toBe(quotas.has(item));
      expect(row.chain, `${item} chain`).toBe(chainInputs.has(item) ? `${chainInputs.get(item)} input` : "");
    }
  });

  it("names every chain product as Tier 3", () => {
    for (const c of CHAINS.chains) for (const o of c.outputs) expect(DOC, o.item).toContain(o.item);
  });

  it("names the three new items, and the four tracks' sections", () => {
    for (const item of ["Deuterium", "Iron Ore", "Bauxite"]) expect(DOC).toMatch(new RegExp(`\\| \`[a-z-]+\` \\| ${item} \\| 1 \\| \\*\\*yes\\*\\*`));
    for (const track of ["### Helium-3 and Deuterium", "### The Nickel-Iron Rally", "### Rare Metals", "### Light Metals"]) expect(DOC).toContain(track);
  });
});
