import { describe, it, expect } from "vitest";
import { shapePriceHistory, priceChartSummary, chartDayKey } from "../../public/scripts/priceChart.js";

// AB#716: what the Exchange's price chart draws, from the server's daily buckets.
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2147, 2, 10, 15, 0, 0); // 2147-03-10
const b = (daysAgo, close, extra = {}) => ({ day: chartDayKey(NOW - daysAgo * DAY), open: close, high: close, low: close, close, volume: 10, trades: 1, ...extra });
const money = (n) => `$${n}`;

describe("shapePriceHistory (AB#716)", () => {
  it("lays out one entry per UTC day of the range, today last", () => {
    const s = shapePriceHistory([], 7, NOW);
    expect(s.days).toHaveLength(7);
    expect(s.days.at(-1)).toBe("2147-03-10");
    expect(s.days[0]).toBe("2147-03-04");
    expect(shapePriceHistory([], 30, NOW).days).toHaveLength(30);
  });

  it("puts each bucket's close and volume on its day, and leaves a gap on a day with no trades", () => {
    const s = shapePriceHistory([b(3, 22, { volume: 40 }), b(0, 25, { volume: 5 })], 7, NOW);
    expect(s.closes).toEqual([null, null, null, 22, null, null, 25]);
    expect(s.volumes).toEqual([0, 0, 0, 40, 0, 0, 5]);
  });

  it("takes the last close from the most recent bucket, which is the most recent trade price", () => {
    const s = shapePriceHistory([b(5, 20), b(1, 31), b(2, 28)], 7, NOW);
    expect(s.lastClose).toBe(31);
    expect(s.lastDay).toBe(chartDayKey(NOW - DAY));
    expect(s.closes.filter((c) => c !== null).at(-1)).toBe(31);
  });

  it("sums the range's volume and trades and finds its high and low from the buckets' own", () => {
    const s = shapePriceHistory([b(10, 99), b(2, 24, { high: 30, low: 20, volume: 7, trades: 3 }), b(0, 26, { high: 27, low: 18, volume: 3, trades: 2 })], 7, NOW);
    expect(s).toMatchObject({ high: 30, low: 18, volume: 10, trades: 5, hasInRange: true });
  });

  it("knows an item that last traded before the range, and one that never traded", () => {
    const old = shapePriceHistory([b(20, 17)], 7, NOW);
    expect(old).toMatchObject({ hasAny: true, hasInRange: false, lastClose: 17 });
    expect(old.closes.every((c) => c === null)).toBe(true);
    expect(shapePriceHistory([b(20, 17)], 30, NOW)).toMatchObject({ hasInRange: true });
    expect(shapePriceHistory(undefined, 7, NOW)).toMatchObject({ hasAny: false, lastClose: null, volume: 0 });
  });
});

describe("priceChartSummary (AB#716)", () => {
  it("says so for an item with no trades", () => {
    expect(priceChartSummary("Nickel", shapePriceHistory([], 7, NOW), 7, money)).toBe("No trades recorded yet for Nickel.");
  });

  it("gives the last trade, the range's high and low, and its volume", () => {
    const s = shapePriceHistory([b(1, 24, { high: 30, low: 20, volume: 1200, trades: 3 })], 7, NOW);
    expect(priceChartSummary("Silicates", s, 7, money))
      .toBe(`Last trade $24 on ${chartDayKey(NOW - DAY)}. 7-day high $30, low $20; 1,200 units in 3 trades.`);
  });

  it("says when the last trade is older than the range", () => {
    const s = shapePriceHistory([b(20, 17)], 7, NOW);
    expect(priceChartSummary("Carbon", s, 7, money)).toBe(`Last trade $17 on ${chartDayKey(NOW - 20 * DAY)}. No trades in the last 7 days.`);
  });
});
