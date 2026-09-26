import { describe, it, expect } from "vitest";
import { levelPanelView } from "../../public/scripts/levelPanel.js";
import { LEVEL_UNLOCK_KEYS, MAX_DEFINED_LEVEL, MILESTONE_LEVELS } from "../../server/game/catalog.js";
import { UNLOCK_LABELS, evaluateAccountLevel, levelUnlockList } from "../../server/game/progression.js";
import { createStarterCorporationState } from "../../server/game/corporation.js";
import { normalizeStateShape } from "../../server/game/shape.js";
import { getSeedState } from "../../server/game/world.js";

// ISP-111 (AB#803): the Overview's level panel. The top of the ladder comes from the data, never a literal 40, and one
// level is shown at a time.
const ladder = Array.from({ length: 12 }, (_, i) => ({ level: i + 1, unlocks: [{ key: "employeeCap", label: "Employee cap", value: String(20 * (i + 1)) }] }));
const progress = Object.fromEntries(ladder.map((l) => [`level${l.level}`, { requirements: [{ id: `r${l.level}`, title: `Do ${l.level}`, progress: 1, target: 2, complete: false }] }]));

describe("the level panel's view (AB#803)", () => {
  it("says the level out of the data's top: a 12-level fixture is 'of 12', and the server's cap wins when sent", () => {
    expect(levelPanelView({ level: 3, ladder }).max).toBe(12);
    expect(levelPanelView({ level: 3, levelCap: 10, ladder }).max).toBe(10);
  });

  it("shows the next level by default, with its requirements and what it unlocks", () => {
    const v = levelPanelView({ level: 3, ladder, levelProgress: progress });
    expect(v).toMatchObject({ shown: 4, state: "next", isDefault: true, prev: 3, next: 5 });
    expect(v.requirements.map((r) => r.id)).toEqual(["r4"]);
    expect(v.unlocks).toEqual([{ key: "employeeCap", label: "Employee cap", value: "80" }]);
  });

  it("browses one level at a time, reached or ahead, and stays within 1 and the top", () => {
    expect(levelPanelView({ level: 3, ladder, browse: 2 })).toMatchObject({ shown: 2, state: "reached", isDefault: false });
    expect(levelPanelView({ level: 3, ladder, browse: 9 })).toMatchObject({ shown: 9, state: "ahead", next: 10 });
    expect(levelPanelView({ level: 3, ladder, browse: 40 })).toMatchObject({ shown: 12, next: null });
    expect(levelPanelView({ level: 3, ladder, browse: 0 })).toMatchObject({ shown: 1, prev: null });
  });

  it("at the top it shows the top level as reached, not a level that does not exist", () => {
    expect(levelPanelView({ level: 12, ladder })).toMatchObject({ atTop: true, shown: 12, state: "reached", next: null, isDefault: true });
  });

  it("a level 0 corporation is shown Level 1 as next", () => {
    expect(levelPanelView({ level: 0, ladder })).toMatchObject({ shown: 1, state: "next", prev: null });
  });
});

describe("what the server sends the panel (AB#803)", () => {
  it("every unlock key has a player-facing label, and a level's list says what the data grants", () => {
    for (const key of LEVEL_UNLOCK_KEYS) expect(UNLOCK_LABELS[key], key).toBeTruthy();
    const ten = MILESTONE_LEVELS.find((l) => l.level === 10);
    expect(levelUnlockList(ten.unlocks)).toEqual([
      { key: "employeeCap", label: "Employee cap", value: String(ten.unlocks.employeeCap) },
      { key: "buildingSlots", label: "Building slots", value: String(ten.unlocks.buildingSlots) },
      { key: "maxFleetSize", label: "Fleet cap", value: String(ten.unlocks.maxFleetSize) },
      { key: "maxUpgradeTier", label: "Highest building tier", value: String(ten.unlocks.maxUpgradeTier) },
      { key: "marketSectors", label: "Market sectors opened", value: ten.unlocks.marketSectors.join(", ") }
    ]);
    // A level that opens no sector does not list an empty one.
    expect(levelUnlockList({ employeeCap: 5, marketSectors: [] }).map((u) => u.key)).toEqual(["employeeCap"]);
  });

  it("reaching a level sends one notification, and evaluating again sends none", () => {
    const state = createStarterCorporationState(normalizeStateShape(getSeedState()), "Test CEO", "Test Corp");
    state.corp.offices = [{ stationId: "earth-station-prime", rentedAt: 0, rentedUntil: Date.now() + 86_400_000 }];
    state.corp.employeeCount = 5;
    const account = { id: "acct-803", state, notifications: [] };
    const first = evaluateAccountLevel(account.id, account);
    expect(first.map((n) => n.level)).toEqual([1]);
    expect(first[0].maxLevel).toBe(MAX_DEFINED_LEVEL);
    const levelNotices = () => account.notifications.filter((n) => n.type === "level").length;
    expect(levelNotices()).toBe(1);
    expect(evaluateAccountLevel(account.id, account)).toEqual([]);
    expect(evaluateAccountLevel(account.id, account)).toEqual([]);
    expect(levelNotices()).toBe(1);
  });
});
