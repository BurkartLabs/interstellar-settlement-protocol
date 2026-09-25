import { describe, it, expect, vi, afterEach } from "vitest";
import { applyMiningOperations, startExtractorCycle } from "../../server/gameState.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";
import { activeCycleFigures } from "../../public/scripts/leaseLive.js";

// AB#746 (ISP-60): a running cycle shows what it has cost so far. The server keeps spentThisCycle beside
// minedThisCycle (AB#575): the startup cost when the cycle starts, plus what each tick actually charged, so the figure
// is what left the balance, not an estimate from the clock.
const HOUR = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

describe("spent this cycle (AB#746)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts at the startup cost, adds each tick's charge, and restarts with the next cycle; totalSpent keeps the lifetime", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime
    const corp = makeCorp({ mining: { silicateExtractors: [makeExtractor({ active: false, startedAt: null, endsAt: null, lastTickAt: null, totalSpent: 0 })] } });
    corp.finances.credits = 1_000_000;
    const ex = () => corp.mining.silicateExtractors[0];

    startExtractorCycle(ex(), { now: T0, hours: 2, throughputPerHour: 100, operationCostPerHour: 3000, startupCost: 500 });
    expect(ex().spentThisCycle).toBe(500);
    applyMiningOperations(corp, T0 + HOUR);
    expect(ex().spentThisCycle).toBe(3500);
    applyMiningOperations(corp, T0 + 2 * HOUR);
    expect(ex().spentThisCycle).toBe(6500);
    expect(ex().totalSpent).toBe(6500);

    startExtractorCycle(ex(), { now: T0 + 3 * HOUR, hours: 1, throughputPerHour: 100, operationCostPerHour: 3000, startupCost: 500 });
    expect(ex().spentThisCycle).toBe(500);
    expect(ex().totalSpent).toBe(7000);
  });

  it("counts what was charged, not what was due: a corporation that runs out pays less, and the figure says so", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const corp = makeCorp({ mining: { silicateExtractors: [makeExtractor({ active: false, startedAt: null, endsAt: null, lastTickAt: null, totalSpent: 0 })] } });
    corp.finances.credits = 1000;
    const ex = corp.mining.silicateExtractors[0];
    startExtractorCycle(ex, { now: T0, hours: 4, throughputPerHour: 100, operationCostPerHour: 3000, startupCost: 0 });
    applyMiningOperations(corp, T0 + HOUR);
    expect(ex.spentThisCycle).toBeLessThanOrEqual(1000);
    expect(ex.spentThisCycle).toBe(ex.totalSpent);
  });
});

describe("the figures a running cycle shows (AB#746)", () => {
  const ex = { active: true, startedAt: T0, endsAt: T0 + 4 * HOUR, throughputPerHour: 120, operationCostPerHour: 2000, minedThisCycle: 130, spentThisCycle: 2600 };

  it("spent is the server's spentThisCycle, the rate is the cycle's t/h, and the bar is the elapsed fraction", () => {
    const f = activeCycleFigures(ex, T0 + HOUR);
    expect(f).toMatchObject({ pct: 25, mined: 130, spent: 2600, spentEstimated: false, rate: 120, hrs: 3, mins: 0 });
  });

  it("the bar is worked out from the cycle's own times, so a reload an hour in shows the same fill", () => {
    expect(activeCycleFigures({ ...ex }, T0 + HOUR).pct).toBe(activeCycleFigures(JSON.parse(JSON.stringify(ex)), T0 + HOUR).pct);
    expect(activeCycleFigures(ex, T0 + 60_000).pct).toBe(0);
    expect(activeCycleFigures(ex, T0 + 2 * HOUR).pct).toBe(50);
    expect(activeCycleFigures(ex, T0 + 9 * HOUR).pct).toBe(100);
  });

  it("a minute into a 4-hour cycle the bar is not flat: it fills 0.4% and the label says <1%, not 0%", () => {
    const f = activeCycleFigures(ex, T0 + 60_000);
    expect(f.pct).toBe(0);
    expect(f.fill).toBeCloseTo(100 / 240, 5);
    expect(f.pctText).toBe("<1%");
    expect(activeCycleFigures(ex, T0).pctText).toBe("0%");
  });

  it("a cycle started before spentThisCycle existed shows an estimate from the clock, and says it is one", () => {
    const { spentThisCycle: _old, ...legacy } = ex;
    const f = activeCycleFigures(legacy, T0 + HOUR);
    expect(f.spent).toBe(2000);
    expect(f.spentEstimated).toBe(true);
  });
});
