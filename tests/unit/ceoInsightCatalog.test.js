import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getEffectiveExchangeTaxRate, extractorDowntimeProbPerSec } from "../../server/gameState.js";
import { officeRenewalCost, missionRewardCredits } from "../../public/scripts/ceoEffects.js";

// Bug #983: eleven of twelve CEO Insight programs were sold with stated effects and changed nothing. Every program
// is now live or planned, and this file derives its cases from the catalogue: marking a program live without giving
// it a measured effect here fails, so the catalogue cannot promise what the server does not do.
const PROGRAMS = JSON.parse(fs.readFileSync(new URL("../../data/ceo-insight.json", import.meta.url), "utf8")).programs;
const byId = Object.fromEntries(PROGRAMS.map((p) => [p.id, p]));
const live = PROGRAMS.filter((p) => p.status === "live");

const corpWith = (completedInsights) => ({ completedInsights, unlockedTech: [], finances: {} });

/** For each live program, the number its stated effect names, for a corporation that has completed these programs. */
const MEASURES = {
  "ceo-negotiation-fundamentals": { effect: "-2% GEX sales tax", measure: (ids) => getEffectiveExchangeTaxRate({ corp: corpWith(ids) }), without: 8, with: 6 },
  "ceo-isa-regulatory-navigation": { effect: "-5% lease renewal cost", measure: (ids) => officeRenewalCost(ids, 7), without: 7000, with: 6650 },
  "ceo-risk-assessment": { effect: "-12% extractor downtime chance", measure: (ids) => extractorDowntimeProbPerSec(corpWith(ids)), without: 0.00005, with: 0.00005 * 0.88 },
  // Bug #1009: live once mission rewards reached the balance at all.
  "ceo-contract-law": { effect: "+8% mission reward bonus", measure: (ids) => missionRewardCredits("12,000 Credits", ids), without: 12000, with: 12960 }
};

describe("CEO Insight catalogue (Bug #983)", () => {
  it("marks every program live or planned", () => {
    expect(PROGRAMS).toHaveLength(12);
    for (const p of PROGRAMS) expect(["live", "planned"], p.id).toContain(p.status);
  });

  it("has a measured effect for every live program, and none for a planned one", () => {
    expect(live.map((p) => p.id).sort()).toEqual(Object.keys(MEASURES).sort());
  });

  for (const [id, m] of Object.entries(MEASURES)) {
    it(`${id} changes the number it names: ${m.effect}`, () => {
      expect(byId[id]?.effect).toBe(m.effect);
      expect(m.measure([])).toBeCloseTo(m.without, 12);
      expect(m.measure([id])).toBeCloseTo(m.with, 12);
    });
  }

  it("lets a corporation reach every live program without completing a planned one", () => {
    for (const p of live) {
      for (const prereq of p.prereqs) expect(byId[prereq]?.status, `${p.id} requires ${prereq}`).toBe("live");
    }
  });
});

describe("the effects stack with what already applies", () => {
  it("risk assessment multiplies the industrial-safety discount rather than replacing it", () => {
    const corp = { completedInsights: ["ceo-risk-assessment"], unlockedTech: ["tt-industrial-safety"] };
    expect(extractorDowntimeProbPerSec(corp)).toBeCloseTo(0.00005 * 0.92 * 0.88, 12);
  });

  it("the renewal discount applies to every duration and rounds to whole credits", () => {
    for (const days of [7, 14, 21, 28]) {
      expect(officeRenewalCost([], days)).toBe(days * 1000);
      expect(officeRenewalCost(["ceo-isa-regulatory-navigation"], days)).toBe(Math.round(days * 1000 * 0.95));
    }
    expect(officeRenewalCost(undefined, 7)).toBe(7000);
  });
});
