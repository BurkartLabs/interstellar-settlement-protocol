import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { npcBidFor } from "../../server/economy.js";

// AB#823: docs/design/tier3-recipes.md is the v0.8 recipe graph. Its tables are the spec the track stories (AB#830 to
// AB#834) put into data, so this holds them to their own rule (outputs worth 1.15 times inputs at base, floors by
// npcBidFor), to the resource catalogue (AB#822) and to the six chains already in data/refinery-chains.json.
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const DOC = read("docs/design/tier3-recipes.md");
const CATALOGUE = read("docs/design/tier3-resources.md");
const CHAINS = JSON.parse(read("data/refinery-chains.json")).chains;
const ECONOMY = JSON.parse(read("data/economy.json"));
const RESEARCH = JSON.parse(read("data/research.json")).nodes;

const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
// A table's body rows: lines starting "| ", less each header (the line before a "| ---" line) and the separators.
const tableRows = (text) => text.split("\n")
  .filter((l, i, all) => l.startsWith("| ") && !l.startsWith("| ---") && !(all[i + 1] || "").startsWith("| ---"))
  .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const ticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const itemQty = (s) => { const m = s.match(/^(.*) (\d+)$/); return [m[1], Number(m[2])]; };

const graph = tableRows(between(DOC, "## 2.", "## 3.")).map(([id, track, stage, ins, outs, cycle, research, building, drawn]) => ({
  id: ticked(id)[0], isNew: id.includes("**new**"), track, stage: Number(stage),
  inputs: ins.split(" + ").map(itemQty), outputs: outs.split(", ").map(itemQty),
  hours: Number(cycle.replace(" h", "")), research: ticked(research), building, drawn: drawn.split(" + "),
}));
const rawRows = tableRows(between(DOC, "### Raw items", "### Products"));
const productRows = tableRows(between(DOC, "### Products", "## 5."));
const newNodes = tableRows(between(DOC, "## 3.", "## 4.")).map(([id, , , needs]) => ({ id: ticked(id)[0], needs: ticked(needs) }));

const bids = Object.fromEntries(ECONOMY.npcBuyers.map((b) => [b.item, b.unitPrice]));
const base = { ...bids };
for (const [item, , , , b] of rawRows) base[item] = Number(b);
for (const [item, , , , b] of productRows) base[item] = Number(b);
const floorOf = (item) => npcBidFor(base[item], Number.MAX_SAFE_INTEGER);
const catalogueRaw = new Set(tableRows(between(CATALOGUE, "## 2.", "## 3.")).map((r) => r[1]).filter(Boolean));
for (const kept of ["Silicates", "Carbon", "Titanium"]) catalogueRaw.add(kept); // section 2's "kept as they are"
const madeBy = new Map(graph.flatMap((c) => c.outputs.map(([item]) => [item, c])));
const value = (list, price) => list.reduce((s, [item, q]) => s + q * price(item), 0);

describe("the v0.8 recipe graph (AB#823)", () => {
  it("has the six chains in data unchanged and thirteen new ones", () => {
    expect(graph.filter((c) => !c.isNew).map((c) => c.id).sort()).toEqual(CHAINS.map((c) => c.id).sort());
    expect(graph.filter((c) => c.isNew)).toHaveLength(13);
    for (const c of CHAINS) {
      const g = graph.find((x) => x.id === c.id);
      expect(g.inputs, c.id).toEqual([[c.input, c.inputQuantityPerCycle]]);
      expect(g.outputs, c.id).toEqual(c.outputs.map((o) => [o.item, o.quantityPerCycle]));
      expect(g.hours, c.id).toBe(c.cycleDurationHours);
      expect(g.research, c.id).toEqual(c.requiresTechIds);
    }
  });

  it("takes every input from the resource catalogue or from another chain's output", () => {
    for (const c of graph) for (const [item] of c.inputs) {
      expect(catalogueRaw.has(item) || madeBy.has(item), `${c.id}: ${item}`).toBe(true);
    }
    for (const c of graph) for (const [item] of c.outputs) expect(catalogueRaw.has(item), `${item} is made, never mined`).toBe(false);
  });

  it("counts stages from the deepest input, and runs every chain in a Refinery", () => {
    const stageOf = (item) => (madeBy.has(item) ? madeBy.get(item).stage : 0);
    for (const c of graph) {
      expect(c.stage, c.id).toBe(1 + Math.max(...c.inputs.map(([i]) => stageOf(i))));
      expect(c.building, c.id).toBe("Refinery");
    }
  });

  it("prices every raw item and product: bids that exist are kept, bases follow the 1.15 rule, floors are npcBidFor's", () => {
    for (const [item, , , today, b, f] of rawRows) {
      if (bids[item] !== undefined) expect(Number(today), item).toBe(bids[item]);
      expect(Number(f), item).toBe(floorOf(item));
      expect(catalogueRaw.has(item), item).toBe(true);
    }
    for (const c of graph) {
      const inVal = value(c.inputs, (i) => base[i]);
      const shares = c.outputs.length === 1 ? [1] : [0.6, 0.4];
      c.outputs.forEach(([item, q], k) => {
        const row = productRows.find((r) => r[0] === item);
        expect(row, item).toBeDefined();
        expect(ticked(row[1])[0], item).toBe(c.id);
        expect(Number(row[2]), item).toBe(c.stage);
        expect(Number(row[4]), item).toBe(Math.round((1.15 * inVal * shares[k]) / q));
        expect(Number(row[5]), item).toBe(floorOf(item));
      });
    }
    expect(productRows).toHaveLength(graph.reduce((n, c) => n + c.outputs.length, 0));
  });

  it("makes refining win in Fresh and Raw glut and lose in Product glut, at tier 1 and for a Refinery Complex", () => {
    const complex = ECONOMY.buildings.refineryComplexOutputMultiplier;
    for (const c of graph) {
      const inBase = value(c.inputs, (i) => base[i]);
      const inFloor = value(c.inputs, floorOf);
      const outBase = value(c.outputs, (i) => base[i]);
      const outFloor = value(c.outputs, floorOf);
      expect(outBase / inBase, `${c.id} fresh`).toBeGreaterThan(1);
      expect(outBase / inFloor, `${c.id} raw glut`).toBeGreaterThan(1);
      expect(outFloor / inBase, `${c.id} product glut`).toBeLessThan(1);
      expect((complex * outFloor) / inBase, `${c.id} product glut, Complex`).toBeLessThan(1);
      // Section 5's condition is reachable: at both floors, refining wins.
      expect(outFloor / inFloor, `${c.id} both floors`).toBeGreaterThan(1);
      // No money pump at tier 1: inputs bought at an NPC ask (AB#815) and refined sell for less than they cost.
      expect(outBase / (inBase * ECONOMY.npcAsks.askMultiple), `${c.id} bought at the ask`).toBeLessThan(1);
    }
  });

  it("names research that exists or is designed in section 3, on prerequisites that exist", () => {
    const existing = new Set(RESEARCH.map((n) => n.id));
    const designed = new Set(newNodes.map((n) => n.id));
    for (const c of graph) for (const id of c.research) expect(existing.has(id) || designed.has(id), `${c.id}: ${id}`).toBe(true);
    for (const n of newNodes) {
      expect(existing.has(n.id), `${n.id} is new`).toBe(false);
      for (const p of n.needs) expect(existing.has(p), `${n.id} needs ${p}`).toBe(true);
    }
  });

  it("has final products that draw on two or more tracks, as the table says", () => {
    const trackOf = Object.fromEntries(tableRows(between(DOC, "### Raw items", "### Products")).map(([i, , t]) => [i, t]));
    const tracksOf = (item) => (madeBy.has(item) ? madeBy.get(item).inputs.flatMap(([i]) => tracksOf(i)) : trackOf[item] ? [trackOf[item]] : []);
    for (const c of graph) {
      const drawn = [...new Set(c.inputs.flatMap(([i]) => tracksOf(i)))].sort();
      expect(drawn.length ? drawn : ["none"], c.id).toEqual([...c.drawn].sort());
    }
    const finals = graph.filter((c) => c.outputs.every(([item]) => !graph.some((g) => g.inputs.some(([i]) => i === item))));
    expect(finals.filter((c) => c.drawn.length >= 2).length).toBeGreaterThanOrEqual(1);
  });

  it("works section 5's arithmetic from the tables", () => {
    const smelting = graph.find((c) => c.id === "smelting-chain");
    expect(value(smelting.outputs, floorOf)).toBe(1520);
    expect(value(smelting.inputs, (i) => base[i])).toBe(2400);
    expect(value(smelting.inputs, floorOf)).toBe(1400);
    const magnets = graph.find((c) => c.id === "magnet-chain");
    expect(value(magnets.outputs, floorOf)).toBe(4560);
    expect(value(magnets.inputs, (i) => base[i])).toBe(7200);
    expect(value(magnets.inputs, floorOf)).toBe(3980);
  });
});
