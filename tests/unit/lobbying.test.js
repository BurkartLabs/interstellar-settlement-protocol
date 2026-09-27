import { describe, it, expect } from "vitest";
import { influence, outcome, pull, specProblem } from "../../server/game/lobbying.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";

// ISP-239 (AB#934): the lobbying curve, netting and bounds (docs/design/WARFARE.md, "Lobbying"), with the catalog's own
// parameters. The hand-worked values are the design's worked example on Alpha Centauri's tariff cap.
const L = WARFARE_CATALOG.lobbying;
const CAP = L.parameters.tariffCapPct;

describe("the lobbying curve (AB#934)", () => {
  it("pulls M x (1 - e^(-I/K)): the design's worked example on a 3% cap", () => {
    expect(pull(15_000, CAP)).toBeCloseTo(0.528, 3);
    expect(pull(20_000, CAP)).toBeCloseTo(0.632, 3);
    const cap = (forI, againstI = 0) => outcome(3, "raise", forI, againstI, CAP).to;
    expect([0, 5_000, 10_000, 15_000, 20_000, 30_000, 40_000, 60_000].map((i) => cap(i))).toEqual([3, 3, 3.25, 3.5, 3.5, 3.75, 3.75, 3.75]);
    expect(cap(15_000, 10_000)).toBe(3); // Kestrel's 10,000 against Helios's 15,000: 0.135, under a step
    expect(influence(0, 20, L.creditsPerStandingPoint)).toBe(50_000); // 20 standing points: 50,000 no money buys
  });

  it("never doubles its effect for double the spend", () => {
    for (const I of [1_000, 10_000, 20_000, 50_000, 200_000]) expect(pull(2 * I, CAP)).toBeLessThan(2 * pull(I, CAP));
  });

  it("nets opposing sides, rounds toward zero to the step, and never leaves bounds (random spends)", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (const [name, spec] of Object.entries(L.parameters)) {
      for (let i = 0; i < 400; i += 1) {
        const base = spec.min + rand() * (spec.max - spec.min);
        const forI = rand() * 6 * spec.spendScale, againstI = rand() * 6 * spec.spendScale;
        const direction = rand() < 0.5 ? "raise" : "lower";
        const r = outcome(base, direction, forI, againstI, spec);
        expect(r.to, name).toBeGreaterThanOrEqual(spec.min);
        expect(r.to, name).toBeLessThanOrEqual(spec.max);
        const net = pull(forI, spec) - pull(againstI, spec);
        expect(Math.abs(r.steps * spec.step), name).toBeLessThanOrEqual(Math.abs(net) + 1e-9); // toward zero
        expect(Math.abs(net) - Math.abs(r.steps * spec.step), name).toBeLessThan(spec.step); // by less than a step
        expect(Math.sign(r.steps) === Math.sign(net) || r.steps === 0, name).toBe(true);
        const moved = base + (direction === "raise" ? 1 : -1) * r.steps * spec.step;
        expect(r.to, name).toBeCloseTo(Math.min(spec.max, Math.max(spec.min, moved)), 6);
        expect(Math.abs(r.to - base), name).toBeLessThanOrEqual(spec.maxShift + 1e-9); // never more than M
      }
    }
  });

  it("refuses a spec it cannot evaluate (fails closed)", () => {
    expect(specProblem({ ...CAP, spendScale: 0 })).toBeTruthy();
    expect(outcome(3, "raise", 15_000, 0, { ...CAP, step: NaN })).toBeNull();
    expect(outcome(3, "sideways", 15_000, 0, CAP)).toBeNull();
  });
});
