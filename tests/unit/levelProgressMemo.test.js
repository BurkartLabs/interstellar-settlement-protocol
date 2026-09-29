import { describe, it, expect } from "vitest";
import { evaluateLevelProgress, resolveMetric } from "../../server/game/progression.js";
import { MILESTONE_LEVELS } from "../../server/game/catalog.js";

// Bug #4850: evaluateLevelProgress reads each metric once per evaluation, however many levels name it. The memo must
// give every requirement exactly what resolveMetric gives, on a corporation with something in every kind of metric.
function busyCorp() {
  return {
    level: 3,
    employeeCount: 14,
    employeeCap: 45,
    buildingSlots: 4,
    buildings: [
      { id: "hq", name: "Corporate HQ" },
      { id: "b1", name: "Basic Extractor Yard", tier: 2 },
      { id: "b2", name: "Basic Extractor Yard", tier: 1 },
      { id: "b3", name: "Refinery", tier: 1, upgrades: ["Refinery Complex"] }
    ],
    offices: [{ stationId: "earth-station-prime" }],
    miningLeases: [{ body: "Earth" }, { body: "Luna" }],
    unlockedTech: ["tt-basic-extraction", "tt-industrial-safety"],
    stats: { silicateSoldOnExchange: 51_000, refinedUnitsProduced: 1_200, asteroidExpeditionsCompleted: 4, missionsCompletedTotal: 30 },
    completedMissions: [{ id: "m1" }],
    milestonesCompleted: [],
    mining: { silicateExtractors: [{ minedByItem: { Silicates: 120_000 } }, { totalMined: 5_000 }] },
    unlocks: { marketSectors: [], maxUpgradeTier: 2, maxFleetSize: 22 }
  };
}

describe("a metric read once per evaluation (Bug #4850)", () => {
  it("gives every requirement of every level exactly what resolveMetric gives", () => {
    const corp = busyCorp();
    evaluateLevelProgress({ corp });
    let checked = 0;
    for (const level of MILESTONE_LEVELS) {
      for (const req of corp.levelProgress[`level${level.level}`].requirements) {
        expect(req.progress, `${req.id} (${req.metric})`).toBe(resolveMetric(req.metric, busyCorp()));
        checked += 1;
      }
    }
    expect(checked).toBe(MILESTONE_LEVELS.reduce((n, l) => n + l.requirements.length, 0));
  });

  it("reads again on the next evaluation: nothing is carried from one call to the next", () => {
    const corp = busyCorp();
    evaluateLevelProgress({ corp });
    const before = corp.levelProgress.level2.requirements.find((r) => r.metric === "totalMined:silicate").progress;
    corp.mining.silicateExtractors[0].minedByItem.Silicates += 1_000;
    evaluateLevelProgress({ corp });
    expect(corp.levelProgress.level2.requirements.find((r) => r.metric === "totalMined:silicate").progress).toBe(before + 1_000);
  });
});
