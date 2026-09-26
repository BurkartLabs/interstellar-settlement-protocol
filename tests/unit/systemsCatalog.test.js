import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import { navigationFor } from "../../public/scripts/navigation.js";
import { applyAsteroidExpeditions, BELT_KEYS, beltComposition, NAVIGATION } from "../../server/gameState.js";
import { RARITY_YIELD_MULTIPLIER, systemRarity } from "../../server/game/asteroids.js";
import { makeCorp } from "../fixtures/makeCorp.js";

// ISP-112 (AB#804): data/systems.json is the one source for every per-system fact: its bodies and owner rule, its
// place on the starmap (mapPosition), its jump routes (adjacent), the research a jump to it needs (accessResearch),
// its rarity, and each belt's composition (on the belt's Field body). Adding a system is one entry here. This holds the
// catalog to the rules a new entry must keep, and pins what the six systems did before the move.
const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));
const SYSTEMS = read("data/systems.json");
const STATIONS = read("data/stations.json").stations;
const RESEARCH = new Set(read("data/research.json").nodes.map((n) => n.id));
const byId = new Map(SYSTEMS.map((s) => [s.id, s]));

describe("data/systems.json holds together (ISP-112)", () => {
  it("every route runs both ways, to a system the catalog has", () => {
    for (const s of SYSTEMS) {
      expect(Array.isArray(s.adjacent), `${s.id} has routes`).toBe(true);
      for (const n of s.adjacent) {
        expect(byId.has(n), `${s.id} -> ${n} is a system`).toBe(true);
        expect(byId.get(n).adjacent, `${n} -> ${s.id} too`).toContain(s.id);
      }
    }
  });

  it("every system can be reached from Sol", () => {
    const nav = navigationFor(SYSTEMS);
    for (const s of SYSTEMS) expect(nav.systemHops("sol", s.id), `sol -> ${s.id}`).not.toBeNull();
  });

  it("every moon's parent is a body of its own system", () => {
    for (const s of SYSTEMS) {
      const ids = new Set(s.bodies.map((b) => b.id));
      for (const moon of s.bodies.filter((b) => b.type === "Moon")) expect(ids.has(moon.parentId), `${s.id}/${moon.id} -> ${moon.parentId}`).toBe(true);
    }
  });

  it("every station's system is in the catalog, and the body it orbits is in that system", () => {
    for (const station of STATIONS) {
      const system = byId.get(station.systemId);
      expect(system, `${station.id}'s system ${station.systemId}`).toBeTruthy();
      expect(system.bodies.map((b) => b.name), `${station.id} orbits ${station.body}`).toContain(station.body);
    }
  });

  it("every belt composition sits on a Field body of a system in the catalog, and the server has them all", () => {
    const withComposition = SYSTEMS.flatMap((s) => s.bodies.filter((b) => b.composition).map((b) => ({ s, b })));
    expect(withComposition.length).toBeGreaterThan(0);
    for (const { s, b } of withComposition) expect(b.type, `${s.id}/${b.id}`).toBe("Field");
    expect([...BELT_KEYS].sort()).toEqual(withComposition.map(({ s, b }) => `${s.id}:${b.id}`).sort());
  });

  it("every system has a place on the map, a known rarity and a gate that is research or none; Sol needs none", () => {
    for (const s of SYSTEMS) {
      expect(s.mapPosition.x, `${s.id} x`).toBeGreaterThanOrEqual(0);
      expect(s.mapPosition.x, `${s.id} x`).toBeLessThanOrEqual(1);
      expect(s.mapPosition.y, `${s.id} y`).toBeGreaterThanOrEqual(0);
      expect(s.mapPosition.y, `${s.id} y`).toBeLessThanOrEqual(1);
      expect(Object.keys(RARITY_YIELD_MULTIPLIER), `${s.id} rarity`).toContain(s.rarity);
      if (s.accessResearch !== null) expect(RESEARCH.has(s.accessResearch), `${s.id} gate ${s.accessResearch}`).toBe(true);
    }
    expect(byId.get("sol").accessResearch).toBeNull();
  });
});

// The six systems as they were before the move (main 99306233, read from SYSTEM_ADJACENCY, NEAR_STAR_SYSTEMS,
// BELT_COMPOSITIONS and SYSTEM_RARITY): the move changed no hop, gate, composition, rarity or yield.
const BEFORE = {
  hops: {
    "sol": { "sol": 0, "alpha-centauri": 1, "barnards-star": 1, "wolf-359": 2, "tau-ceti": 2, "epsilon-eridani": 3 },
    "alpha-centauri": { "sol": 1, "alpha-centauri": 0, "barnards-star": 2, "wolf-359": 1, "tau-ceti": 2, "epsilon-eridani": 2 },
    "barnards-star": { "sol": 1, "alpha-centauri": 2, "barnards-star": 0, "wolf-359": 2, "tau-ceti": 1, "epsilon-eridani": 2 },
    "wolf-359": { "sol": 2, "alpha-centauri": 1, "barnards-star": 2, "wolf-359": 0, "tau-ceti": 1, "epsilon-eridani": 1 },
    "tau-ceti": { "sol": 2, "alpha-centauri": 2, "barnards-star": 1, "wolf-359": 1, "tau-ceti": 0, "epsilon-eridani": 1 },
    "epsilon-eridani": { "sol": 3, "alpha-centauri": 2, "barnards-star": 2, "wolf-359": 1, "tau-ceti": 1, "epsilon-eridani": 0 }
  },
  gates: { "sol": null, "alpha-centauri": "tt-proxima-navigation", "barnards-star": "tt-proxima-navigation", "wolf-359": "tt-deep-star-navigation", "tau-ceti": "tt-deep-star-navigation", "epsilon-eridani": "tt-deep-star-navigation" },
  rarity: { "sol": "common", "alpha-centauri": "uncommon", "barnards-star": "uncommon", "wolf-359": "rare", "tau-ceti": "rare", "epsilon-eridani": "exotic" },
  compositions: {
    "sol:belt": { "Silicates": 35, "Carbon": 25, "Nickel": 20, "Water Ice": 15, "Titanium": 5 },
    "alpha-centauri:ac-belt": { "Silicates": 25, "Nickel": 22, "Titanium": 18, "Carbon": 15, "Hydrogen": 12, "Lithium": 8 },
    "barnards-star:bn-rift": { "Nickel": 25, "Titanium": 22, "Carbon": 18, "Silicates": 15, "Hydrogen": 12, "Cobalt": 8 },
    "wolf-359:wf-shards": { "Titanium": 20, "Nickel": 18, "Rare Earths": 16, "Lithium": 14, "Carbon": 12, "Cobalt": 10, "Thorium": 10 },
    "tau-ceti:tc-cloud": { "Rare Earths": 18, "Cobalt": 16, "Thorium": 14, "Titanium": 14, "Nickel": 12, "Helium-3": 10, "Lithium": 8, "Uranium": 8 },
    "epsilon-eridani:ee-crown": { "Rare Earths": 15, "Thorium": 14, "Uranium": 12, "Cobalt": 12, "Exotic Matter": 8, "Helium-3": 10, "Titanium": 10, "Lithium": 10, "Nickel": 9 }
  },
  // Half of a standard expedition on each belt, with the same seeded draws, on main before the move (test mode).
  yields: {
    "sol:belt": { "Carbon": 5216, "Water Ice": 5584 },
    "alpha-centauri:ac-belt": { "Silicates": 12420 },
    "barnards-star:bn-rift": { "Titanium": 12420 },
    "wolf-359:wf-shards": { "Nickel": 14580 },
    "tau-ceti:tc-cloud": { "Thorium": 6268, "Titanium": 8312 },
    "epsilon-eridani:ee-crown": { "Cobalt": 8501, "Exotic Matter": 8779 }
  }
};

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

describe("the six systems are what they were before the move (ISP-112)", () => {
  it("every jump between them counts the same hops, on the server's routes", () => {
    for (const [from, row] of Object.entries(BEFORE.hops)) {
      for (const [to, hops] of Object.entries(row)) expect(NAVIGATION.systemHops(from, to), `${from} -> ${to}`).toBe(hops);
    }
  });

  it("every system needs the same research to reach", () => {
    for (const [id, research] of Object.entries(BEFORE.gates)) expect(NAVIGATION.researchForSystem(id), id).toBe(research);
  });

  it("every belt has the same composition and every system the same rarity", () => {
    expect([...BELT_KEYS].sort()).toEqual(Object.keys(BEFORE.compositions).sort());
    for (const [key, composition] of Object.entries(BEFORE.compositions)) expect(beltComposition(key), key).toEqual(composition);
    for (const [id, rarity] of Object.entries(BEFORE.rarity)) expect(systemRarity(id), id).toBe(rarity);
  });

  it("every belt yields the same, half an expedition in, from the same draws", () => {
    // mulberry32, seeded per belt as the recording was (a script run against main and the branch, identical output).
    const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const START = 1_700_000_000_000;
    for (const [i, beltKey] of BELT_KEYS.entries()) {
      const corp = makeCorp({
        currentStationId: "earth-station-prime", buildings: [], inventory: {},
        asteroidMining: { probeCount: 0, maxProbes: 2, completedExpeditions: [],
          activeExpeditions: [{ id: `exp-${i}`, status: "active", beltKey, systemId: beltKey.split(":")[0], duration: "standard",
            deployedAt: START, lastTickAt: START, completesAt: START + 20 * 60_000, yields: {} }] }
      });
      Math.random = seeded(1000 + i);
      applyAsteroidExpeditions(corp, START + 10 * 60_000);
      Math.random = realRandom;
      expect(corp.asteroidMining.activeExpeditions[0].yields, beltKey).toEqual(BEFORE.yields[beltKey]);
    }
  });

  it("the catalog cannot be changed at run time, so the page and every request read the same facts", async () => {
    const { SYSTEMS_DATA } = await import("../../server/game/catalog.js");
    expect(Object.isFrozen(SYSTEMS_DATA)).toBe(true);
    expect(Object.isFrozen(SYSTEMS_DATA[0].adjacent)).toBe(true);
    expect(SYSTEMS_DATA).toEqual(SYSTEMS);
  });
});
