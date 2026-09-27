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
// AB#2341: products have standing bids too; section 6 lists raw items, so a chain's output is not counted as one.
const products = new Set(CHAINS.chains.flatMap((c) => (c.outputs || []).map((o) => o.item)));
const ITEMS = json("data/items.json").items; // AB#831: a product is Tier 3 in the item catalog (AB#824)
const bids = new Set(ECONOMY.npcBuyers.map((n) => n.item).filter((item) => !products.has(item)));
const quotas = new Set(MISSIONS.templates.map((t) => t.resource).filter(Boolean));
// AB#830: an item may feed several chains (Helium-3: he3-chain and fusion-fuel-chain), named in data order.
const chainInputs = new Map();
// AB#833: a product another chain takes (Aluminium Ingots, into al-li-chain) is not a raw item.
for (const c of CHAINS.chains) for (const i of c.inputs) if (!products.has(i.item)) chainInputs.set(i.item, [...(chainInputs.get(i.item) || []), c.id]);
// AB#879: Tier 4 items belong to docs/design/v0.11-tier4.md (tests/unit/tier4Items.test.js), not this v0.8 table.
const TIER4 = new Set(ITEMS.filter((i) => i.tier === 4).map((i) => i.name));
for (const item of TIER4) rows.delete(item);
const raw = new Set([...beltCount.keys(), ...CHAINS.resourceCatalog, ...bids, ...quotas, ...chainInputs.keys()].filter((item) => !TIER4.has(item)));

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
      expect(row.chain, `${item} chain`).toBe(chainInputs.has(item) ? `${chainInputs.get(item).join(", ")} input` : "");
    }
  });

  it("has every chain product at Tier 3 in the item catalog (section 1: made, never mined)", () => {
    for (const c of CHAINS.chains) for (const o of c.outputs) {
      expect(ITEMS.find((i) => i.name === o.item), o.item).toMatchObject({ tier: 3, category: "refined" });
    }
  });

  it("names the three new items, and the four tracks' sections", () => {
    for (const item of ["Deuterium", "Iron Ore", "Bauxite"]) expect(DOC).toMatch(new RegExp(`\\| \`[a-z-]+\` \\| ${item} \\| 1 \\| \\*\\*yes\\*\\*`));
    for (const track of ["### Helium-3 and Deuterium", "### The Nickel-Iron Rally", "### Rare Metals", "### Light Metals"]) expect(DOC).toContain(track);
  });
});
