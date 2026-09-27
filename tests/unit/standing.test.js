import { describe, it, expect } from "vitest";
import { EARTH_ASSEMBLY, ITC, addStanding, decayStanding, earnStanding, standingOf } from "../../server/game/standing.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";

// ISP-238 (AB#933): standing's rules (docs/design/WARFARE.md, "Faction standing") with the catalog's own terms.
const T = WARFARE_CATALOG.standing;

describe("faction standing (AB#933)", () => {
  it("earns a point per eaTaxPerPoint of tax, to two decimals, carrying what is too little for a hundredth", () => {
    const corp = {};
    expect(earnStanding(corp, EARTH_ASSEMBLY, 1_920, T.eaTaxPerPoint, T)).toBe(0.19);
    expect(corp.standingCarry[EARTH_ASSEMBLY]).toBe(20);
    expect(earnStanding(corp, EARTH_ASSEMBLY, 80, T.eaTaxPerPoint, T)).toBe(0.01); // 20 carried + 80 = a hundredth
    expect(standingOf(corp, EARTH_ASSEMBLY)).toBe(0.2);
    for (let i = 0; i < 100; i += 1) earnStanding(corp, EARTH_ASSEMBLY, 50, T.eaTaxPerPoint, T); // many small sales add up
    expect(standingOf(corp, EARTH_ASSEMBLY)).toBe(0.7);
    expect(earnStanding(corp, ITC, 20_000, T.itcTradePerPoint, T)).toBe(1);
  });

  it("stays between 0 and the ceiling", () => {
    const corp = { standing: { [ITC]: 99.5 } };
    earnStanding(corp, ITC, 1_000_000, T.itcTradePerPoint, T);
    expect(standingOf(corp, ITC)).toBe(T.max);
    const penalised = { standing: { [ITC]: 5 } };
    expect(addStanding(penalised, ITC, -T.itcFindingPenalty, T)).toBe(0);
    expect(addStanding(penalised, "the-isa", 5, T)).toBe(0); // no such faction: nothing written
    expect(penalised.standing).toEqual({ [ITC]: 0 });
  });

  it("decays by decayPctPerDay of the value, once a UTC day", () => {
    const corp = { standing: { [EARTH_ASSEMBLY]: 50, [ITC]: 10 } };
    expect(decayStanding(corp, "2026-09-28", T)).toBe(true);
    expect(corp.standing).toEqual({ [EARTH_ASSEMBLY]: 49, [ITC]: 9.8 });
    expect(decayStanding(corp, "2026-09-28", T)).toBe(false);
    expect(corp.standing[EARTH_ASSEMBLY]).toBe(49);
  });

  it("matches the design's arithmetic: 1,000,000 of sales a week (80,000 of tax) reaches about 26 in a month and levels off near 57", () => {
    const corp = {};
    for (let d = 1; d <= 365; d += 1) {
      earnStanding(corp, EARTH_ASSEMBLY, 80_000 / 7, T.eaTaxPerPoint, T);
      decayStanding(corp, `day-${d}`, T);
      if (d === 30) expect(standingOf(corp, EARTH_ASSEMBLY)).toBeCloseTo(25, -0.5);
    }
    expect(standingOf(corp, EARTH_ASSEMBLY)).toBeGreaterThan(55);
    expect(standingOf(corp, EARTH_ASSEMBLY)).toBeLessThan(57.2);
  });
});
