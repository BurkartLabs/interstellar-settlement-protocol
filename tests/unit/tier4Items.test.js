import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { ITEMS, dataItemSources, unknownItemReferences } from "../../server/game/items.js";
import { MINEABLE_RESOURCES, REFINED_ITEMS } from "../../server/game/catalog.js";
import { normalizeStateShape } from "../../server/game/shape.js";

// ISP-185 (AB#879): docs/design/v0.11-tier4.md's five resources and its Tier 4 products are in the one item catalog
// (data/items.json) at tier 4, and nothing else is. The doc's tables are read here, so the two cannot drift.
const DOC = readFileSync(new URL("../../docs/design/v0.11-tier4.md", import.meta.url), "utf8");
const section = (n) => DOC.split(/^## /m).find((s) => s.startsWith(`${n}.`));
const rows = (text) => text.split("\n").filter((l) => /^\| [^-]/.test(l)).slice(1).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const byName = Object.fromEntries(ITEMS.map((i) => [i.name, i]));

const FIVE = rows(section(1).split("**What the gate does.**")[0]).map(([id, name, , , how]) => ({ id: id.replace(/`/g, ""), name, synthesized: how.includes("synthesized") }));
const tier4Row = rows(section(2).split("### Where")[0]).find(([tier]) => tier.startsWith("**4"));
const TIER4 = tier4Row[3].split(/; |, /).map((s) => s.trim());
const PRODUCTS = rows(section(3).split("### NPC bids")[0]).map(([, , , out]) => out.replace(/ \d+$/, ""));

describe("ISP-185 the Tier 4 items are in the catalog (AB#879)", () => {
  it("has the design's five resources, each by its id, raw when extracted and refined when synthesized", () => {
    expect(FIVE.map((r) => r.name)).toEqual(["Uranium", "Exotic Matter", "Platinum-Group Metals", "Metallic Hydrogen", "Antimatter"]);
    for (const r of FIVE) expect(byName[r.name], r.name).toMatchObject({ id: r.id, tier: 4, category: r.synthesized ? "refined" : "raw" });
  });

  it("has every Tier 4 product at tier 4, refined, and the tier table's Tier 4 row is exactly the catalog's tier 4", () => {
    for (const name of PRODUCTS) expect(byName[name], name).toMatchObject({ tier: 4, category: "refined" });
    expect(TIER4.sort()).toEqual(ITEMS.filter((i) => i.tier === 4).map((i) => i.name).sort());
  });

  it("counts the extracted ones as mineable and the made ones as manufactured", () => {
    for (const r of FIVE) expect(r.synthesized ? REFINED_ITEMS : MINEABLE_RESOURCES, r.name).toContain(r.name);
  });

  it("still resolves every item any data file names (T-019)", () => {
    expect(unknownItemReferences(dataItemSources(), ITEMS)).toEqual([]);
  });

  it("the client names no Tier 4 item: it reads the catalog from the server", () => {
    const dir = new URL("../../public/scripts/", import.meta.url);
    const files = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(new URL(f.replace(/\\/g, "/"), dir), "utf8");
      for (const name of TIER4) expect(src.includes(`"${name}"`), `${f} names ${name}`).toBe(false);
    }
  });
});

describe("ISP-185 a save from before Tier 4 loads (P-FRESH-STATE-ONLY)", () => {
  it("keeps its inventory, Uranium and Exotic Matter included, and gains the new raws in the world's catalog", () => {
    const inventory = { "earth-station-prime": { Silicates: 500, Uranium: 40, "Exotic Matter": 3 }, "luna-gateway": { Aerogel: 12 } };
    const save = { world: { systems: [], resourceCatalog: ["Silicates", "Uranium", "Exotic Matter"] }, corp: { inventory: structuredClone(inventory) } };
    const loaded = normalizeStateShape(save);
    expect(loaded.corp.inventory).toEqual(inventory);
    expect(loaded.world.resourceCatalog).toEqual(expect.arrayContaining(["Uranium", "Exotic Matter", "Platinum-Group Metals", "Metallic Hydrogen"]));
  });
});
