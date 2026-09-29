import { describe, it, expect } from "vitest";
import { computeDominance } from "../../server/game/dominance.js";
import { controlScores, eligibility, metOn } from "../../server/game/control.js";
import { concessionTermsFor } from "../../server/warfare.js";

// ISP-226 (AB#921): control scores and concession eligibility (docs/design/TERRITORY.md). A fixture timeline through the
// real dominance computation, with hand-worked values; eligibility after the sustained window only, and never where a
// system cannot be conceded.
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 3, 1);
const corp = (publicId, name, extractionByDay) => ({ state: { corp: { publicId, corporationName: name, miningLeases: [], dominance: { extraction: extractionByDay } } } });
/** Tonnes a day in a system, for days [from, to). */
const mined = (systemId, tonnes, from, to) => Object.fromEntries(Array.from({ length: to - from }, (_, i) => [String(T0 + (from + i) * DAY), { [systemId]: tonnes }]));

describe("control scores rise and decay with the dominance window (AB#921)", () => {
  // A mines 100 t a day in Alpha Centauri from day 0; B mines 300 t a day on days 0 to 6, then stops. The reading at the
  // start of day d covers days d-7 to d-1. Only extraction is live, so the score is the extraction share.
  const accounts = [corp("corp-a", "Aster Mining", mined("alpha-centauri", 100, 0, 21)), corp("corp-b", "Brand Holdings", mined("alpha-centauri", 300, 0, 7))];
  const scoreOn = (day) => {
    const d = computeDominance({ accounts, conglomerates: [] }, T0 + day * DAY + 60_000);
    return Object.fromEntries(controlScores(d.holders["alpha-centauri"], concessionTermsFor("alpha-centauri").weights).map((h) => [h.name, h.score]));
  };

  it("matches the hand-worked values day by day: B's week drains out of the window, A's share rises to all of it", () => {
    const hand = { 7: [700, 2100], 8: [700, 1800], 9: [700, 1500], 10: [700, 1200], 11: [700, 900], 12: [700, 600], 13: [700, 300], 14: [700, 0] };
    for (const [day, [a, b]] of Object.entries(hand)) {
      const s = scoreOn(Number(day));
      expect(s["Aster Mining"], `day ${day}`).toBeCloseTo(a / (a + b), 10);
      if (b) expect(s["Brand Holdings"], `day ${day}`).toBeCloseTo(b / (a + b), 10);
      else expect(s["Brand Holdings"], `day ${day}`).toBeUndefined();
    }
    expect(scoreOn(7)["Aster Mining"]).toBe(0.25);
    expect(scoreOn(14)["Aster Mining"]).toBe(1);
  });

  it("scores at the system's own weights: in Sirius (sales only) extraction earns no control", () => {
    const d = computeDominance({ accounts: [corp("corp-a", "Aster Mining", mined("sirius", 100, 0, 7))], conglomerates: [] }, T0 + 7 * DAY + 60_000);
    expect(controlScores(d.holders.sirius, concessionTermsFor("sirius").weights)).toEqual([]);
  });

  it("counts a conglomerate as one holder, its members' shares summed", () => {
    const accounts2 = [...accounts, corp("corp-c", "Cinder Works", mined("alpha-centauri", 100, 0, 21))];
    const d = computeDominance({ accounts: accounts2, conglomerates: [{ id: "cgl-1", name: "Aster Pact", members: [{ corp: "corp-a", joinedAt: 0 }, { corp: "corp-c", joinedAt: 0 }] }] }, T0 + 14 * DAY + 60_000); // members since before the window (Bug #4802)
    const scores = controlScores(d.holders["alpha-centauri"], concessionTermsFor("alpha-centauri").weights);
    expect(scores).toEqual([{ type: "conglomerate", id: "cgl-1", name: "Aster Pact", score: 1, extraction: 1 }]);
  });
});

describe("eligibility: the grant conditions held for the whole window (AB#921)", () => {
  const terms = concessionTermsFor("alpha-centauri"); // 40%, 1.5x, 14 days
  const reading = (dayIndex, scores) => ({ day: T0 + dayIndex * DAY, computedAt: T0 + dayIndex * DAY + 60_000, scores });
  const leader = (score, next = 0.2) => [{ type: "corp", id: "a", name: "Aster Mining", score }, { type: "corp", id: "b", name: "Brand Holdings", score: next }];
  const run = (n, scores = leader(0.5)) => Array.from({ length: n }, (_, i) => reading(i, scores));
  const at = (days) => days[days.length - 1].computedAt + 3_600_000;

  it("is false for 13 days of meeting the conditions, and true on the 14th", () => {
    expect(eligibility(run(13), terms, at(run(13))).eligible.has("corp:a")).toBe(false);
    const days = run(14);
    const e = eligibility(days, terms, at(days));
    expect(e.eligible.has("corp:a")).toBe(true);
    expect(e.streaks.get("corp:a")).toBe(14);
  });

  it("needs 40% and a 1.5x lead on every day: one day short of either restarts the count", () => {
    expect(metOn(leader(0.39, 0.1), terms).size).toBe(0);
    expect(metOn(leader(0.45, 0.31), terms).size).toBe(0); // 0.45 < 1.5 x 0.31
    const days = run(14);
    days[5] = reading(5, leader(0.45, 0.31));
    const e = eligibility(days, terms, at(days));
    expect(e.eligible.size).toBe(0);
    expect(e.streaks.get("corp:a")).toBe(8); // days 6 to 13
  });

  it("does not bridge a missing day, and reads false when the newest reading is older than the stated age", () => {
    const gap = run(15).filter((d, i) => i !== 3);
    expect(eligibility(gap, terms, at(gap)).eligible.size).toBe(0);
    const days = run(14);
    const late = eligibility(days, terms, days[13].computedAt + (terms.concessionDataMaxAgeHours + 1) * 3_600_000);
    expect(late).toMatchObject({ stale: true });
    expect(late.eligible.size).toBe(0);
  });

  it("is never true for a never-concedable system, whatever the scores", () => {
    expect(concessionTermsFor("sol")).toBeNull();
    const days = run(30, leader(1, 0));
    expect(eligibility(days, concessionTermsFor("sol"), at(days)).eligible.size).toBe(0);
  });

  it("follows the system's rule: a shorter window, two places in a condominium, conglomerates only", () => {
    const barnards = concessionTermsFor("barnards-star"); // 30%, 7 days
    const seven = run(7, leader(0.31, 0.1));
    expect(eligibility(seven, barnards, at(seven)).eligible.has("corp:a")).toBe(true);
    const cygni = concessionTermsFor("61-cygni");
    const two = [{ type: "corp", id: "a", name: "A", score: 0.45 }, { type: "corp", id: "b", name: "B", score: 0.42 }, { type: "corp", id: "c", name: "C", score: 0.1 }];
    expect([...metOn(two, cygni)].sort()).toEqual(["corp:a", "corp:b"]);
    expect(metOn(leader(0.9, 0), concessionTermsFor("lacaille-9352")).size).toBe(0); // an independent corporation cannot
    expect(metOn([{ type: "conglomerate", id: "g", name: "G", score: 0.9 }], concessionTermsFor("lacaille-9352")).size).toBe(1);
  });
});
