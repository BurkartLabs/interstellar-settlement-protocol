import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import {
  evaluateLevelProgress, bumpStat, STAT_KEYS, PLAYER_BUILDINGS, MAX_DEFINED_LEVEL,
  applyRefineryOperations, applyAsteroidExpeditions, REFINERY_CHAINS, BELT_COMPOSITIONS
} from "../../server/gameState.js";
import { PLAYER_BUILDING_CATALOGUE } from "../../server/playerBuildings.js";
import { CONSTRUCTIONS } from "../../server/construction.js";
import { makeCorp } from "../fixtures/makeCorp.js";
import { serverCode } from "../helpers/serverSource.js";
import { clientCode } from "../helpers/clientSource.js";

// Bug #424: progression stopped at Level 5. The ladder now names only what the build contains, and the counters
// levels 6 to 10 read are kept.
const ALL_RESEARCH = JSON.parse(fs.readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes.map((t) => t.id);
// Fixtures carry the fields a real corporation starts with (milestonesCompleted, caps, unlocks), which the starter
// state and the load-time normaliser provide in the game.
const buildingsNamed = (...names) => names.map((name) => ({ name }));
const climb = (corp) => {
  const state = { corp };
  for (let i = 0; i < 12; i++) evaluateLevelProgress(state);
  return corp;
};

describe("the level ladder can be climbed to its top (Bug #424)", () => {
  it("defines 20 levels, and the cap a player sees is that, not 40", () => {
    expect(MAX_DEFINED_LEVEL).toBe(20); // ISP-108 (AB#800): levels 11 to 20
    const state = { corp: makeCorp({ milestonesCompleted: [], employeeCap: 8, buildingSlots: 2, unlocks: { maxFleetSize: 0, marketSectors: [] },  levelCap: 40, level: 0 }) };
    evaluateLevelProgress(state);
    expect(state.corp.levelCap).toBe(20);
  });

  it("a corporation that has done everything each level asks reaches Level 10", () => {
    const corp = climb(makeCorp({ milestonesCompleted: [], employeeCap: 8, buildingSlots: 2, unlocks: { maxFleetSize: 0, marketSectors: [] }, 
      level: 0, employeeCount: 25, offices: [{ stationId: "earth-station-prime" }],
      unlockedTech: ALL_RESEARCH,
      buildings: buildingsNamed("Basic Extractor Yard", "Basic Extractor Yard", "Basic Extractor Yard", "Assembly Facility", "Refinery"),
      miningLeases: [{ body: "Mars" }, { body: "Luna" }],
      mining: { silicateExtractors: [{ totalMined: 1000 }] },
      completedMissions: Array.from({ length: 25 }, (_, i) => ({ id: `m${i}` })),
      stats: { silicateSoldOnExchange: 100000, refinedUnitsProduced: 10000, asteroidExpeditionsCompleted: 10 }
    }));
    expect(corp.level).toBe(10);
  });

  it("stops where a requirement is short: 16 of 25 missions holds a corporation at Level 7", () => {
    const corp = climb(makeCorp({ milestonesCompleted: [], employeeCap: 8, buildingSlots: 2, unlocks: { maxFleetSize: 0, marketSectors: [] }, 
      level: 0, employeeCount: 25, offices: [{}],
      unlockedTech: ["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast", "tt-energy-routing", "tt-assembly-fabrication", "tt-asteroid-prospecting", "tt-material-compression"],
      buildings: buildingsNamed("Basic Extractor Yard", "Basic Extractor Yard", "Basic Extractor Yard", "Assembly Facility", "Refinery"),
      miningLeases: [{ body: "Mars" }, { body: "Earth" }],
      mining: { silicateExtractors: [{ totalMined: 1000 }] },
      completedMissions: Array.from({ length: 16 }, (_, i) => ({ id: `m${i}` })),
      stats: { silicateSoldOnExchange: 50000, asteroidExpeditionsCompleted: 3 }
    }));
    expect(corp.level).toBe(7);
  });
});

describe("statistics are kept through one helper (Bug #424)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bumpStat adds to a known statistic and refuses one nobody reads", () => {
    const corp = makeCorp({ milestonesCompleted: [], employeeCap: 8, buildingSlots: 2, unlocks: { maxFleetSize: 0, marketSectors: [] }, });
    bumpStat(corp, "refinedUnitsProduced", 55);
    bumpStat(corp, "refinedUnitsProduced", 5);
    expect(corp.stats.refinedUnitsProduced).toBe(60);
    expect(() => bumpStat(corp, "madeUpStat", 1)).toThrow(/madeUpStat/);
  });

  it("lists the statistics and buildings the ladder may name", () => {
    expect(STAT_KEYS).toEqual(expect.arrayContaining(["officeRented", "miningLeasesCount", "missionsCompleted", "silicateSoldOnExchange", "refinedUnitsProduced", "asteroidExpeditionsCompleted"]));
    expect([...PLAYER_BUILDINGS].sort()).toEqual(["Assembly Facility", "Basic Extractor Yard", "Cryo-vapor Extractor Array", "Ferric Mining Complex", "Refinery", "Refinery Complex"]);
  });

  it("counts refined units when a refinery cycle completes", () => {
    const start = 1_700_000_000_000;
    const chainId = Object.keys(REFINERY_CHAINS)[0];
    const corp = makeCorp({ milestonesCompleted: [], employeeCap: 8, buildingSlots: 2, unlocks: { maxFleetSize: 0, marketSectors: [] }, 
      currentStationId: "earth-station-prime",
      refineries: [{ id: "ref-1", active: true, chainId, startedAt: start, endsAt: start + 60_000, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0 }]
    });
    applyRefineryOperations(corp, start + 60_001);
    expect(corp.stats.refinedUnitsProduced).toBeGreaterThan(0);
    expect(corp.stats.refinedUnitsProduced).toBe(corp.refineries[0].totalOutputProduced);
  });

  it("counts an asteroid expedition when it completes", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const start = 1_700_000_000_000;
    const corp = makeCorp({ milestonesCompleted: [], employeeCap: 8, buildingSlots: 2, unlocks: { maxFleetSize: 0, marketSectors: [] }, 
      currentStationId: "earth-station-prime",
      asteroidMining: {
        probeCount: 0, maxProbes: 2, completedExpeditions: [],
        activeExpeditions: [{ id: "exp-1", status: "active", beltKey: Object.keys(BELT_COMPOSITIONS)[0], systemId: "sol",
          duration: "standard", deployedAt: start, lastTickAt: start, completesAt: start + 60_000, yields: {} }]
      }
    });
    applyAsteroidExpeditions(corp, start + 60_001);
    expect(corp.stats.asteroidExpeditionsCompleted).toBe(1);
  });

  it("counts missions completed from the completed-missions list", () => {
    const corp = climb(makeCorp({ milestonesCompleted: [], employeeCap: 8, buildingSlots: 2, unlocks: { maxFleetSize: 0, marketSectors: [] },  completedMissions: [{ id: "a" }, { id: "b" }] }));
    const requirement = Object.values(corp.levelProgress).flatMap((p) => p?.requirements || []).find((r) => r.id === "missions25");
    expect(requirement?.progress).toBe(2);
  });
});

describe("the lists match the code that keeps them (Bug #424)", () => {
  const index = serverCode(); // AB#1815: server/index.js and the route modules it was split into
  // AB#737: the game state is split by system into server/game/*.js behind server/gameState.js; read all of it.
  const gameDir = new URL("../../server/game/", import.meta.url);
  const gameState = [fs.readFileSync(new URL("../../server/gameState.js", import.meta.url), "utf8"), ...fs.readdirSync(gameDir).sort().map((f) => fs.readFileSync(new URL(f, gameDir), "utf8"))].join("\n");

  it("every building a construction route adds is a player building, and each one is added somewhere", () => {
    // ISP-94 (AB#784): one build path adds every building, under its catalogue name (server/construction.js). A name
    // written out in a push anywhere in the server would be a building outside the catalogue.
    const named = [...index.matchAll(/buildings\.push\(\{\s*name:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(named).toEqual([]);
    const construction = fs.readFileSync(new URL("../../server/construction.js", import.meta.url), "utf8");
    expect(construction).toMatch(/buildings\.push\(\{ name: building\.name,/);
    const buildable = PLAYER_BUILDING_CATALOGUE.filter((b) => CONSTRUCTIONS[b.id]).map((b) => b.name);
    expect(buildable.sort()).toEqual([...PLAYER_BUILDINGS].sort());
  });

  it("every requirement can be clicked through to its tab, and the map names no requirement that no longer exists", () => {
    const app = clientCode(); // AB#739: REQ_TAB is in views/overview.js now
    const map = app.slice(app.indexOf("const REQ_TAB = {"), app.indexOf("};", app.indexOf("const REQ_TAB = {")));
    const mapped = new Set([...map.matchAll(/^\s+(\w+):\s+"\w+"/gm)].map((m) => m[1]));
    const ids = JSON.parse(fs.readFileSync(new URL("../../data/milestones.json", import.meta.url), "utf8")).levels.flatMap((l) => l.requirements.map((r) => r.id));
    expect(ids.filter((id) => !mapped.has(id))).toEqual([]);
    expect([...mapped].filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("every statistic written straight into corp.stats is one the ladder may name", () => {
    const written = [...`${index}\n${gameState}`.matchAll(/\.stats\.(\w+)\s*=/g)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((k) => !STAT_KEYS.includes(k))).toEqual([]);
  });
});
