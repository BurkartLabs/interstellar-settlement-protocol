// ISP-86 (AB#775): the extractor panel's projection is the server's own arithmetic, fed the server's own numbers.
// The client keeps a copy of the formula so the panel can answer a keystroke without a round trip; this is the
// test that the copy cannot drift from the original.

import { describe, it, expect } from "vitest";
import { ECONOMY, operationCostPerHourFor, startupCostFor, miningProfitPerHourFor, bestThroughputFor } from "../../server/economy.js";
import { costPerHourFor, startupCostFor as clientStartup, miningProjection, bestThroughput } from "../../public/scripts/miningProjection.js";

const operations = ECONOMY.operations;
const SILICATES = ECONOMY.npcBuyers.find((b) => b.item === "Silicates");
const price = { operations, unitPrice: SILICATES.unitPrice, taxPct: ECONOMY.exchange.salesTaxPct };
const serverPrice = { unitPrice: SILICATES.unitPrice, taxPct: ECONOMY.exchange.salesTaxPct };

describe("the panel's projection is the server's rule (ISP-86)", () => {
  it("agrees on the running cost at every throughput the rules allow", () => {
    for (let t = 10; t <= 250; t += 1) {
      expect(costPerHourFor(t, operations), `throughput ${t}`).toBe(operationCostPerHourFor(t));
    }
  });

  it("agrees on what a cycle costs to start", () => {
    for (let t = 10; t <= 250; t += 10) {
      const cost = operationCostPerHourFor(t);
      expect(clientStartup(cost, operations)).toBe(startupCostFor(cost));
    }
  });

  it("agrees on revenue, cost and profit, with and without research", () => {
    for (const efficiency of [1, 1.1, 1.1 * 1.06]) {
      for (let t = 10; t <= 250; t += 7) {
        const client = miningProjection(t, { ...price, efficiency });
        const server = miningProfitPerHourFor(t, { ...serverPrice, efficiency });
        expect(client.revenuePerHour, `t=${t} eff=${efficiency}`).toBe(server.revenuePerHour);
        expect(client.costPerHour).toBe(server.costPerHour);
        expect(client.profitPerHour).toBe(server.profitPerHour);
      }
    }
  });

  it("agrees on which rate pays best, which is the number the panel suggests", () => {
    for (const efficiency of [1, 1.1 * 1.06]) {
      expect(bestThroughput({ ...price, efficiency }).throughputPerHour).toBe(bestThroughputFor({ ...serverPrice, efficiency }).throughput);
    }
  });

  it("falls back to the straight line when the server has not sent the curve's constant", () => {
    // An older server, or a bootstrap that failed: the panel still shows something honest rather than NaN.
    const { throughputReferencePerHour: _drop, ...withoutCurve } = operations;
    expect(costPerHourFor(100, withoutCurve)).toBe(Math.max(operations.minCostPerHour, 100 * operations.costPerThroughputUnit));
    expect(Number.isFinite(miningProjection(100, { ...price, operations: withoutCurve }).profitPerHour)).toBe(true);
  });
});
