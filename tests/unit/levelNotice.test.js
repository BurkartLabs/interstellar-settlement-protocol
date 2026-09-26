import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { levelReachedNotices, evaluateLevelProgress, MAX_DEFINED_LEVEL } from "../../server/gameState.js";
import { makeCorp } from "../fixtures/makeCorp.js";

// Bug #1260: the text of each level's notice. Every figure comes from data/milestones.json, never a literal here.
const LEVELS = JSON.parse(fs.readFileSync(new URL("../../data/milestones.json", import.meta.url), "utf8")).levels;
const unlocks = (n) => LEVELS.find((l) => l.level === n).unlocks;
const starter = () => ({ level: 0, employeeCap: 8, buildingSlots: 2, maxFleetSize: 0, marketSectors: [] });

describe("what a level's notice says (Bug #1260)", () => {
  it("Level 1: its employee cap, building slots, fleet cap and market sector, from milestones.json", () => {
    const [notice, ...rest] = levelReachedNotices(starter(), { level: 1, unlockedTech: [] });
    expect(rest).toEqual([]);
    const u = unlocks(1);
    expect(notice).toEqual({
      type: "level",
      title: "Corporation Level 1",
      body:
        `Your corporation reached Level 1 of ${MAX_DEFINED_LEVEL}. Employee cap ${u.employeeCap}, building slots ${u.buildingSlots}, ` +
        `fleet cap ${u.maxFleetSize}. Market sector opened: ${u.marketSectors.join(", ")}.`,
      // AB#743: the same figures, one per unlock the level defines, for the milestone modal.
      level: 1,
      maxLevel: MAX_DEFINED_LEVEL,
      unlocks: [
        { key: "employeeCap", label: "Employee cap", value: String(u.employeeCap) },
        { key: "buildingSlots", label: "Building slots", value: String(u.buildingSlots) },
        { key: "maxFleetSize", label: "Fleet cap", value: String(u.maxFleetSize) },
        { key: "maxUpgradeTier", label: "Highest building tier", value: String(u.maxUpgradeTier) }, // AB#793
        { key: "marketSectors", label: "Market sectors opened", value: u.marketSectors.join(", ") }
      ]
    });
  });

  it("a jump of several levels is one notice per level, in order, each with the caps held once it is granted", () => {
    const notices = levelReachedNotices(starter(), { level: 3, unlockedTech: [] });
    expect(notices.map((n) => n.title)).toEqual(["Corporation Level 1", "Corporation Level 2", "Corporation Level 3"]);
    for (const [i, n] of [1, 2, 3].entries()) {
      const u = unlocks(n);
      expect(notices[i].body).toContain(`Employee cap ${u.employeeCap}, building slots ${u.buildingSlots}, fleet cap ${u.maxFleetSize}.`);
    }
    // A level that opens no sector says none.
    expect(unlocks(3).marketSectors).toEqual([]);
    expect(notices[2].body).not.toContain("Market sector");
  });

  it("nothing for a level unchanged or lower, and nothing for levels already held", () => {
    expect(levelReachedNotices({ ...starter(), level: 2 }, { level: 2, unlockedTech: [] })).toEqual([]);
    expect(levelReachedNotices({ ...starter(), level: 3 }, { level: 2, unlockedTech: [] })).toEqual([]);
    expect(levelReachedNotices({ ...starter(), level: 1 }, { level: 2, unlockedTech: [] }).map((n) => n.title)).toEqual(["Corporation Level 2"]);
  });

  it("the figures in the last notice are the ones the sidebar shows after the evaluation, Fleet Coordination included", () => {
    for (const unlockedTech of [[], ["tt-fleet-coordination"]]) {
      const corp = makeCorp({
        level: 0, milestonesCompleted: [], employeeCap: 8, buildingSlots: 2, unlocks: { maxFleetSize: 0, marketSectors: [] },
        offices: [{ stationId: "earth-station-prime" }], employeeCount: 5, unlockedTech
      });
      const before = { level: 0, employeeCap: 8, buildingSlots: 2, maxFleetSize: 0, marketSectors: [] };
      evaluateLevelProgress({ corp });
      expect(corp.level).toBe(1);
      const [notice] = levelReachedNotices(before, corp);
      // The sidebar: Employees x / employeeCap, Building Slots, Fleet Cap (corp.fleet.cap).
      expect(notice.body).toContain(`Employee cap ${corp.employeeCap}, building slots ${corp.buildingSlots}, fleet cap ${corp.fleet.cap}.`);
    }
  });
});
