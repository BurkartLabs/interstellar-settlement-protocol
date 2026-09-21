import { describe, it, expect, afterEach, vi } from "vitest";
import { recordIncome, refreshDailyRevenue, REVENUE_WINDOW_MS } from "../../server/finances.js";
import { applyMiningOperations } from "../../server/gameState.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// Bug #984: dailyRevenue was a lifetime total that only ever grew, fed by three different rates, and the Overview
// subtracted a per-day cost rate from it. It is now the income booked in the last 24 hours, from recordIncome alone.
const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

describe("dailyRevenue is the income of the last 24 hours (Bug #984)", () => {
  it("is the sum of what recordIncome booked inside the window", () => {
    const corp = makeCorp({ finances: { dailyRevenue: 0 } });
    recordIncome(corp, "exchange", 1000, T0);
    recordIncome(corp, "exchange", 500, T0 + 2 * HOUR);
    expect(corp.finances.dailyRevenue).toBe(1500);
    expect(corp.finances.incomeBySource.exchange).toBe(1500);
  });

  it("forgets income older than 24 hours, and the lifetime figures keep it", () => {
    const corp = makeCorp({ finances: { dailyRevenue: 0 } });
    recordIncome(corp, "exchange", 1000, T0);
    recordIncome(corp, "exchange", 500, T0 + 20 * HOUR);
    refreshDailyRevenue(corp, T0 + 25 * HOUR);
    expect(REVENUE_WINDOW_MS).toBe(24 * HOUR);
    expect(corp.finances.dailyRevenue).toBe(500);
    refreshDailyRevenue(corp, T0 + 45 * HOUR);
    expect(corp.finances.dailyRevenue).toBe(0);
    expect(corp.finances.lifetimeRevenue).toBe(1500);
    expect(corp.finances.incomeBySource.exchange).toBe(1500);
  });

  it("replaces an old save's ever-growing total with what the window holds", () => {
    const corp = makeCorp({ finances: { dailyRevenue: 987654 } });
    refreshDailyRevenue(corp, T0);
    expect(corp.finances.dailyRevenue).toBe(0);
  });
});

describe("mining books no revenue (Bug #984)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("adds silicates to inventory and nothing to income", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const corp = makeCorp({
      finances: { dailyRevenue: 0 },
      mining: { silicateExtractors: [makeExtractor({ startedAt: T0, lastTickAt: T0, endsAt: T0 + HOUR })] }
    });
    applyMiningOperations(corp, T0 + 10 * 60_000);
    expect(corp.mining.silicateExtractors[0].totalMined).toBeGreaterThan(0);
    expect(corp.finances.dailyRevenue).toBe(0);
    expect(corp.finances.incomeBySource?.mining).toBeUndefined();
  });
});
