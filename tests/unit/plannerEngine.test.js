import { describe, it, expect } from "vitest";
import { simulate, boardSheetPlan, priceAction, newAction, newPhase, cloneDay, flattenDays } from "../../tools/planner/engine.js";
import { loadRules } from "../../tools/planner/rules.mjs";
import { operationCostPerHourFor, startupCostFor, yardUpkeepPerHourFor, ECONOMY } from "../../server/economy.js";

// AB#4911: the Economy Planner prices actions with the game's own rules. These hold it to the Board's spreadsheet
// (custom actions) and to the server's functions (rule-backed actions), so neither can drift unseen.
const rules = loadRules();

describe("Economy Planner engine (AB#4911)", () => {
  it("reproduces the Board's spreadsheet of 2026-10-03 to the credit", () => {
    const r = simulate(boardSheetPlan(), rules);
    expect(r.days[0].expenses).toBe(221140);
    expect(r.days[0].cash).toBe(28860);
    expect(r.days[1].income).toBe(69120);
    expect(r.days[1].expenses).toBe(48140);
    expect(r.days[1].net).toBe(20980);
    expect(r.days.slice(0, 7).map((d) => d.gainLoss)).toEqual([-221140, -200160, -179180, -158200, -137220, -116240, -95260]);
    // Hour by hour the low is a little lower than the sheet's end-of-day figure: day 2's per-day costs fall due at
    // midnight, before that day's hourly income has come in (28,860 - 2,000 office - 1,500 payroll + the first hour).
    expect(r.kpis.lowest).toEqual({ cash: 28860 - 2000 - 1500 + 1440 * 2 - 1860, day: 2 });
  });

  it("reads the game's data files", () => {
    expect(rules.economy).toEqual(ECONOMY);
    expect(rules.research.length).toBeGreaterThan(20);
    expect(rules.leases.find((l) => l.body === "Earth")?.cost).toBeGreaterThan(0);
  });

  it("prices a mining cycle as the server does, at every throughput", () => {
    for (const t of [10, 37, 100, 180, 250]) {
      for (const yard of [1, 3]) {
        const p = priceAction({ kind: "cycle", throughput: t, yard, hours: 24 }, rules);
        expect(p.perHour).toBe(operationCostPerHourFor(t, ECONOMY.operations, { yardIndex: yard - 1 }));
        expect(p.upfront).toBe(startupCostFor(operationCostPerHourFor(t, ECONOMY.operations)));
      }
    }
    expect(yardUpkeepPerHourFor(2)).toBeGreaterThan(0); // yard 3 pays upkeep: the case above is not vacuous
  });

  it("prices office, hiring, a lease, yards and research from the data", () => {
    const e = rules.economy;
    expect(priceAction({ kind: "office", termDays: 14 }, rules).upfront).toBe(e.office.rentPerDay * 14);
    expect(priceAction({ kind: "hire", count: 5 }, rules)).toMatchObject({ upfront: e.employees.hireCost * 5, perDay: e.employees.payrollPerDay * 5 });
    expect(priceAction({ kind: "lease", body: "Mars" }, rules).upfront).toBe(rules.leases.find((l) => l.body === "Mars").cost);
    const yard = (owned, sf) => priceAction({ kind: "yard" }, rules, { yardsOwned: owned, supplyForecast: sf }).upfront;
    expect([0, 1, 2, 3].map((n) => yard(n, false))).toEqual([50000, 50000, 63000, 78000]);
    expect(yard(0, true)).toBe(Math.round(50000 * e.buildings.supplyForecastCostMultiplier));
    const tech = rules.research[0];
    expect(priceAction({ kind: "research", tech: tech.id }, rules).upfront).toBe(tech.costCredits);
  });

  it("a rule-backed plan mines, sells along the falling bid, and pays the third yard's upkeep", () => {
    const plan = { settings: { capital: 250000 }, phases: [{ id: "p", name: "Setup", days: [
      { id: "d1", actions: [newAction("office", rules), newAction("hire", rules), { ...newAction("lease", rules), body: "Earth" }, newAction("yard", rules),
        { ...newAction("cycle", rules), throughput: 100 }] },
      { id: "d2", actions: [] }, { id: "d3", actions: [] }
    ] }] };
    const r = simulate(plan, rules);
    expect(r.warnings).toEqual([]);
    expect(r.days[1].tonnes).toBeCloseTo(2400, 5);
    expect(r.days[1].avgBid).toBeLessThan(rules.economy.npcBuyers.find((b) => b.item === "Silicates").unitPrice); // the bid fell
    expect(r.days[1].byCat.sales).toBeGreaterThan(0);
  });

  it("warns when a cycle has no yard, and research runs one at a time after its prerequisites", () => {
    const [first, second] = [rules.research.find((t) => !t.prereqs?.length), rules.research.find((t) => t.prereqs?.length === 1)];
    const plan = { settings: {}, phases: [{ id: "p", name: "x", days: [{ id: "d", actions: [
      { ...newAction("cycle", rules), id: "c" },
      { ...newAction("research", rules), id: "r2", tech: second.id },
      { ...newAction("research", rules), id: "r1", tech: first.id }
    ] }] }] };
    const r = simulate(plan, rules);
    expect(r.warnings.map((w) => w.text).join(" | ")).toMatch(/yard 1 is not built/);
    expect(r.warnings.map((w) => w.text).join(" | ")).toMatch(/needs/);
  });

  it("phases group days, and duplicating a day copies its actions with new ids", () => {
    const phase = newPhase("A");
    phase.days[0].actions.push(newAction("hire", rules));
    const copy = cloneDay(phase.days[0]);
    expect(copy.id).not.toBe(phase.days[0].id);
    expect(copy.actions[0].id).not.toBe(phase.days[0].actions[0].id);
    phase.days.push(copy);
    const plan = { settings: {}, phases: [phase, newPhase("B")] };
    expect(flattenDays(plan).map((d) => [d.n, d.phase.name])).toEqual([[1, "A"], [2, "A"], [3, "B"]]);
    const r = simulate(plan, rules);
    expect(r.phases.map((p) => [p.name, p.from, p.to])).toEqual([["A", 1, 2], ["B", 3, 3]]);
  });
});
