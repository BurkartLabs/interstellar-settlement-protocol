import { describe, it, expect, vi, afterEach } from "vitest";
import { applyMiningOperations, startExtractorCycle } from "../../server/gameState.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// AB#575: the extractor panel's "Mined this cycle" showed the lifetime total. It was right on a player's first cycle
// and too high on every cycle after, in the flattering direction.
const HOUR = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function runCycle(corp, startAt, hours) {
  startExtractorCycle(corp.mining.silicateExtractors[0], {
    now: startAt, hours, throughputPerHour: 600, operationCostPerHour: 0, startupCost: 0
  });
  applyMiningOperations(corp, startAt + hours * HOUR / 2);
  const half = { ...corp.mining.silicateExtractors[0] };
  applyMiningOperations(corp, startAt + hours * HOUR);
  return { half, end: { ...corp.mining.silicateExtractors[0] } };
}

describe("mined this cycle (AB#575)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resets when a second cycle starts, while totalMined keeps the lifetime", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime
    const corp = makeCorp({ mining: { silicateExtractors: [makeExtractor({ active: false, startedAt: null, endsAt: null, lastTickAt: null })] } });

    const first = runCycle(corp, T0, 1);
    expect(first.end.minedThisCycle).toBe(600);
    expect(first.end.totalMined).toBe(600);

    const second = runCycle(corp, T0 + 2 * HOUR, 1);
    expect(second.half.minedThisCycle).toBe(300);
    expect(second.half.totalMined).toBe(900);
    expect(second.end.minedThisCycle).toBe(600);
    expect(second.end.totalMined).toBe(1200);
  });

  it("startExtractorCycle sets the cycle and zeroes the per-cycle count, and nothing else", () => {
    const ex = makeExtractor({ active: false, totalMined: 5000, minedThisCycle: 800, totalSpent: 100 });
    startExtractorCycle(ex, { now: T0, hours: 4, throughputPerHour: 250, operationCostPerHour: 4000, startupCost: 1400 });
    expect(ex).toMatchObject({
      active: true, startedAt: T0, lastTickAt: T0, endsAt: T0 + 4 * HOUR,
      throughputPerHour: 250, operationCostPerHour: 4000, minedThisCycle: 0, totalMined: 5000, totalSpent: 1500
    });
  });
});
