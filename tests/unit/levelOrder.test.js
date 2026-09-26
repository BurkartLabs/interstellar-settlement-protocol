import { describe, it, expect } from "vitest";
import { evaluateLevelProgress } from "../../server/game/progression.js";
import { createStarterCorporationState } from "../../server/game/corporation.js";
import { getSeedState } from "../../server/game/world.js";
import { normalizeStateShape } from "../../server/game/shape.js";
import { MILESTONE_LEVELS } from "../../server/game/catalog.js";

// ISP-104 (AB#796): levels are granted strictly in order, each with its unlocks, and nothing is ever lowered.
const yard = { name: "Basic Extractor Yard", tier: 1, status: "Operational" };
const unlocksOf = (n) => MILESTONE_LEVELS.find((l) => l.level === n).unlocks;

/** A corporation that meets every requirement of levels 1 to 5 and of level 7, but not level 6's. */
function metFiveAndSeven() {
  const state = createStarterCorporationState(normalizeStateShape(getSeedState()), "Order CEO", "Order Corp");
  const corp = state.corp;
  corp.offices = [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 86_400_000 }];
  corp.employeeCount = 15; // level 6 asks for 25
  corp.miningLeases = [{ id: "l1", body: "Earth" }, { id: "l2", body: "Mars" }];
  corp.buildings = [...corp.buildings, yard, yard, yard];
  corp.mining.silicateExtractors = [{ id: "e1", totalMined: 300 }];
  corp.stats = { ...(corp.stats || {}), silicateSoldOnExchange: 50_000, asteroidExpeditionsCompleted: 3 };
  corp.unlockedTech = ["tt-basic-extraction", "tt-industrial-safety", "tt-energy-routing", "tt-asteroid-prospecting"]; // not tt-assembly-fabrication
  return state;
}

describe("levels are granted in order (AB#796)", () => {
  it("meeting level 7 but not level 6 stops at level 5", () => {
    const state = metFiveAndSeven();
    evaluateLevelProgress(state);
    expect(state.corp.levelProgress.level7.allCompleted).toBe(true);
    expect(state.corp.levelProgress.level6.allCompleted).toBe(false);
    expect(state.corp.level).toBe(5);
    expect(state.corp.unlocks.maxUpgradeTier).toBe(unlocksOf(5).maxUpgradeTier);
  });

  it("meeting both grants 6 then 7 in the same evaluation, each with its unlocks applied", () => {
    const state = metFiveAndSeven();
    evaluateLevelProgress(state);
    Object.assign(state.corp, { employeeCount: 25, unlockedTech: [...state.corp.unlockedTech, "tt-assembly-fabrication"], buildings: [...state.corp.buildings, { name: "Assembly Facility", tier: 1, status: "Operational" }] });
    evaluateLevelProgress(state);
    expect(state.corp.level).toBe(7);
    expect(state.corp.milestonesCompleted).toEqual(expect.arrayContaining(["Reached Corporation Level 6", "Reached Corporation Level 7"]));
    const [six, seven] = [unlocksOf(6), unlocksOf(7)];
    expect(state.corp.employeeCap).toBe(Math.max(six.employeeCap, seven.employeeCap));
    expect(state.corp.buildingSlots).toBeGreaterThanOrEqual(seven.buildingSlots);
    expect(state.corp.unlocks.maxFleetSize).toBe(seven.maxFleetSize);
    expect(state.corp.unlocks.maxUpgradeTier).toBe(seven.maxUpgradeTier);
    for (const sector of [...(six.marketSectors || []), ...(seven.marketSectors || [])]) expect(state.corp.unlocks.marketSectors).toContain(sector);
  });

  it("never lowers a value the corporation already has", () => {
    const state = metFiveAndSeven();
    Object.assign(state.corp, { employeeCap: 999, buildingSlots: 50 });
    state.corp.unlocks = { ...state.corp.unlocks, maxFleetSize: 500, maxUpgradeTier: 5, marketSectors: ["Sovereign Infrastructure"] };
    evaluateLevelProgress(state);
    evaluateLevelProgress(state);
    expect(state.corp.employeeCap).toBe(999);
    expect(state.corp.buildingSlots).toBe(50);
    expect(state.corp.unlocks.maxFleetSize).toBe(500);
    expect(state.corp.unlocks.maxUpgradeTier).toBe(5);
    expect(state.corp.unlocks.marketSectors).toContain("Sovereign Infrastructure");
  });
});
