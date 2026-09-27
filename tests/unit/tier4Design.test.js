import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ECONOMY, npcBidFor } from "../../server/economy.js";

// AB#878: docs/design/v0.11-tier4.md fixes the Tier 4 recipes, their bids and the Synthesis Array's worked example.
// This reads the doc's own tables and recomputes them from the build's Tier 3 bids and bid rule, so a number edited
// in one place and not the other fails here (P-TWO-SOURCES).
const DOC = readFileSync(new URL("../../docs/design/v0.11-tier4.md", import.meta.url), "utf8");
const RESEARCH = JSON.parse(readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes;
const section = (n) => DOC.split(/^## /m).find((s) => s.startsWith(`${n}.`));
const rows = (text) => text.split("\n").filter((l) => /^\| [^-]/.test(l)).slice(1).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const num = (s) => Number(String(s).replace(/[*,]/g, "").replace("−", "-"));
const T3_BASE = Object.fromEntries(ECONOMY.npcBuyers.map((b) => [b.item, b.unitPrice]));

const [recipeTable, bidTable] = section(3).split("### NPC bids")
  .map((part, i) => rows(i === 0 ? part : part.split("### The engine")[0]));
const BID = Object.fromEntries(bidTable.map(([item, , , base, floor, quota]) => [item, { base: num(base), floor: num(floor), quota }]));
const inputs = (cell) => cell.split(" + ").map((s) => s.match(/^(.+) (\d+)$/)).map(([, item, q]) => [item, Number(q)]);
const RECIPES = recipeTable.map(([chain, , ins, out, cycle, research]) => {
  const [, item, units] = out.match(/^(.+) (\d+)$/);
  return { chain, item, units: Number(units), hours: Number(cycle.replace(" h", "")), inputs: inputs(ins), research: research.replace(/`/g, "") };
});
const priceOf = (item) => BID[item]?.base ?? T3_BASE[item];
const inputValue = (r) => r.inputs.reduce((sum, [item, q]) => sum + q * priceOf(item), 0);

describe("AB#878 the Tier 4 recipes and bids", () => {
  it("prices every product by v0.8's rule: outputs worth 1.15 times inputs at base, a floor at 55%", () => {
    expect(RECIPES).toHaveLength(6);
    expect(ECONOMY.npcBid.floorPct).toBe(55);
    for (const r of RECIPES) {
      for (const [item] of r.inputs) expect(priceOf(item), `${r.chain}: ${item} has a base`).toBeGreaterThan(0);
      expect(BID[r.item].base, r.chain).toBe(Math.round((1.15 * inputValue(r)) / r.units));
      expect(BID[r.item].floor, r.chain).toBe(Math.round(BID[r.item].base * 0.55));
      expect(num(BID[r.item].quota), r.chain).toBe(Math.round((24 / r.hours) * r.units)); // one Array's day
    }
  });

  it("gives each extracted resource a floor at 55%, the raw quota, and a base above every Tier 2 raw item's", () => {
    const extracted = bidTable.filter(([, , madeBy]) => madeBy === "extracted");
    expect(extracted.map(([item]) => item)).toEqual(["Uranium", "Exotic Matter", "Platinum-Group Metals", "Metallic Hydrogen"]);
    for (const [item, , , base, floor, quota] of extracted) {
      expect(num(floor), item).toBe(Math.round(num(base) * 0.55));
      expect(num(quota.replace("raw: ", "")), item).toBe(ECONOMY.npcBid.quotaPerDay);
      expect(num(base), item).toBeGreaterThan(T3_BASE.Thorium ?? 160);
    }
  });

  it("names research that section 5 defines, over prerequisites the build already has", () => {
    const nodes = rows(section(5));
    const ids = new Set(RESEARCH.map((n) => n.id));
    const designed = new Set(nodes.map(([id]) => id.replace(/`/g, "")));
    for (const r of RECIPES) expect(designed, r.chain).toContain(r.research);
    for (const [id, , tier, needs] of nodes) {
      expect([4, 5], id).toContain(Number(tier));
      for (const p of needs.match(/`[^`]+`/g).map((s) => s.replace(/`/g, ""))) expect(ids.has(p) || designed.has(p), `${id} needs ${p}`).toBe(true);
    }
  });
});

describe("AB#878 the Synthesis Array's worked example (T-018)", () => {
  const recipe = (item) => RECIPES.find((r) => r.item === item);
  const [coils, emitters] = [recipe("Superconducting Coils"), recipe("Field Emitters")];
  const sell = (r, units) => {
    const rule = { ...ECONOMY.npcBid, quotaPerDay: num(BID[r.item].quota) };
    let revenue = 0;
    for (let k = 0; k < units; k++) revenue += npcBidFor(BID[r.item].base, k, rule);
    return revenue;
  };
  const example = rows(section(4)).map((cells) => cells.map(num));

  it("recomputes every row from the bid rule and the inputs at base", () => {
    expect(example).toHaveLength(5);
    for (const [a, b, hours, soldA, soldB, cost, net] of example) {
      expect(hours).toBe(a * coils.hours + b * emitters.hours);
      expect(soldA).toBe(sell(coils, a * coils.units));
      expect(soldB).toBe(sell(emitters, b * emitters.units));
      expect(cost).toBe(a * inputValue(coils) + b * inputValue(emitters));
      expect(net).toBe(soldA + soldB - cost);
    }
  });

  it("has an interior optimum: one of each beats every other split of the day into whole cycles", () => {
    const net = (a, b) => sell(coils, a * coils.units) + sell(emitters, b * emitters.units) - a * inputValue(coils) - b * inputValue(emitters);
    let best = null;
    for (let a = 0; a * coils.hours <= 24; a++) {
      for (let b = 0; a * coils.hours + b * emitters.hours <= 24; b++) if (!best || net(a, b) > best.net) best = { a, b, net: net(a, b) };
    }
    expect(best).toEqual({ a: 1, b: 1, net: 607 });
  });
});
