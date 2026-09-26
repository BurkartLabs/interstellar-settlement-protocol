import { describe, it, expect } from "vitest";
import { LEVEL_UNLOCK_KEYS, MILESTONE_LEVELS, unknownUnlockKeys } from "../../server/game/catalog.js";
import { UNLOCK_APPLIERS, levelReachedNotices } from "../../server/game/progression.js";

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
