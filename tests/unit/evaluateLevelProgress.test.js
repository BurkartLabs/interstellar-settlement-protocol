import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { evaluateLevelProgress } from "../../server/gameState.js";

const MILESTONES = JSON.parse(
  readFileSync(new URL("../../data/milestones.json", import.meta.url), "utf8")
);
const LEVELS = MILESTONES.levels;
const levelDef = (n) => LEVELS.find((l) => l.level === n);

// The shape createStarterCorporationState hands a new account (level 0).
function starterCorp() {
  return {
    level: 0,
    employeeCount: 0,
    employeeCap: 8,
    buildingSlots: 2,
    buildings: [{ id: "hq", name: "Corporate HQ" }],
    offices: [],
    miningLeases: [],
    unlockedTech: [],
    stats: {},
    milestonesCompleted: [],
    mining: { silicateExtractors: [] },
    unlocks: { marketSectors: [], maxUpgradeTier: 1, maxFleetSize: 0, maxBasicExtractorYards: 1 }
  };
}

// Make one milestones.json requirement true on the corp, the way play would.
function meet(corp, req) {
  const { metric, target } = req;
  if (metric === "stat:officeRented") {
    if (corp.offices.length === 0) corp.offices.push({ stationId: "earth-station-prime" });
  } else if (metric === "stat:miningLeasesCount") {
    while (corp.miningLeases.length < target) corp.miningLeases.push({ body: `Filler-${corp.miningLeases.length}` });
  } else if (metric.startsWith("stat:")) {
    const key = metric.slice(5);
    corp.stats[key] = Math.max(Number(corp.stats[key] || 0), target);
  } else if (metric === "employeeCount") {
    corp.employeeCount = Math.max(corp.employeeCount, target);
  } else if (metric.startsWith("miningLease:")) {
    const body = metric.slice(12);
    if (!corp.miningLeases.some((l) => l.body === body)) corp.miningLeases.push({ body });
  } else if (metric.startsWith("building-count:") || metric.startsWith("building:")) {
    const name = metric.slice(metric.indexOf(":") + 1);
    const want = metric.startsWith("building-count:") ? target : 1;
    while (corp.buildings.filter((b) => b.name === name).length < want) corp.buildings.push({ name });
  } else if (metric === "totalMined:silicate") {
    corp.mining.silicateExtractors = [{ totalMined: target }];
  } else if (metric.startsWith("unlockedTech:")) {
    const tech = metric.slice(13);
    if (!corp.unlockedTech.includes(tech)) corp.unlockedTech.push(tech);
  } else {
    throw new Error(`test fixture cannot meet metric ${metric}`);
  }
}

const meetLevel = (corp, n) => levelDef(n).requirements.forEach((r) => meet(corp, r));
const evaluate = (corp) => {
  const state = { corp };
  evaluateLevelProgress(state);
  return state.corp;
};

describe("evaluateLevelProgress", () => {
  it("leaves a starter corporation at level 0", () => {
    const corp = evaluate(starterCorp());
    expect(corp.level).toBe(0);
    expect(corp.unlocks.marketSectors).toEqual([]);
  });

  it("does not skip level 2 when level 3 is met first (AB#690 repro: Earth lease, no Mars)", () => {
    const corp = starterCorp();
    meetLevel(corp, 1);
    corp.miningLeases.push({ body: "Earth" });
    corp.buildings.push({ name: "Basic Extractor Yard" });
    meet(corp, { metric: "totalMined:silicate", target: 300 });
    meetLevel(corp, 3);

    evaluate(corp);
    expect(corp.levelProgress.level3.allCompleted).toBe(true);
    expect(corp.levelProgress.level2.allCompleted).toBe(false);
    expect(corp.level).toBe(1);
    expect(corp.milestonesCompleted).not.toContain("Reached Corporation Level 3");

    // Now lease Mars: level 2 completes, and the corp climbs 2 then 3 in one evaluation.
    corp.miningLeases.push({ body: "Mars" });
    evaluate(corp);
    expect(corp.level).toBe(3);
    expect(corp.unlocks.marketSectors).toEqual(["Raw Materials", "Logistics Services"]);
    expect(corp.milestonesCompleted).toEqual(
      expect.arrayContaining(["Reached Corporation Level 2", "Reached Corporation Level 3"])
    );
    expect(corp.employeeCap).toBe(levelDef(3).unlocks.employeeCap);
  });

  it("repairs a saved corporation that already skipped level 2, without demoting it", () => {
    // What the old loop left behind: level 3, level 1 and 3 grants, no Mars lease, nothing from level 2.
    const corp = starterCorp();
    meetLevel(corp, 1);
    meetLevel(corp, 3);
    corp.level = 3;
    corp.employeeCap = 45;
    corp.buildingSlots = 4;
    corp.unlocks.maxFleetSize = 22;
    corp.unlocks.marketSectors = ["Raw Materials"];
    corp.milestonesCompleted = ["Reached Corporation Level 1", "Reached Corporation Level 3"];

    evaluate(corp);
    expect(corp.levelProgress.level2.allCompleted).toBe(false);
    expect(corp.level).toBe(3);
    expect(corp.unlocks.marketSectors).toEqual(["Raw Materials", "Logistics Services"]);
    expect(corp.milestonesCompleted).toContain("Reached Corporation Level 2");
    expect(corp.employeeCap).toBe(45);
    expect(corp.buildingSlots).toBe(4);
    expect(corp.unlocks.maxFleetSize).toBe(22);
  });

  it("is idempotent: a second evaluation adds no duplicate tags or sectors", () => {
    const corp = starterCorp();
    meetLevel(corp, 1);
    meetLevel(corp, 2);
    evaluate(corp);
    const snapshot = JSON.stringify({ m: corp.milestonesCompleted, u: corp.unlocks, l: corp.level });
    evaluate(corp);
    expect(JSON.stringify({ m: corp.milestonesCompleted, u: corp.unlocks, l: corp.level })).toBe(snapshot);
  });

  // Sweep every level in the catalog (P-HALF-FIX): meeting 1..N lands on exactly N with every lower grant.
  for (const target of LEVELS.map((l) => l.level)) {
    it(`meeting levels 1..${target} in order lands on level ${target} with every lower level's grants`, () => {
      const corp = starterCorp();
      for (let n = 1; n <= target; n++) meetLevel(corp, n);
      evaluate(corp);
      expect(corp.level).toBe(target);
      const below = LEVELS.filter((l) => l.level <= target);
      const sectors = below.flatMap((l) => l.unlocks.marketSectors || []);
      expect(corp.unlocks.marketSectors).toEqual(sectors);
      for (const l of below) expect(corp.milestonesCompleted).toContain(`Reached Corporation Level ${l.level}`);
      expect(corp.employeeCap).toBe(Math.max(...below.map((l) => l.unlocks.employeeCap)));
    });
  }

  // Sweep every skippable level: meeting everything except level k's own requirements stops the climb at k-1.
  for (const k of LEVELS.map((l) => l.level).filter((n) => n >= 2)) {
    it(`a corporation that has not met level ${k} stops at level ${k - 1} even if later levels are met`, () => {
      const corp = starterCorp();
      for (let n = 1; n < k; n++) meetLevel(corp, n);
      evaluate(corp);
      expect(corp.level).toBe(k - 1);
      for (const l of LEVELS.filter((l) => l.level > k)) {
        // Only meet requirements that do not also satisfy level k (shared metrics, e.g. employeeCount).
        const kMetrics = new Set(levelDef(k).requirements.map((r) => r.metric));
        l.requirements.filter((r) => !kMetrics.has(r.metric)).forEach((r) => meet(corp, r));
      }
      evaluate(corp);
      expect(corp.levelProgress[`level${k}`].allCompleted).toBe(false);
      expect(corp.level).toBe(k - 1);
    });
  }
});
