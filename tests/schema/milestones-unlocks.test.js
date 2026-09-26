import { describe, it, expect } from "vitest";
import { LEVEL_UNLOCK_KEYS, MAX_DEFINED_LEVEL, MILESTONE_LEVELS, unknownUnlockKeys } from "../../server/game/catalog.js";
import { UNLOCK_APPLIERS, evaluateLevelProgress, levelReachedNotices } from "../../server/game/progression.js";
import { BASE_MAX_DEPLOYMENTS } from "../../server/game/asteroids.js";
import { createStarterCorporationState } from "../../server/game/corporation.js";
import { normalizeStateShape } from "../../server/game/shape.js";
import { getSeedState } from "../../server/game/world.js";

// ISP-104 (AB#796): a level may only unlock what something applies. A key nothing applied used to be ignored in
// silence (AB#586): a reward the player earned and never got.
describe("level unlock keys (AB#796)", () => {
  it("every level names only keys in the exported allowlist", () => {
    expect(unknownUnlockKeys(MILESTONE_LEVELS)).toEqual([]);
    for (const level of MILESTONE_LEVELS) for (const key of Object.keys(level.unlocks || {})) expect(LEVEL_UNLOCK_KEYS, `level ${level.level}`).toContain(key);
  });

  it("a key outside the allowlist is caught, naming the level", () => {
    expect(unknownUnlockKeys([{ level: 11, unlocks: { employeeCap: 250, maxProbes: 12 } }])).toEqual(["level 11: maxProbes"]);
  });

  it("the allowlist includes maxUpgradeTier, and every key has exactly one applier", () => {
    expect(LEVEL_UNLOCK_KEYS).toContain("maxUpgradeTier");
    expect(Object.keys(UNLOCK_APPLIERS).sort()).toEqual([...LEVEL_UNLOCK_KEYS].sort());
  });

  it("every key a level grants has a player-facing label in the level notice", () => {
    const top = Math.max(...MILESTONE_LEVELS.map((l) => l.level));
    const notices = levelReachedNotices({ level: 0, employeeCap: 8, buildingSlots: 2, maxFleetSize: 0, marketSectors: [] }, { level: top, unlockedTech: [] });
    for (const n of notices) for (const u of n.unlocks) expect(u.label, `level ${n.level}: ${u.key}`).not.toBe(u.key);
  });
});

// ISP-311 (AB#2307): a level's maxDeployments raises the concurrent expedition slots the launch route checks
// (docs/design/ladder-11-40.md proposes it for levels 12, 24 and 33).
describe("the maxDeployments unlock (AB#2307)", () => {
  it("raises the deployment cap, and a later level granting nothing or less never lowers it", () => {
    const corp = { unlocks: {} };
    UNLOCK_APPLIERS.maxDeployments(corp, 2);
    expect(corp.asteroidMining.maxDeployments).toBe(2);
    // A later level with no maxDeployments key applies nothing; one with a smaller value leaves the larger.
    UNLOCK_APPLIERS.maxDeployments(corp, 1);
    expect(corp.asteroidMining.maxDeployments).toBe(2);
    UNLOCK_APPLIERS.maxDeployments(corp, 3);
    expect(corp.asteroidMining.maxDeployments).toBe(3);
  });

  it("a corporation below Level 12 keeps BASE_MAX_DEPLOYMENTS, and Level 12 grants a second slot (AB#800)", () => {
    expect(BASE_MAX_DEPLOYMENTS).toBe(1);
    const at = (level) => {
      const state = createStarterCorporationState(normalizeStateShape(getSeedState()), "Test CEO", "Test Corp"); // as registering builds it
      state.corp.level = level;
      evaluateLevelProgress(state);
      evaluateLevelProgress(state);
      return state.corp.asteroidMining.maxDeployments;
    };
    expect(at(10)).toBe(BASE_MAX_DEPLOYMENTS); // levels 1 to 10 grant none
    expect(at(11)).toBe(BASE_MAX_DEPLOYMENTS); // Level 11 names 1, the base
    expect(at(12)).toBe(2);
    expect(at(MAX_DEFINED_LEVEL)).toBe(2);
  });

  it("the level notice names the raised cap as the expedition panel does", () => {
    const levels = [{ level: 11, unlocks: { employeeCap: 250 } }, { level: 12, unlocks: { maxDeployments: 2 } }, { level: 13, unlocks: {} }];
    const notices = levelReachedNotices({ level: 10, employeeCap: 200, buildingSlots: 6, maxFleetSize: 0, marketSectors: [] }, { level: 13, unlockedTech: [] }, levels);
    expect(notices.map((n) => n.unlocks)).toEqual([
      [{ key: "employeeCap", label: "Employee cap", value: "250" }],
      [{ key: "maxDeployments", label: "Deployment slots", value: "2" }],
      []
    ]);
  });
});

// ISP-108 (AB#800): levels 11 to 20 were added under corporations already saved at the old top, Level 10.
describe("a corporation saved at Level 10 before levels 11 to 20 existed (AB#800)", () => {
  it("loads at Level 10 with every unlock it had, and is shown Level 11's requirements", () => {
    const saved = createStarterCorporationState(normalizeStateShape(getSeedState()), "Test CEO", "Test Corp");
    saved.corp.level = 10;
    evaluateLevelProgress(saved);
    saved.corp.levelCap = 10; // what the save carried when 10 was the top
    const before = JSON.parse(JSON.stringify(saved.corp));
    expect(before.unlocks).toMatchObject({ maxFleetSize: 140, maxUpgradeTier: 5 });
    expect([before.employeeCap, before.buildingSlots]).toEqual([200, 12]);

    const loaded = normalizeStateShape(JSON.parse(JSON.stringify(saved))); // written to disk and read back
    evaluateLevelProgress(loaded);
    evaluateLevelProgress(loaded);
    const corp = loaded.corp;
    expect(corp.level).toBe(10); // Level 11's yards and Silicates are not met, and nothing is taken away
    expect(corp.levelCap).toBe(MAX_DEFINED_LEVEL);
    expect(corp.unlocks).toEqual(before.unlocks);
    for (const key of ["employeeCap", "buildingSlots", "maxFleetSize"]) expect(corp[key], key).toBe(before[key]);
    expect(corp.asteroidMining.maxDeployments).toBe(before.asteroidMining.maxDeployments);
    expect(corp.levelProgress.level11.requirements.map((r) => r.id)).toEqual(["extractor4", "mine225kSilicate"]);
  });
});
