import { describe, it, expect } from "vitest";
import { plannerPayoutRatio, ratioNet } from "./equityPlanner.js";

// ISP-159 (AB#853), probe target (a bot number, P-PROXY): the planner issuer's chosen payout ratio is interior (neither
// 0 nor 80%) in at least 80% of runs, evidencing T-018. What it measures: whether the ratio knob has an interior optimum
// under the design's arithmetic for a spread of issuers, not what players choose. ISP-162 (AB#856) runs it in the probe.

// the worked issuer of docs/design/v0.9-equity.md, section 6: 4,000 a day, worth 1,200,000, 10,000 shares, offering 2,000
const WORKED = { income30: 120_000, value: 1_200_000, outstanding: 10_000, offerShares: 2_000, grade: "A", capital: { tranche: 120_000, firstPct: 40, restPct: 20 } };

describe("ISP-159 the planner issuer's payout ratio", () => {
  it("reproduces section 6's table and picks its 25%", () => {
    const row = (r) => { const x = ratioNet(WORKED, r); return [x.raised, Math.round(x.dividends), x.earns, Math.round(x.net)]; };
    expect(row(0)).toEqual([0, 0, 0, 0]);
    expect(row(10)).toEqual([60_000, 1_143, 24_000, 22_857]);
    expect(row(20)).toEqual([180_000, 6_261, 60_000, 53_739]);
    expect(row(25)).toEqual([240_000, 10_000, 72_000, 62_000]);
    expect(row(40)).toEqual([240_000, 16_000, 72_000, 56_000]);
    expect(row(80)).toEqual([240_000, 32_000, 72_000, 40_000]);
    expect(plannerPayoutRatio(WORKED)).toBe(25);
  });

  it("is neither 0 nor 80% in at least 80% of 500 seeded issuers", () => {
    let x = 853;
    const rnd = () => ((x = (x * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const chosen = [];
    for (let i = 0; i < 500; i++) {
      const value = 300_000 + rnd() * 4_700_000;
      const outstanding = 10_000 + Math.floor(rnd() * 5) * 500;
      chosen.push(plannerPayoutRatio({
        income30: value * (0.03 + rnd() * 0.12), // 3% to 15% of value a month
        value, outstanding,
        offerShares: Math.floor(outstanding * (0.05 + rnd() * 0.15)),
        grade: pick(["AAA", "AA", "A", "BBB"]),
        capital: { tranche: value * (0.05 + rnd() * 0.15), firstPct: 15 + rnd() * 45, restPct: 5 + rnd() * 20 }
      }));
    }
    const interior = chosen.filter((r) => r > 0 && r < 80).length / chosen.length;
    console.log(`planner issuer: ${(interior * 100).toFixed(1)}% of 500 at an interior payout ratio; spread ${Math.min(...chosen)} to ${Math.max(...chosen)}`);
    expect(interior).toBeGreaterThanOrEqual(0.8);
    expect(new Set(chosen).size).toBeGreaterThan(4); // a decision: issuers choose differently
  });
});
