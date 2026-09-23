// ISP-86 (AB#775, Depth Critique #426 epic 2, T-018): the operating cost curves, so the throughput a player sets
// is a decision rather than a formality. These tests are about the shape of the curve, not about any one number:
// the numbers live in data/economy.json and are meant to move in the balance pass (ISP-42).

import { describe, it, expect } from "vitest";
import { ECONOMY, operationCostPerHourFor, startupCostFor, miningProfitPerHourFor, bestThroughputFor } from "../../server/economy.js";

const MIN = 10;
const MAX = 250;
const SILICATES = { unitPrice: 24, taxPct: ECONOMY.exchange.salesTaxPct };

describe("the operating cost rises faster than the rate (ISP-86)", () => {
  it("costs more per unit at a high rate than at a low one", () => {
    const perUnit = (t) => operationCostPerHourFor(t) / t;
    // Above the floor, every step up costs more per unit than the step below it.
    expect(perUnit(200)).toBeGreaterThan(perUnit(100));
    expect(perUnit(100)).toBeGreaterThan(perUnit(60));
  });

  it("never falls as the rate rises, and is never free", () => {
    let last = 0;
    for (let t = MIN; t <= MAX; t += 1) {
      const cost = operationCostPerHourFor(t);
      expect(cost).toBeGreaterThanOrEqual(last);
      expect(cost).toBeGreaterThanOrEqual(ECONOMY.operations.minCostPerHour);
      last = cost;
    }
  });

  it("is a tax on rate and never on access: every throughput the rules allow can still be started", () => {
    // "Startable" is what the start-mining route asks: a startup cost that a corporation with the opening balance
    // can pay. The opening balance is 250,000 credits.
    for (let t = MIN; t <= MAX; t += 1) {
      expect(startupCostFor(operationCostPerHourFor(t))).toBeLessThan(250_000);
    }
  });
});

describe("profit per hour has a maximum inside the range (ISP-86)", () => {
  it("does not pay best at the top of the range", () => {
    const best = bestThroughputFor(SILICATES);
    expect(best.throughput).toBeGreaterThan(MIN);
    expect(best.throughput).toBeLessThan(MAX);
    expect(best.profitPerHour).toBeGreaterThan(miningProfitPerHourFor(MAX, SILICATES).profitPerHour);
  });

  it("moves when the research changes, which is what makes it a decision", () => {
    const plain = bestThroughputFor(SILICATES).throughput;
    // The extraction technologies multiply what an hour yields; the best rate rises with them.
    const researched = bestThroughputFor({ ...SILICATES, efficiency: 1.1 * 1.06 }).throughput;
    expect(researched).toBeGreaterThan(plain);
  });

  it("moves when the price changes", () => {
    const dearer = bestThroughputFor({ ...SILICATES, unitPrice: SILICATES.unitPrice * 1.5 }).throughput;
    const cheaper = bestThroughputFor({ ...SILICATES, unitPrice: SILICATES.unitPrice * 0.75 }).throughput;
    expect(dearer).toBeGreaterThan(cheaper);
  });

  it("makes the top of the range a worse deal than the best, but still a deal", () => {
    const best = bestThroughputFor(SILICATES);
    const top = miningProfitPerHourFor(MAX, SILICATES);
    expect(top.profitPerHour).toBeGreaterThan(0); // never a trap: the maximum still earns
    expect(top.profitPerHour).toBeLessThan(best.profitPerHour * 0.95); // but it is a real cost to ignore the curve
  });
});

describe("what the panel is told (ISP-86)", () => {
  it("reports revenue, cost and the difference for one hour at a rate", () => {
    const at = miningProfitPerHourFor(100, SILICATES);
    expect(at.revenuePerHour).toBe(Math.round(100 * 24 * (1 - ECONOMY.exchange.salesTaxPct / 100)));
    expect(at.costPerHour).toBe(operationCostPerHourFor(100));
    expect(at.profitPerHour).toBe(at.revenuePerHour - at.costPerHour);
  });

  it("reads the curve's constant from data/economy.json, so the balance pass is a diff of that file", () => {
    expect(ECONOMY.operations.throughputReferencePerHour).toBeGreaterThan(0);
  });
});
