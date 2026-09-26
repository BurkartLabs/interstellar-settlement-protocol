import { describe, it, expect } from "vitest";
import { MILESTONE_LEVELS } from "../../server/game/catalog.js";
import { createStarterCorporationState } from "../../server/game/corporation.js";
import { evaluateLevelProgress } from "../../server/game/progression.js";
import { normalizeStateShape } from "../../server/game/shape.js";
import { getSeedState } from "../../server/game/world.js";

// AB#2312 (the Director's ruling): Level 10 asked for 10,000 refined units, 27 days of one Refinery's 330 a day past
// Level 9, so the check-in bot reached it at day 56.6 against the design's day 30. It now asks for 2,000. A corporation
// saved at Level 10 under the old data keeps its level and everything the level granted.
const level10 = MILESTONE_LEVELS.find((l) => l.level === 10);

function corporation(changes) {
  const state = createStarterCorporationState(normalizeStateShape(getSeedState()), "Test CEO", "Test Corp");
  Object.assign(state.corp, changes);
  return state;
}

describe("Level 10's refining requirement (AB#2312)", () => {
  it("asks for 2,000 refined units, and the rest of Level 10 is as it was", () => {
    expect(level10.requirements.map((r) => [r.id, r.metric, r.target])).toEqual([
      ["researchNearStarNavigation", "unlockedTech:tt-proxima-navigation", 1],
      ["expeditions10", "stat:asteroidExpeditionsCompleted", 10],
      ["refine2000", "stat:refinedUnitsProduced", 2000],
      ["sell100000Silicate", "stat:silicateSoldOnExchange", 100000]
    ]);
    expect(level10.unlocks).toEqual({ employeeCap: 200, buildingSlots: 12, maxFleetSize: 140, maxUpgradeTier: 5, marketSectors: ["Sovereign Infrastructure"] });
  });

  it("a corporation saved at Level 10 under the old data keeps its level, its unlocks and its record", () => {
    const state = corporation({
      level: 10,
      employeeCap: 200,
      buildingSlots: 12,
      unlocks: { maxFleetSize: 140, maxUpgradeTier: 5, marketSectors: ["Military Contracts", "Sovereign Infrastructure"] },
      unlockedTech: ["tt-proxima-navigation"],
      stats: { refinedUnitsProduced: 10_000, asteroidExpeditionsCompleted: 10, silicateSoldOnExchange: 100_000 },
      milestonesCompleted: ["Refine 10,000 Units of Goods", "Reached Corporation Level 10"]
    });
    evaluateLevelProgress(state);
    const c = state.corp;
    expect(c.level).toBe(10);
    expect([c.employeeCap, c.buildingSlots, c.unlocks.maxFleetSize, c.unlocks.maxUpgradeTier]).toEqual([200, 12, 140, 5]);
    expect(c.unlocks.marketSectors).toEqual(expect.arrayContaining(["Military Contracts", "Sovereign Infrastructure"]));
    expect(c.levelProgress.level10.allCompleted).toBe(true);
    expect(c.milestonesCompleted).toEqual(expect.arrayContaining(["Refine 2,000 Units of Goods", "Reached Corporation Level 10"]));
  });

  it("a Level 10 save whose refining is below the new target still keeps its level", () => {
    const state = corporation({ level: 10, stats: { refinedUnitsProduced: 1_500 } });
    evaluateLevelProgress(state);
    expect(state.corp.level).toBe(10);
    expect(state.corp.employeeCap).toBe(200);
  });

  it("a Level 9 corporation with everything else met reaches Level 10 at 2,000 refined, not 10,000", () => {
    const state = corporation({
      level: 9,
      unlockedTech: ["tt-proxima-navigation"],
      stats: { refinedUnitsProduced: 1_999, asteroidExpeditionsCompleted: 10, silicateSoldOnExchange: 100_000 }
    });
    evaluateLevelProgress(state);
    expect(state.corp.level).toBe(9);
    state.corp.stats.refinedUnitsProduced = 2_000;
    evaluateLevelProgress(state);
    expect(state.corp.level).toBe(10);
    expect(state.corp.employeeCap).toBe(200);
  });
});
