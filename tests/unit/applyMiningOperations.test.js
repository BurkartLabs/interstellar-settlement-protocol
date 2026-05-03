import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyMiningOperations } from "../../server/gameState.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// Math.random is used for downtime/recovery rolls. We pin it per test so
// stochastic branches are deterministic.
function pinRandom(value) {
  return vi.spyOn(Math, "random").mockReturnValue(value);
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
      expect(ext.downtimeStartedAt).toBe(start + 6 * 60 * 1000);
      expect(ext.totalMined).toBe(0); // mining paused on the trigger tick
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

    it("recovers from downtime after the minimum window when the roll succeeds", () => {
      pinRandom(0); // any roll < tickProb recovers
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
      expect(ext.downtimeRecoveredAt).toBe(now);
      expect(ext.lastTickAt).toBe(now);
    });

    it("industrial-safety tech reduces downtime probability", () => {
      // Pick a random value that is between the safety-reduced threshold and
      // the unsafe threshold for a 6-minute tick at base risk.
      // base p/sec = 0.00005; safety = base * 0.92 = 0.000046
      // 360 sec → tickProb_base ≈ 0.01784  ;  tickProb_safe ≈ 0.01642
      // Any random in (0.01642, 0.01784) triggers without safety, not with.
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
