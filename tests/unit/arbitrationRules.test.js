import { describe, it, expect } from "vitest";
import { councilFee, rateInForceAt, readinessAt, readinessRefund, royaltyShortfall, tariffExcess } from "../../server/game/arbitration.js";
import { settleUpkeep } from "../../server/upkeep.js";

// ISP-241 (AB#937): the Arbitration Council's arithmetic, against WARFARE.md's own worked examples.
const H = 3_600_000, DAY = 24 * H;
const TERMS = { filingFeeMin: 1_000, filingFeePct: 5 };

describe("the Council's rules (AB#937)", () => {
  it("charges the larger of 1,000 and 5% of the claim", () => {
    expect(councilFee(6_667, TERMS)).toBe(1_000);
    expect(councilFee(0, TERMS)).toBe(1_000);
    expect(councilFee(100_000, TERMS)).toBe(5_000);
  });

  it("refunds a readiness shortfall as WARFARE.md's example does: 72 hours at 60,000, readiness 90, then 80 and 70 for 24 hours each", () => {
    const log = [{ at: 0, readiness: 90 }, { at: 24 * H, readiness: 80 }, { at: 48 * H, readiness: 70 }];
    const r = readinessRefund({ price: 60_000, termHours: 72, hireReadiness: 90, hiredAt: 0 }, log, 72 * H);
    expect(r.hours).toHaveLength(72);
    expect(r.hoursBelow).toBe(48);
    expect(r.refund).toBe(6_667);
    expect(readinessRefund({ price: 60_000, termHours: 72, hireReadiness: 90, hiredAt: 0 }, [{ at: 0, readiness: 90 }], 72 * H).refund).toBe(0); // a flat line
    expect(readinessAt(log, -1)).toBeNull();
  });

  it("reads a holder's rate in force at a moment, and the excess over the lawful rate", () => {
    const record = { grantedAt: 0, pct: 2, history: [{ pct: 3, from: 72 * H }, { pct: 2, from: 100 * H }], pending: { pct: 3, effectiveAt: 200 * H } };
    expect([rateInForceAt(record, 10 * H), rateInForceAt(record, 80 * H), rateInForceAt(record, 150 * H), rateInForceAt(record, 250 * H)]).toEqual([0, 3, 2, 3]);
    expect(tariffExcess({ chargedPct: 3, postedPct: null, base: 60_000, granted: true, holderRates: [2], capPct: 3 })).toEqual({ lawfulPct: 2, excess: 600 });
    expect(tariffExcess({ chargedPct: 3, postedPct: 1, base: 60_000, granted: true, holderRates: [3, 2], capPct: 3 })).toEqual({ lawfulPct: 1, excess: 1_200 });
    expect(tariffExcess({ chargedPct: 1, postedPct: null, base: 60_000, granted: false, holderRates: [1], capPct: 3 })).toEqual({ lawfulPct: 0, excess: 600 });
    expect(tariffExcess({ chargedPct: 2, postedPct: null, base: 60_000, granted: true, holderRates: [2], capPct: 3 }).excess).toBe(0);
  });

  it("finds a royalty shortfall only where the settlement undercharged, not in a debt being withheld", () => {
    const uses = [{ base: 32_250, royalty: 1_290, paid: 1_290 }, { base: 32_250, royalty: 1_000, paid: 400 }];
    expect(royaltyShortfall(uses, 4)).toEqual({ due: 2_580, recorded: 2_290, paid: 1_690, shortfall: 290 });
  });

  it("logs readiness in whole points as upkeep moves it, for a hire's hours", () => {
    const corp = { finances: { credits: 0 }, military: { units: { lf: 10 }, readiness: 100, upkeep: { paidThrough: 1, remainder: 0, short: false } } }; // a clock already running
    settleUpkeep(corp, DAY / 2);
    settleUpkeep(corp, DAY / 2 + 60_000); // a minute on: less than a point, no new entry
    settleUpkeep(corp, DAY);
    expect(corp.military.readinessLog).toEqual([{ at: DAY / 2, readiness: 95 }, { at: DAY, readiness: 90 }]);
  });
});

// ISP-242 (AB#938): a Council debt shares the ITC's one withholding, and counts in the credit rating.
import { councilWithholding } from "../../public/scripts/itcDuty.js";
import { computeCreditRating } from "../../server/creditRating.js";

describe("Council debts (AB#938)", () => {
  it("take what the ITC's 50% leaves after duty, oldest first, never more than owed", () => {
    expect(councilWithholding(1_000, 0, [{ ref: "a", owed: 300 }, { ref: "b", owed: 900 }], 50)).toEqual([{ ref: "a", credits: 300 }, { ref: "b", credits: 200 }]);
    expect(councilWithholding(1_000, 450, [{ ref: "a", owed: 300 }], 50)).toEqual([{ ref: "a", credits: 50 }]); // the duty took 450 of the 500
    expect(councilWithholding(1_000, 500, [{ ref: "a", owed: 300 }], 50)).toEqual([]);
    expect(councilWithholding(0, 0, [{ ref: "a", owed: 300 }], 50)).toEqual([]);
  });

  it("count as debt in the rating's leverage input", () => {
    const NOW = Date.UTC(2026, 8, 27);
    const sts = Array.from({ length: 30 }, (_, i) => ({ day: "", dayStart: NOW - (30 - i) * DAY, pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 }, balanceSheet: { credits: 150_000, facilities: 0, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 } }));
    const base = { finances: { credits: 150_000, payrollArrears: 0 }, loans: [] };
    expect(computeCreditRating(base, NOW, sts).inputs.leverage.raw).toBe(0);
    const owing = computeCreditRating({ ...base, councilDebts: [{ ref: "GAC-2026-000001:corp-x", owed: 63_000 }] }, NOW, sts);
    expect(owing.inputs.leverage.raw).toBeCloseTo(63_000 / 900_000, 4);
    expect(owing.score).toBeLessThan(computeCreditRating(base, NOW, sts).score);
  });
});
