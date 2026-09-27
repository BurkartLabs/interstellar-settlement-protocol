import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeCreditRating, gradeFor, refreshCreditRating, ratingBasis, RATING, GRADES } from "../../server/creditRating.js";

// ISP-147 (AB#841): docs/design/v0.9-debt.md, section 4. The design's own worked example is the first fixture: its
// "example corporation" scores 814 (AA), and 770 (A) as a quote after a 63,000 loan (section 8).
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 27);
/** `n` closed statements, one a day up to yesterday, each with the same day's figures. */
function statements(n, { income = 30_000, expenses = 26_500, credits = 150_000, assets = 330_000, liabilities = 20_000 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    day: "", dayStart: NOW - (n - i) * DAY,
    pnl: { income: {}, expenses: {}, totalIncome: income, totalExpenses: expenses, net: income - expenses },
    balanceSheet: { credits, facilities: 0, inventory: 0, liabilities, totalAssets: assets, netWorth: assets - liabilities }
  }));
}
const corp = (over = {}) => ({ finances: { credits: 150_000, payrollArrears: 0, ...(over.finances || {}) }, loans: over.loans || [] });

describe("ISP-147 the formula, from the design's own example", () => {
  it("the example corporation scores 814, grade AA", () => {
    const r = computeCreditRating(corp(), NOW, statements(30));
    expect(r).toMatchObject({ grade: "AA", score: 814, computedAt: NOW });
    expect(r.caps).toBeUndefined();
    expect(Object.keys(r.inputs)).toEqual(["history", "cashCover", "margin", "solvency", "leverage", "turnover"]);
    expect(r.inputs.history).toEqual({ raw: 30, sub: 1, weight: 100 });
    expect(r.inputs.leverage).toEqual({ raw: 0, sub: 1, weight: 250 });
  });

  it("quoting a 63,000 loan rates it as if taken: 770, grade A", () => {
    expect(computeCreditRating(corp(), NOW, statements(30), { proForma: { debt: 63_000, assets: 63_000 } })).toMatchObject({ grade: "A", score: 770 });
  });

  it("every input carries its weight: a fixture where each sub-score is strictly inside 0..1 (P-IDENTITY-BLIND)", () => {
    // 20 statements, a thin margin, a loan outstanding, cover and turnover both below their caps
    const sts = statements(20, { income: 20_000, expenses: 18_600, credits: 120_000, assets: 400_000, liabilities: 80_000 });
    const c = corp({ loans: [{ state: "active", balance: 45_000, arrears: 0, arrearsSince: null }] });
    const r = computeCreditRating(c, NOW, sts);
    // The formulas again, from the design's table, apart from the module's code
    const income = 20 * 20_000, net = 20 * 1_400, debt = 45_000;
    const expected = {
      history: (20 - 7) / 23,
      cashCover: 120_000 / 18_600 / 30,
      margin: (net / income + 0.10) / 0.30,
      solvency: 320_000 / (80_000 + debt) / 3,
      leverage: 1 - debt / income / 0.6,
      turnover: income / 400_000 / 3
    };
    for (const [id, sub] of Object.entries(expected)) {
      expect(sub, id).toBeGreaterThan(0);
      expect(sub, id).toBeLessThan(1);
      expect(r.inputs[id].sub, id).toBeCloseTo(sub, 4);
    }
    const weights = Object.fromEntries(RATING.inputs.map((i) => [i.id, i.weight]));
    expect(r.score).toBe(Math.round(Object.entries(expected).reduce((s, [id, sub]) => s + weights[id] * sub, 0)));
    // and moving any one input moves the score by that input's weight: the debt, which three inputs read, does
    const more = computeCreditRating(corp({ loans: [{ state: "active", balance: 90_000, arrears: 0 }] }), NOW, sts);
    expect(more.score).toBeLessThan(r.score);
  });

  it("no income scores 0 on margin, leverage and turnover", () => {
    const r = computeCreditRating(corp(), NOW, statements(10, { income: 0, expenses: 1_000 }));
    expect([r.inputs.margin.sub, r.inputs.leverage.sub, r.inputs.turnover.sub]).toEqual([0, 0, 0]);
  });
});

describe("ISP-147 grades and caps", () => {
  it("each grade boundary: the lowest score of a grade earns it, one less earns the next", () => {
    for (const [i, g] of RATING.grades.entries()) {
      expect(gradeFor(g.minScore)).toBe(g.grade);
      if (g.minScore > 0) expect(gradeFor(g.minScore - 1)).toBe(RATING.grades[i + 1].grade);
    }
    expect(gradeFor(1000)).toBe("AAA");
    expect(GRADES).toEqual(["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C", "D"]);
  });

  it("wages owed cap it at B; debt in arrears at CCC; arrears past 7 days, or a default in 30 days, make it D", () => {
    const sts = statements(30);
    expect(computeCreditRating(corp({ finances: { payrollArrears: 500 } }), NOW, sts)).toMatchObject({ grade: "B", caps: ["payroll arrears"] });
    const arrears = (since) => corp({ loans: [{ state: "arrears", balance: 10_000, arrears: 600, arrearsSince: NOW - since * DAY }] });
    expect(computeCreditRating(arrears(2), NOW, sts).grade).toBe("CCC");
    expect(computeCreditRating(arrears(8), NOW, sts).grade).toBe("D");
    const defaulted = (daysAgo) => corp({ loans: [{ state: "defaulted", balance: 10_000, arrears: 0, defaultedAt: NOW - daysAgo * DAY }] });
    expect(computeCreditRating(defaulted(10), NOW, sts).grade).toBe("D");
    expect(computeCreditRating(defaulted(40), NOW, sts).grade).not.toBe("D");
    // a cap never raises a grade: a corporation already below B stays where it is
    const weak = statements(30, { income: 10_000, expenses: 12_000, credits: 1_000, assets: 20_000, liabilities: 15_000 });
    const low = computeCreditRating(corp({ finances: { payrollArrears: 1 } }), NOW, weak);
    expect(GRADES.indexOf(low.grade)).toBeGreaterThanOrEqual(GRADES.indexOf("B"));
  });
});

describe("ISP-147 too little, or unreadable, history is NR, never a good grade", () => {
  it("fewer than 7 statements, none, or not a list", () => {
    expect(computeCreditRating(corp(), NOW, statements(6))).toMatchObject({ grade: "NR", inputs: null });
    expect(computeCreditRating(corp(), NOW, [])).toMatchObject({ grade: "NR" });
    expect(computeCreditRating(corp(), NOW, null)).toMatchObject({ grade: "NR" });
    expect(computeCreditRating(corp(), NOW, statements(7)).grade).not.toBe("NR");
  });

  it("any malformed statement in the history", () => {
    for (const breakIt of [(s) => { s.pnl.net = NaN; }, (s) => { delete s.balanceSheet; }, (s) => { s.balanceSheet.netWorth = "310000"; }, (s) => { s.dayStart = undefined; }]) {
      const sts = statements(30);
      breakIt(sts[12]);
      const r = computeCreditRating(corp(), NOW, sts);
      expect(r.grade).toBe("NR");
      expect(r.score).toBeUndefined();
    }
  });
});

describe("ISP-147 the design's table and data/credit-rating.json agree (P-TWO-SOURCES)", () => {
  const doc = fs.readFileSync(path.resolve(import.meta.dirname, "../../docs/design/v0.9-debt.md"), "utf8");
  it("inputs and weights, in the design's order", () => {
    const rows = [...doc.matchAll(/^\| (history|cash cover|margin|solvency|leverage|turnover) \|.*\| (\d+) \|$/gm)].map((m) => [m[1], Number(m[2])]);
    expect(rows).toEqual(RATING.inputs.map((i) => [i.name, i.weight]));
    expect(rows.reduce((s, [, w]) => s + w, 0)).toBe(1000);
  });
  it("grade boundaries", () => {
    const grades = doc.match(/^\| grade \| (.+) \|$/m)[1].split(" | ");
    const scores = doc.match(/^\| score \| (.+) \|$/m)[1].split(" | ").map((s) => (s.startsWith("below") ? 0 : Number(s.replace(/[+-].*$/, ""))));
    expect(grades.map((g, i) => ({ grade: g, minScore: scores[i] }))).toEqual(RATING.grades);
  });
});

describe("ISP-147 the tick recomputes only when an input can have changed", () => {
  it("the same day, wages and debt: no statements read; any of them changes: read again", () => {
    const c = corp();
    c.finances.dayBook = { dayStart: NOW, opening: 0, income: {}, expenses: {} };
    let reads = 0;
    const load = () => { reads++; return statements(30); };
    expect(refreshCreditRating(c, NOW, load)).toBe(true);
    expect(refreshCreditRating(c, NOW + 30_000, load)).toBe(false);
    expect(reads).toBe(1);
    expect(c.creditRating).toMatchObject({ grade: "AA", score: 814, basis: ratingBasis(c) });
    c.finances.payrollArrears = 100;
    expect(refreshCreditRating(c, NOW, load)).toBe(true);
    expect(c.creditRating.grade).toBe("B");
    c.finances.dayBook.dayStart = NOW + DAY; // a statement closed
    expect(refreshCreditRating(c, NOW + DAY, load)).toBe(true);
    c.loans = [{ state: "active", balance: 5_000, arrears: 0 }];
    expect(refreshCreditRating(c, NOW + DAY, load)).toBe(true);
    expect(reads).toBe(4);
  });

  it("statements that cannot be loaded give NR, not a stale grade", () => {
    const c = corp();
    refreshCreditRating(c, NOW, () => { throw new Error("disk"); });
    expect(c.creditRating.grade).toBe("NR");
  });
});
