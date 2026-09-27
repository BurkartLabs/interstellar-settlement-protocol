import { describe, it, expect } from "vitest";
import { BOND_TERMS } from "../../server/bondTerms.js";
import { issueNet, plannerCoupon } from "./bondPlanner.js";

// ISP-154 (AB#848), probe target (a bot number, P-PROXY): the planner bot's chosen coupon is neither the minimum nor the
// maximum allowed in at least 80% of issues. What it measures: whether the coupon knob has an interior optimum under
// the design's arithmetic for a spread of issuers, not what players choose. ISP-162 (AB#856) runs it in the probe.

// a fixed pseudo-random sweep, so the number is the same on every run
function* issues(n) {
  let x = 848;
  const rnd = () => ((x = (x * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < n; i++) {
    yield {
      grade: pick(BOND_TERMS.issuerGrades),
      quantity: pick([10, 50, 100, 250, 500, 1_000]),
      maturityDays: pick(BOND_TERMS.maturityDays),
      capital: { returnPct30: 2 + rnd() * 28, halfLifeCredits: 20_000 + rnd() * 480_000 }
    };
  }
}

describe("ISP-154 the planner bot's coupon", () => {
  it("section 8's example: a grade A issuer of 100 units for 60 days does best at an interior coupon", () => {
    const issue = { grade: "A", quantity: 100, maturityDays: 60, capital: { returnPct30: 30, halfLifeCredits: 60_000 } };
    const c = plannerCoupon(issue);
    expect(c).toBeGreaterThan(BOND_TERMS.minCouponPct30);
    expect(c).toBeLessThan(BOND_TERMS.maxCouponPct30);
    expect(issueNet(issue, c).net).toBeGreaterThan(issueNet(issue, BOND_TERMS.maxCouponPct30).net);
  });

  it("is neither the minimum nor the maximum in at least 80% of 500 issues", () => {
    const chosen = [...issues(2_000)].map(plannerCoupon).filter((c) => c !== null).slice(0, 500);
    expect(chosen).toHaveLength(500);
    const interior = chosen.filter((c) => c > BOND_TERMS.minCouponPct30 && c < BOND_TERMS.maxCouponPct30).length / chosen.length;
    console.log(`planner bot: ${(interior * 100).toFixed(1)}% of 500 issues at an interior coupon; spread ${Math.min(...chosen)} to ${Math.max(...chosen)}`);
    expect(interior).toBeGreaterThanOrEqual(0.8);
    expect(new Set(chosen).size).toBeGreaterThan(5); // it is a decision: different issuers choose differently
  });
});
