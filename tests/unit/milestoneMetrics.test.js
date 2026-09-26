import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { resolveMetric, COUNTED_STATS } from "../../server/game/progression.js";
import { MILESTONE_LEVELS, MILESTONE_ROADMAP, MINEABLE_RESOURCES, deriveRoadmap } from "../../server/game/catalog.js";
import { applyAsteroidExpeditions, getStationInventory } from "../../server/gameState.js";

// ISP-106 (AB#798): the roadmap is derived from the levels, and the metric kinds levels 11 to 40 need
// (docs/design/ladder-11-40.md) resolve; an unknown metric is loud, not a silent 0.
const yard = (tier = 1) => ({ name: "Basic Extractor Yard", tier, status: "Operational" });

describe("the milestone roadmap (AB#798)", () => {
  it("is no longer a hand-written array in data/milestones.json", () => {
    const raw = JSON.parse(fs.readFileSync(new URL("../../data/milestones.json", import.meta.url), "utf8"));
    expect(raw.roadmap).toBeUndefined();
  });

  it("is each level's requirement titles then its tag, for levels 1 to 20 (derived; snapshot)", () => {
    expect(MILESTONE_ROADMAP).toEqual(deriveRoadmap(MILESTONE_LEVELS));
    // Recorded from the levels. Level 6 is the Assembly Facility and level 7 asteroid prospecting, because that is
    // what those levels require; the old hand-written list named an earlier plan (Ferric and Refinery Complexes,
    // cryo-vapor, belt mining) that no level requires, and none of it is recorded here.
    expect(MILESTONE_ROADMAP).toMatchInlineSnapshot(`
      [
        "Rent an Office",
        "Hire 5 Employees",
        "Reached Corporation Level 1",
        "Purchase a Mining Lease",
        "Build a Basic Extractor Yard",
        "Mine 300 Silicate",
        "Reached Corporation Level 2",
        "Sell 300 Silicate on the Galactic Exchange",
        "Research Basic Extraction Analytics",
        "Reached Corporation Level 3",
        "Build a Second Extractor Yard",
        "Hire 10 Employees",
        "Research Industrial Safety Protocols",
        "Sell 50,000 Silicate",
        "Reached Corporation Level 4",
        "Research High-Density Energy Routing",
        "Purchase a Second Mining Lease",
        "Build a Third Extractor Yard",
        "Hire 15 Employees",
        "Reached Corporation Level 5",
        "Research Assembly & Fabrication Systems",
        "Build an Assembly Facility",
        "Hire 25 Employees",
        "Reached Corporation Level 6",
        "Research Asteroid Prospecting Arrays",
        "Complete 3 Asteroid Expeditions",
        "Reached Corporation Level 7",
        "Research Material Compression I",
        "Build a Refinery",
        "Complete 25 Missions",
        "Reached Corporation Level 8",
        "Research Nano-Lattice Weaving",
        "Refine 1,000 Units of Goods",
        "Purchase a Mining Claim on Luna",
        "Reached Corporation Level 9",
        "Research Near-Star Navigation Array",
        "Complete 10 Asteroid Expeditions",
        "Refine 2,000 Units of Goods",
        "Sell 100,000 Silicate",
        "Reached Corporation Level 10",
        "Build a Fourth Extractor Yard",
        "Mine 260,000 Silicate",
        "Reached Corporation Level 11",
        "Upgrade 3 Extractor Yards to Tier 2",
        "Mine 470,000 Silicate",
        "Reached Corporation Level 12",
        "Build a Fifth Extractor Yard",
        "Purchase a Third Mining Lease",
        "Mine 700,000 Silicate",
        "Reached Corporation Level 13",
        "Upgrade 6 Extractor Yards to Tier 2",
        "Mine 920,000 Silicate",
        "Reached Corporation Level 14",
        "Build a Sixth Extractor Yard",
        "Upgrade 3 Extractor Yards to Tier 3",
        "Mine 1,100,000 Silicate",
        "Reached Corporation Level 15",
        "Build a Second Refinery",
        "Refine 25,800 Units of Goods",
        "Reached Corporation Level 16",
        "Upgrade a Refinery to a Refinery Complex",
        "Refine 34,800 Units of Goods",
        "Reached Corporation Level 17",
        "Research Containment Physics",
        "Refine 44,800 Units of Goods",
        "Reached Corporation Level 18",
        "Upgrade 6 Extractor Yards to Tier 3",
        "Refine 55,800 Units of Goods",
        "Reached Corporation Level 19",
        "Upgrade a Refinery to Tier 3",
        "Refine 65,800 Units of Goods",
        "Reached Corporation Level 20",
      ]
    `);
    for (const stale of ["Build a Ferric Mining Complex", "Build a Refinery Complex", "Build a Cryo-vapor Extractor Array", "Start a Belt Mining Operation"]) expect(MILESTONE_ROADMAP).not.toContain(stale);
  });

  it("every metric in the file resolves without the resolver refusing it", () => {
    for (const level of MILESTONE_LEVELS) for (const r of level.requirements) expect(() => resolveMetric(r.metric, {}), `level ${level.level}: ${r.metric}`).not.toThrow();
  });
});

describe("the new metric kinds (AB#798)", () => {
  it("building-tier:<id>:<n> counts that building at tier n or above", () => {
    const corp = { buildings: [yard(1), yard(3), yard(5), { name: "Refinery", tier: 3 }] };
    expect(resolveMetric("building-tier:basic-extractor-yard:3", corp)).toBe(2);
    expect(resolveMetric("building-tier:basic-extractor-yard:6", corp)).toBe(0);
    expect(resolveMetric("building-tier:refinery:3", corp)).toBe(1);
    expect(resolveMetric("building-tier:refinery:3", { buildings: [{ name: "Refinery" }] })).toBe(0); // no tier is tier 1
  });

  it("totalMined:<resource> counts what expeditions deposited; silicate still counts the yards", () => {
    expect(resolveMetric("totalMined:nickel", { stats: { "mined:Nickel": 1200 } })).toBe(1200);
    expect(resolveMetric("totalMined:Nickel", { stats: {} })).toBe(0);
    expect(resolveMetric("totalMined:silicate", { mining: { silicateExtractors: [{ totalMined: 300 }] } })).toBe(300);
    expect(COUNTED_STATS).toEqual(expect.arrayContaining(MINEABLE_RESOURCES.map((r) => `mined:${r}`)));
  });

  it("stat:missionsCompleted counts past the 200-mission window", () => {
    const window = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}` }));
    expect(resolveMetric("stat:missionsCompleted", { completedMissions: window, stats: { missionsCompletedTotal: 451 } })).toBe(451);
    expect(resolveMetric("stat:missionsCompleted", { completedMissions: window.slice(0, 30), stats: {} })).toBe(30); // an old save
  });

  it("throws on a metric it does not know, instead of counting it 0", () => {
    for (const metric of ["buildingz:Refinery", "totalMined:unobtainium", "building-tier:no-such-building:2", "building-tier:refinery:0", "stat:notACounter"]) {
      expect(() => resolveMetric(metric, {}), metric).toThrow(/does not know/);
    }
  });
});

describe("the counters behind them (AB#798)", () => {
  it("a returning expedition counts each resource it deposits under mined:<resource>", () => {
    const now = Date.now();
    const corp = { currentStationId: "earth-station-prime", stats: {}, asteroidMining: { probeCount: 0, activeExpeditions: [{ id: "exp-798", beltKey: "sol:belt", systemId: "sol", duration: "standard", deployedAt: now - 3_600_000, lastTickAt: now - 3_600_000, completesAt: now - 1, yields: { Nickel: 40 }, status: "active" }], completedExpeditions: [], fabricationQueue: [] } };
    applyAsteroidExpeditions(corp, now);
    const deposited = corp.asteroidMining.completedExpeditions[0]?.yields || {};
    expect(Object.keys(deposited).length).toBeGreaterThan(0);
    for (const [resource, qty] of Object.entries(deposited)) expect(corp.stats[`mined:${resource}`], resource).toBe(qty);
  });
});
