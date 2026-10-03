import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ECONOMY } from "../../server/economy.js";
import { REPUTATION_TIERS_DATA } from "../../server/game/corporation.js";
import { normalizeStateShape } from "../../server/game/shape.js";
import { standingFor } from "../../server/receipts.js";
import { addStandingPoints, migrateStanding, tiersInPoints } from "../../public/scripts/bureauStanding.js";
import { standingGain } from "../../public/scripts/ceoEffects.js";

// AB#4689 slice 4: Bureau Standing as points (docs/design/desk-work.md section 4).

const FILE_TIERS = JSON.parse(fs.readFileSync(new URL("../../data/missions.json", import.meta.url), "utf8")).reputationTiers;
const M = ECONOMY.desk.reputationThresholdMultiplier;

describe("the reputation tiers in points", () => {
  it("are the file's thresholds times desk.reputationThresholdMultiplier, with the same titles", () => {
    expect(M).toBe(10);
    expect(REPUTATION_TIERS_DATA.thresholds).toEqual(FILE_TIERS.thresholds.map((t) => t * 10));
    expect(REPUTATION_TIERS_DATA.titles).toEqual(FILE_TIERS.titles);
    expect(REPUTATION_TIERS_DATA.contractPoints).toBe(ECONOMY.desk.contractPoints);
    expect(tiersInPoints({ thresholds: [0, 1, 3], titles: ["a", "b", "c"] }, 4).thresholds).toEqual([0, 4, 12]);
  });

  it("give every save the grade it had: a count of n contracts and n x 10 points are the same grade", () => {
    for (let n = 0; n <= 1200; n += 1) {
      expect(standingFor(migrateStanding({ completedCount: n }, M).points, REPUTATION_TIERS_DATA), `count ${n}`).toEqual(standingFor(n, FILE_TIERS));
    }
  });
});

describe("migrateStanding", () => {
  it("turns completedCount 7 into points 70, which is Reliable as it was", () => {
    const rep = migrateStanding({ completedCount: 7 }, M);
    expect(rep).toEqual({ completedCount: 7, points: 70 });
    expect(standingFor(rep.points, REPUTATION_TIERS_DATA).title).toBe("Reliable");
    expect(standingFor(7, FILE_TIERS).title).toBe("Reliable");
  });

  it("is idempotent, so a migrated save loaded again keeps its points", () => {
    const once = migrateStanding({ completedCount: 7 }, M);
    expect(migrateStanding(once, M)).toBe(once);
    expect(migrateStanding({ completedCount: 7, points: 95 }, M).points).toBe(95);
  });

  it("treats a missing or malformed record as no standing", () => {
    for (const rep of [undefined, null, {}, { completedCount: -3 }, { completedCount: "x" }]) expect(migrateStanding(rep, M).points).toBe(0);
  });

  it("migrates every agent when a save is shaped, and a shaped save shaped again is unchanged (a used save's round trip)", () => {
    const shaped = normalizeStateShape({ corp: { agentReputation: { "elara-voss": { completedCount: 7 }, other: { completedCount: 0 } } } });
    expect(shaped.corp.agentReputation["elara-voss"].points).toBe(70);
    expect(shaped.corp.agentReputation.other.points).toBe(0);
    const again = normalizeStateShape(JSON.parse(JSON.stringify(shaped)));
    expect(again.corp.agentReputation).toEqual(shaped.corp.agentReputation);
  });
});

describe("addStandingPoints and Bureaucratic Persuasion", () => {
  it("adds exactly 10 points a contract without the program", () => {
    const rep = { points: 70 };
    expect(addStandingPoints(rep, standingGain(ECONOMY.desk.contractPoints, []))).toBe(10);
    expect(rep.points).toBe(80);
  });

  it("adds 11 and 12 in turn with it: 15% of 10 is carried, not rounded away or invented", () => {
    const rep = { points: 0 };
    const gains = Array.from({ length: 6 }, () => addStandingPoints(rep, standingGain(10, ["ceo-bureaucratic-persuasion"])));
    expect(gains).toEqual([11, 12, 11, 12, 11, 12]);
    expect(rep.points).toBe(69);
    expect(rep.pointsCarry).toBeCloseTo(0, 9);
  });

  it("applies to any gain, a desk packet's included", () => {
    expect(standingGain(2, [])).toBe(2);
    expect(standingGain(2, ["ceo-bureaucratic-persuasion"])).toBeCloseTo(2.3, 12);
  });
});
