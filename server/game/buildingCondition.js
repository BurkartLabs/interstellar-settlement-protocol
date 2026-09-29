// server/game/buildingCondition.js: a building's condition and what it does to its output (ISP-287, AB#994;
// docs/design/v0.10-raids-mercenaries.md, section 3). A raid the attacker wins takes condition from the buildings at
// the target station (server/raidResolution.js), never below its floor; a building's output is multiplied by
// condition / 100 until it is repaired (server/buildingRepair.js), which restores 100 at once. A building with no
// condition recorded has never been damaged: 100. Pure, so the mining and refining engines can read it.

/** A building's condition, 0 to 100; 100 when none is recorded. */
export function conditionOf(building) {
  const c = Number(building?.condition);
  return Number.isFinite(c) ? Math.min(100, Math.max(0, c)) : 100;
}

/** What a building's output is multiplied by while damaged: condition / 100 (an extractor at 80 condition mines 80%). */
export const outputFactorOf = (building) => conditionOf(building) / 100;

/** Whether the building has condition to repair. */
export const isDamaged = (building) => conditionOf(building) < 100;
