import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";
import { normalizeStateShape } from "../../server/game/shape.js";
import { lanePairs } from "../../public/scripts/navigation.js";

// ISP-114 (AB#806): the first half of docs/design/starmap-20.md in data/systems.json. The data is checked against the
// design's own tables, so any drift between the two is a failing line, and a saved world gains the new systems.
const DESIGN = fs.readFileSync(new URL("../../docs/design/starmap-20.md", import.meta.url), "utf8");
const byId = Object.fromEntries(SYSTEMS_DATA.map((s) => [s.id, s]));
const FIRST_HALF = ["lalande-21185", "ross-154", "sirius", "ross-248", "luyten-726-8", "lacaille-9352"];

/** The design's table rows whose second cell is a `system-id`, as { id: cells }. */
function designRows(heading) {
  const section = DESIGN.split(heading)[1].split("\n## ")[0].split("\n### ")[0];
  const rows = {};
  for (const line of section.split(/\r?\n/)) {
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    const id = cells[1]?.match(/^`([a-z0-9-]+)`$/)?.[1];
    if (id) rows[id] = cells;
  }
  return rows;
}
/** Rows keyed by the system's display name (tables whose first cell is the name). */
function designRowsByName(heading) {
  const section = DESIGN.split(heading)[1].split("\n## ")[0].split("\n### ")[0];
  const nameToId = Object.fromEntries(Object.entries(designRows("## The systems")).map(([id, c]) => [c[0], id]));
  const rows = {};
  for (const line of section.split(/\r?\n/)) {
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, "|"));
    if (nameToId[cells[0]]) rows[nameToId[cells[0]]] = cells;
  }
  return rows;
}
const TRAITS = designRows("## The systems");
const OWNERS = designRowsByName("### Owners and bodies");
const BELTS = designRowsByName("### Belts");
const ADJ = designRowsByName("## The adjacency graph");
const NAME_TO_ID = Object.fromEntries(Object.entries(TRAITS).map(([id, c]) => [c[0], id]));

describe("data/systems.json against docs/design/starmap-20.md (AB#806)", () => {
  it("holds the six that existed and the design's first half, and nothing the design does not name", () => {
    for (const id of FIRST_HALF) expect(byId[id], id).toBeDefined();
    for (const s of SYSTEMS_DATA) expect(TRAITS[s.id], `${s.id} is in the design`).toBeDefined();
  });

  it("every system's traits, gate, position and owner are the design's", () => {
    for (const s of SYSTEMS_DATA) {
      const [name, , , , , , gdp, pir, act, rarity, gate, , pos] = TRAITS[s.id];
      expect(s.name, s.id).toBe(name);
      expect([s.gdpIndex, s.pirateDensity, s.activityLevel], s.id).toEqual([Number(gdp), Number(pir), Number(act)]);
      expect(s.rarity, s.id).toBe(rarity);
      expect(s.accessResearch ?? "none", s.id).toBe(gate === "none" ? "none" : gate.match(/`([^`]+)`/)[1]);
      expect(`(${s.mapPosition.x}, ${s.mapPosition.y})`, s.id).toBe(pos);
      expect(s.ownerRule, s.id).toBe(OWNERS[s.id][1]);
    }
  });

  it("every body's name is in the design's row for its system (Sol's lists its moons with an ellipsis)", () => {
    for (const s of SYSTEMS_DATA.filter((x) => x.id !== "sol")) {
      const names = OWNERS[s.id][2].split(/;\s*/).flatMap((group) => group.replace(/\s*\([^)]*\)\s*$/, "").split(/,\s*/));
      for (const b of s.bodies) expect(names, `${s.id}: ${b.name}`).toContain(b.name);
    }
  });

  it("every belt is the design's, and sums to 100", () => {
    for (const s of SYSTEMS_DATA) {
      const belt = s.bodies.find((b) => b.type === "Field")?.composition;
      const design = Object.fromEntries(BELTS[s.id][1].split(", ").map((part) => { const m = part.match(/^(.+) (\d+)$/); return [m[1], Number(m[2])]; }));
      expect(belt, s.id).toEqual(design);
      expect(Object.values(belt).reduce((a, b) => a + b, 0), s.id).toBe(100);
    }
  });

  it("the lanes are the design's wherever both ends are in the data yet, two-way, and none leads nowhere", () => {
    for (const s of SYSTEMS_DATA) {
      const design = ADJ[s.id][2].split(", ").map((n) => NAME_TO_ID[n]);
      expect([...s.adjacent].sort(), s.id).toEqual(design.filter((id) => byId[id]).sort());
      for (const other of s.adjacent) expect(byId[other].adjacent, `${other} back to ${s.id}`).toContain(s.id);
    }
  });

  it("hops from Sol are the design's for every system in the data", () => {
    const hops = { sol: 0 };
    const queue = ["sol"];
    while (queue.length) { const c = queue.shift(); for (const n of byId[c].adjacent) if (hops[n] === undefined) { hops[n] = hops[c] + 1; queue.push(n); } }
    for (const s of SYSTEMS_DATA) expect(hops[s.id], s.id).toBe(Number(ADJ[s.id][1]));
  });
});

describe("the cluster view's lanes (Bug #2328)", () => {
  it("are exactly the adjacent pairs, once each, however far apart", () => {
    const pairs = lanePairs(SYSTEMS_DATA).map((p) => p.join("|"));
    const expected = new Set(SYSTEMS_DATA.flatMap((s) => s.adjacent.map((o) => [s.id, o].sort().join("|"))));
    expect(pairs.sort()).toEqual([...expected].sort());
    // Near but not adjacent: no lane. Far but adjacent: a lane.
    const fake = [
      { id: "a", mapPosition: { x: 0.1, y: 0.1 }, adjacent: ["c"] },
      { id: "b", mapPosition: { x: 0.11, y: 0.11 }, adjacent: [] },
      { id: "c", mapPosition: { x: 0.95, y: 0.95 }, adjacent: ["a"] }
    ];
    expect(lanePairs(fake)).toEqual([["a", "c"]]);
  });
});

describe("a world saved before AB#806 (normalisation)", () => {
  it("gains the new systems, takes the catalog's positions and lanes, and keeps its own bodies", () => {
    const old = SYSTEMS_DATA.filter((s) => !FIRST_HALF.includes(s.id)).map((s) => ({
      ...JSON.parse(JSON.stringify(s)),
      mapPosition: { x: 0.5, y: 0.5 },
      adjacent: ["sol"],
      gdpIndex: 1,
      bodies: s.bodies.map((b) => ({ ...b, savedMarker: `kept-${b.id}` }))
    }));
    old.push({ id: "retired-system", name: "Retired", bodies: [] });
    const state = normalizeStateShape({ world: { systems: old } });
    const systems = state.world.systems;
    expect(systems.map((s) => s.id)).toEqual([...SYSTEMS_DATA.map((s) => s.id), "retired-system"]);
    for (const s of SYSTEMS_DATA) {
      const got = systems.find((x) => x.id === s.id);
      expect(got.mapPosition, s.id).toEqual(s.mapPosition);
      expect(got.adjacent, s.id).toEqual(s.adjacent);
      expect(got.gdpIndex, s.id).toBe(s.gdpIndex);
    }
    expect(systems.find((s) => s.id === "barnards-star").bodies.every((b) => b.savedMarker)).toBe(true);
    expect(systems.find((s) => s.id === "sirius").bodies.map((b) => b.id)).toEqual(["si-ia", "si-anchorage", "si-disk"]);
    // A new system is a copy: changing the world's does not change the catalog.
    const catalogLanes = [...byId.sirius.adjacent];
    systems.find((s) => s.id === "sirius").adjacent.push("x");
    expect(byId.sirius.adjacent).toEqual(catalogLanes);
  });
});
