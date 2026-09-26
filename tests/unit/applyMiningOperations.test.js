import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyMiningOperations } from "../../server/gameState.js";
import { yardUpkeepPerHourFor } from "../../server/economy.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// Math.random is used for downtime/recovery rolls. We pin it per test so
// stochastic branches are deterministic.
function pinRandom(value) {
  return vi.spyOn(Math, "random").mockReturnValue(value);
}

/** Math.random answering these values in turn, then the last one for ever (AB#2296: one draw per event). */
function pinRandomSequence(values) {
  let i = 0;
  return vi.spyOn(Math, "random").mockImplementation(() => values[Math.min(i++, values.length - 1)]);
}

describe("applyMiningOperations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("inactive extractors", () => {
    it("does not mine, charge credits, or trigger downtime", () => {
      pinRandom(0); // would trigger downtime if it ran
      const startCredits = 1_000_000;
      const corp = makeCorp({
        finances: { credits: startCredits, dailyRevenue: 0 },
        mining: { silicateExtractors: [makeExtractor({ active: false })] }
      });

      applyMiningOperations(corp, Date.now());

      const ext = corp.mining.silicateExtractors[0];
      expect(ext.totalMined).toBe(0);
      expect(ext.totalSpent).toBe(0);
      expect(ext.downtimeActive).toBe(false);
      expect(corp.finances.credits).toBe(startCredits);
    });
  });

  describe("normal mining", () => {
    it("credits silicates to the lease body's station and decreases time", () => {
      pinRandom(0.999); // never trigger downtime
      const start = 1_700_000_000_000;
      const extractor = makeExtractor({
        startedAt: start,
        lastTickAt: start,
        endsAt: start + 60 * 60 * 1000,
        throughputPerHour: 600,
        operationCostPerHour: 0,
        leaseId: "lease-1"
      });
      const corp = makeCorp({
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: { silicateExtractors: [extractor] }
      });

      // Advance 6 minutes (= 0.1 hours) → expect 60 silicates at 600/hr
      applyMiningOperations(corp, start + 6 * 60 * 1000);

      const ext = corp.mining.silicateExtractors[0];
      expect(ext.totalMined).toBe(60);
      expect(ext.lastTickAt).toBe(start + 6 * 60 * 1000);
      // Earth → earth-station-prime
      expect(corp.inventory["earth-station-prime"].Silicates).toBe(60);
    });

    it("applies the basic-extraction tech multiplier (+10%)", () => {
      pinRandom(0.999);
      const start = 1_700_000_000_000;
      const corp = makeCorp({
        unlockedTech: ["tt-basic-extraction"],
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              startedAt: start,
              lastTickAt: start,
              endsAt: start + 60 * 60 * 1000,
              throughputPerHour: 1000,
              leaseId: "lease-1"
            })
          ]
        }
      });

      // 1 hour worth of mining at 1000/hr × 1.10 = 1100
      applyMiningOperations(corp, start + 60 * 60 * 1000);

      expect(corp.mining.silicateExtractors[0].totalMined).toBe(1100);
    });

    it("stacks basic-extraction (+10%) and supply-forecast (+6%) multiplicatively", () => {
      pinRandom(0.999);
      const start = 1_700_000_000_000;
      const corp = makeCorp({
        unlockedTech: ["tt-basic-extraction", "tt-supply-forecast"],
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              startedAt: start,
              lastTickAt: start,
              endsAt: start + 60 * 60 * 1000,
              throughputPerHour: 1000,
              leaseId: "lease-1"
            })
          ]
        }
      });

      applyMiningOperations(corp, start + 60 * 60 * 1000);

      // 1000 * 1.1 * 1.06 = 1166
      expect(corp.mining.silicateExtractors[0].totalMined).toBe(1166);
    });

    it("deducts operating cost from credits and tracks totalSpent", () => {
      pinRandom(0.999);
      const start = 1_700_000_000_000;
      const corp = makeCorp({
        finances: { credits: 10_000, dailyRevenue: 0 },
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              startedAt: start,
              lastTickAt: start,
              endsAt: start + 60 * 60 * 1000,
              throughputPerHour: 600,
              operationCostPerHour: 1000,
              leaseId: "lease-1"
            })
          ]
        }
      });

      // 0.1h × 1000 = 100 credits cost
      applyMiningOperations(corp, start + 6 * 60 * 1000);

      const ext = corp.mining.silicateExtractors[0];
      expect(corp.finances.credits).toBe(9_900);
      expect(ext.totalSpent).toBe(100);
    });

    it("scales output by affordability when credits cannot cover full cost", () => {
      pinRandom(0.999);
      const start = 1_700_000_000_000;
      const corp = makeCorp({
        finances: { credits: 50, dailyRevenue: 0 }, // can only cover half of 100
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              startedAt: start,
              lastTickAt: start,
              endsAt: start + 60 * 60 * 1000,
              throughputPerHour: 600,
              operationCostPerHour: 1000,
              leaseId: "lease-1"
            })
          ]
        }
      });

      applyMiningOperations(corp, start + 6 * 60 * 1000);

      const ext = corp.mining.silicateExtractors[0];
      // affordabilityRatio = 50/100 = 0.5 → mined ≈ 30, cost = 50, credits → 0
      expect(ext.totalMined).toBe(30);
      expect(corp.finances.credits).toBe(0);
      // Underfunded ticks stop the cycle
      expect(ext.active).toBe(false);
    });

    // ISP-301 (AB#2284): a yard's upkeep is part of its running cost, so a corporation short of credit mines less with
    // it and owes nothing; the first yard, charged first and paying no upkeep, runs in full. The second extractor here
    // carries the upkeep of a paying yard, the third since ISP-308 (AB#2304).
    it("with too little credit, a later yard paying upkeep mines in proportion and records no debt; the first runs in full", () => {
      pinRandom(0.999);
      const start = 1_700_000_000_000;
      const cycle = { startedAt: start, lastTickAt: start, endsAt: start + 60 * 60 * 1000, throughputPerHour: 600, leaseId: "lease-1" };
      const corp = makeCorp({
        finances: { credits: 150, dailyRevenue: 0 }, // the first yard's 6 minutes (100) and about half the second's (104.17)
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({ ...cycle, id: "ext-basic-1", operationCostPerHour: 1000 + yardUpkeepPerHourFor(0) }),
            makeExtractor({ ...cycle, id: "ext-basic-2", operationCostPerHour: 1000 + yardUpkeepPerHourFor(2) })
          ]
        }
      });
      const financeKeysBefore = Object.keys(corp.finances).sort();

      applyMiningOperations(corp, start + 6 * 60 * 1000);

      const [first, second] = corp.mining.silicateExtractors;
      expect(first.totalMined).toBe(60);
      expect(first.totalSpent).toBe(100);
      // 50 of 104.17 left: ratio 0.48, so 28 of 60 tonnes, and exactly the 50 credits there were.
      expect(second.totalMined).toBe(28);
      expect(second.totalSpent).toBe(50);
      expect(corp.finances.credits).toBe(0);
      expect(Object.keys(corp.finances).filter((k) => !financeKeysBefore.includes(k) && /arrear|owed|debt|upkeep/i.test(k))).toEqual([]);
    });

    it("carries fractional mined output via minedRemainder across ticks", () => {
      pinRandom(0.999);
      const start = 1_700_000_000_000;
      const corp = makeCorp({
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              startedAt: start,
              lastTickAt: start,
              endsAt: start + 60 * 60 * 1000,
              throughputPerHour: 100,   // ~0.0277 per second
              leaseId: "lease-1"
            })
          ]
        }
      });

      // Tick 1: 5 seconds → 0.1388... mined → floored to 0, remainder > 0.
      // ensureCorpMiningModel re-normalizes into a new object on every call,
      // so always re-read from the corp after applyMiningOperations.
      applyMiningOperations(corp, start + 5_000);
      let ext = corp.mining.silicateExtractors[0];
      expect(ext.totalMined).toBe(0);
      expect(ext.minedRemainder).toBeGreaterThan(0);

      // Several more ticks should accumulate at least one whole unit
      for (let i = 1; i <= 20; i++) {
        applyMiningOperations(corp, start + 5_000 * (i + 1));
      }
      ext = corp.mining.silicateExtractors[0];
      expect(ext.totalMined).toBeGreaterThan(0);
    });
  });

  describe("downtime", () => {
    it("triggers downtime when the random roll falls below the threshold", () => {
      pinRandom(0); // guarantees downtime trigger
      const start = 1_700_000_000_000;
      const corp = makeCorp({
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              startedAt: start,
              lastTickAt: start,
              endsAt: start + 60 * 60 * 1000,
              throughputPerHour: 600,
              leaseId: "lease-1"
            })
          ]
        }
      });

      applyMiningOperations(corp, start + 6 * 60 * 1000);

      const ext = corp.mining.silicateExtractors[0];
      expect(ext.downtimeActive).toBe(true);
      // AB#2296: a roll of 0 is a breakdown at once, so it started where settling began, not when the account was read.
      expect(ext.downtimeStartedAt).toBe(start);
      expect(ext.totalMined).toBe(0);
      expect(ext.lastTickAt).toBe(start + 6 * 60 * 1000);
    });

    it("does not allow recovery before the 15-minute minimum downtime", () => {
      pinRandom(0); // would otherwise allow recovery
      const start = 1_700_000_000_000;
      const corp = makeCorp({
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              active: true,
              downtimeActive: true,
              downtimeStartedAt: start,
              startedAt: start,
              lastTickAt: start,
              leaseId: "lease-1"
            })
          ]
        }
      });

      // Only 5 minutes have passed
      applyMiningOperations(corp, start + 5 * 60 * 1000);

      expect(corp.mining.silicateExtractors[0].downtimeActive).toBe(true);
    });

    it("recovers from downtime after the minimum window when the roll succeeds, and mines from the recovery on", () => {
      pinRandomSequence([0, 0.999]); // recovery at once when the minimum is over; then no further breakdown
      const start = 1_700_000_000_000;
      const downStart = start;
      const corp = makeCorp({
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              active: true,
              downtimeActive: true,
              downtimeStartedAt: downStart,
              startedAt: start,
              lastTickAt: downStart,
              leaseId: "lease-1"
            })
          ]
        }
      });

      // 16 minutes after downtime started → past 15 min minimum
      const now = downStart + 16 * 60 * 1000;
      applyMiningOperations(corp, now);

      const ext = corp.mining.silicateExtractors[0];
      expect(ext.downtimeActive).toBe(false);
      expect(ext.downtimeStartedAt).toBeNull();
      // AB#2296: recovered when the 15 minutes were up, not when the account was next read, and mined the minute since.
      expect(ext.downtimeRecoveredAt).toBe(downStart + 15 * 60 * 1000);
      expect(ext.lastTickAt).toBe(now);
      expect(ext.totalMined).toBe(10); // 600 t/h for one minute
    });

    it("industrial-safety tech reduces downtime probability", () => {
      // A roll of 0.0170 puts the breakdown ln(0.983) / ln(1 - p) seconds in (AB#2296): at base risk (p = 0.00005)
      // about 343 s, inside a 6-minute tick; with safety (p = 0.000046) about 373 s, after it.
      pinRandom(0.0170);
      const start = 1_700_000_000_000;

      const safeCorp = makeCorp({
        unlockedTech: ["tt-industrial-safety"],
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              startedAt: start,
              lastTickAt: start,
              endsAt: start + 60 * 60 * 1000,
              throughputPerHour: 600,
              leaseId: "lease-1"
            })
          ]
        }
      });
      applyMiningOperations(safeCorp, start + 6 * 60 * 1000);
      expect(safeCorp.mining.silicateExtractors[0].downtimeActive).toBe(false);

      const unsafeCorp = makeCorp({
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        mining: {
          silicateExtractors: [
            makeExtractor({
              startedAt: start,
              lastTickAt: start,
              endsAt: start + 60 * 60 * 1000,
              throughputPerHour: 600,
              leaseId: "lease-1"
            })
          ]
        }
      });
      applyMiningOperations(unsafeCorp, start + 6 * 60 * 1000);
      expect(unsafeCorp.mining.silicateExtractors[0].downtimeActive).toBe(true);
    });
  });
});

// Bug #1138: the running cost was rounded on every call with nothing carried, and the mining step runs on every
// account read and around every write as well as on the 5-second ticker. Calls under ~2.8 s at 640/h each charged 0
// while using up the time, so polling your own account made a cycle free; the ticker's own 5 s calls rounded 0.89 up
// to 1 and overcharged. However the hour is sliced, it now costs what one call over the hour costs.
describe("running costs are the same however the time is sliced (Bug #1138)", () => {
  afterEach(() => vi.restoreAllMocks());

  const HOUR = 60 * 60 * 1000;
  function cycleCorp(start) {
    return makeCorp({
      finances: { credits: 1_000_000, dailyRevenue: 0 },
      miningLeases: [{ id: "lease-1", body: "Earth" }],
      mining: {
        silicateExtractors: [makeExtractor({
          startedAt: start, lastTickAt: start, endsAt: start + HOUR,
          throughputPerHour: 40, operationCostPerHour: 640, leaseId: "lease-1"
        })]
      }
    });
  }
  function runSliced(stepMs) {
    const start = 1_700_000_000_000;
    const corp = cycleCorp(start);
    for (let t = start + stepMs; t <= start + HOUR; t += stepMs) applyMiningOperations(corp, t);
    return corp;
  }

  it("one call over the hour charges the hourly rate", () => {
    pinRandom(0.999);
    const corp = runSliced(HOUR);
    expect(corp.mining.silicateExtractors[0].totalSpent).toBe(640);
    expect(corp.finances.credits).toBe(1_000_000 - 640);
  });

  it("36,000 reads 100 ms apart charge the same as one call, not nothing", () => {
    pinRandom(0.999);
    const corp = runSliced(100);
    expect(corp.mining.silicateExtractors[0].totalSpent).toBe(640);
    expect(corp.finances.credits).toBe(1_000_000 - 640);
  });

  it("the 5-second ticker charges the hourly rate, not 720", () => {
    pinRandom(0.999);
    const corp = runSliced(5000);
    expect(corp.mining.silicateExtractors[0].totalSpent).toBe(640);
  });

  // It carried its fraction, but floating-point drift over many slices floored the last ton away: 39 of 40.
  it("yield is the same however the hour is sliced", () => {
    pinRandom(0.999);
    expect(runSliced(100).mining.silicateExtractors[0].totalMined).toBe(runSliced(HOUR).mining.silicateExtractors[0].totalMined);
  });

  it("keeps the unpaid fraction of a credit on the extractor, never negative and under 1", () => {
    pinRandom(0.999);
    const start = 1_700_000_000_000;
    const corp = cycleCorp(start);
    applyMiningOperations(corp, start + 1000); // 1 s at 640/h is 0.178 credits
    const ext = corp.mining.silicateExtractors[0];
    expect(ext.totalSpent).toBe(0);
    expect(ext.costRemainder).toBeGreaterThan(0.17);
    expect(ext.costRemainder).toBeLessThan(1);
  });
});

// AB#2296: a breakdown drawn while settling a long interval forfeited the whole interval, so a cycle's output depended
// on how often the account was read (the class Bug #1138 fixed for fees). Now the breakdown falls at a drawn moment
// inside the interval, and what came before it is mined.
describe("breakdowns fall inside the interval, and output does not depend on how often it is read (AB#2296)", () => {
  afterEach(() => vi.restoreAllMocks());

  const HOUR = 60 * 60 * 1000;
  const P = 0.00005; // extractorDowntimeProbPerSec with no research
  function hourCorp(start) {
    return makeCorp({
      finances: { credits: 1_000_000, dailyRevenue: 0 },
      miningLeases: [{ id: "lease-1", body: "Earth" }],
      mining: {
        silicateExtractors: [makeExtractor({ startedAt: start, lastTickAt: start, endsAt: start + HOUR, throughputPerHour: 120, operationCostPerHour: 0, leaseId: "lease-1" })]
      }
    });
  }

  it("a breakdown drawn 50 minutes into an hour settled in one call still yields those 50 minutes: 100 t", () => {
    const start = 1_700_000_000_000;
    // The roll that puts the first breakdown 3,000 s in: P(within s) = 1 - (1 - p)^s.
    pinRandom(1 - Math.pow(1 - P, 3000));
    const corp = hourCorp(start);
    applyMiningOperations(corp, start + HOUR);
    const ext = corp.mining.silicateExtractors[0];
    expect(ext.totalMined).toBe(100);
    expect(ext.downtimeActive).toBe(true);
    expect(ext.downtimeStartedAt).toBe(start + 50 * 60 * 1000);
  });

  it("an hour settled in one call and in 720 calls five seconds apart mines the same on average", () => {
    // A seeded generator (mulberry32) in place of Math.random, so the comparison is the same on every run.
    const seeded = (seed) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const RUNS = 1000;
    const start = 1_700_000_000_000;
    const minedIn = (stepMs, seed) => {
      vi.spyOn(Math, "random").mockImplementation(seeded(seed));
      const corp = hourCorp(start);
      for (let t = start + stepMs; t <= start + HOUR; t += stepMs) applyMiningOperations(corp, t);
      vi.restoreAllMocks();
      return corp.mining.silicateExtractors[0].totalMined;
    };
    let once = 0;
    let sliced = 0;
    for (let r = 0; r < RUNS; r++) {
      once += minedIn(HOUR, 1 + r);
      sliced += minedIn(5_000, 100_001 + r);
    }
    const meanOnce = once / RUNS;
    const meanSliced = sliced / RUNS;
    // Without breakdowns an hour is 120 t; about one hour in six has one, so the mean sits a little below.
    expect(meanOnce).toBeGreaterThan(100);
    expect(meanOnce).toBeLessThan(120);
    expect(Math.abs(meanOnce - meanSliced) / meanSliced, `one call ${meanOnce.toFixed(2)} t, sliced ${meanSliced.toFixed(2)} t`).toBeLessThan(0.03);
  }, 120_000);
});
