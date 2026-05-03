import { describe, it, expect } from "vitest";
import { createCombatReport, getState } from "../../server/gameState.js";

describe("createCombatReport", () => {
  it("returns a report with the supplied fields and an auto id + createdAt", () => {
    const r = createCombatReport({
      attackerName: "ATK",
      defenderName: "DEF",
      attackerPower: 150,
      defenderPower: 140,
      counterModifier: 1,
      winner: "ATK",
      summary: "ATK wins."
    });
    expect(r.id).toMatch(/^cmb-/);
    expect(r.createdAt).toBeGreaterThan(0);
    expect(r.attackerName).toBe("ATK");
    expect(r.defenderName).toBe("DEF");
    expect(r.attackerPower).toBe(150);
    expect(r.defenderPower).toBe(140);
    expect(r.counterModifier).toBe(1);
    expect(r.winner).toBe("ATK");
    expect(r.summary).toBe("ATK wins.");
  });

  it("unshifts the report into state.combatReports", () => {
    const before = (getState().combatReports || []).length;
    const r = createCombatReport({
      attackerName: "A",
      defenderName: "B",
      attackerPower: 1,
      defenderPower: 1,
      counterModifier: 1,
      winner: "A",
      summary: "ok"
    });
    const after = getState().combatReports;
    expect(after[0].id).toBe(r.id);
    expect(after.length).toBe(before + 1);
  });

  it("caps state.combatReports at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      createCombatReport({
        attackerName: `A${i}`,
        defenderName: `B${i}`,
        attackerPower: 1,
        defenderPower: 1,
        counterModifier: 1,
        winner: `A${i}`,
        summary: "ok"
      });
    }
    expect(getState().combatReports.length).toBeLessThanOrEqual(50);
  });
});
