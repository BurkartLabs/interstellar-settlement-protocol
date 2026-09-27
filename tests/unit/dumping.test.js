import { describe, it, expect } from "vitest";
import { assess, normalOf, watchDays } from "../../server/game/dumping.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";

// ISP-232 (AB#927): the ITC's dumping rule (docs/design/WARFARE.md), at each boundary: price, volume, size and window,
// with the catalog's own terms (85%, 10% of normal volume over 3 days, 25,000, the full margin).
const T = WARFARE_CATALOG.dumping;
const normal = { price: 100, dailyVolume: 1000 }; // the volume line: 10% x 1,000 x 3 = 300 units
const sale = (quantity, unitPrice, id = `s${quantity}-${unitPrice}`) => ({ id, quantity, unitPrice });

describe("the dumping rule (AB#927)", () => {
  it("counts only sales strictly below 85% of normal value", () => {
    expect(assess([sale(400, 85)], normal, T)).toMatchObject({ found: false, Q: 0 });
    expect(assess([sale(400, 84.99)], normal, T)).toMatchObject({ found: true, Q: 400 });
    const mixed = assess([sale(400, 60, "a"), sale(1000, 95, "b")], normal, T);
    expect(mixed).toMatchObject({ found: true, Q: 400, P: 60, dumped: ["a"] }); // a sale at a fair price is no part of it
  });

  it("needs a tenth of the market's normal volume for the window", () => {
    expect(assess([sale(299, 60)], normal, T)).toMatchObject({ found: false, volumeLine: 300 });
    expect(assess([sale(300, 60)], normal, T)).toMatchObject({ found: true });
  });

  it("needs the dumped units to be worth 25,000 at normal value, however thin the market", () => {
    const thin = { price: 100, dailyVolume: 100 }; // a volume line of 30 units
    expect(assess([sale(249, 60)], thin, T).found).toBe(false); // 24,900
    expect(assess([sale(250, 60)], thin, T).found).toBe(true); // 25,000
  });

  it("levies the margin and never more: (N - P_d) x Q_d", () => {
    expect(assess([sale(200, 50, "a"), sale(400, 65, "b")], normal, T)).toMatchObject({ found: true, Q: 600, P: 60, duty: 24_000 });
  });

  it("has no normal value, and so no finding, without minTradedDays of trades (fails closed)", () => {
    const days = ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
    const b = (day, volume, value, close = value / volume) => ({ day, open: close, high: close, low: close, close, volume, trades: 1, value });
    expect(normalOf([b(days[0], 100, 10_000), b(days[3], 100, 10_000)], days, T)).toBeNull();
    expect(assess([sale(5000, 1)], null, T)).toMatchObject({ found: false });
    const three = normalOf([b(days[0], 100, 10_000), b(days[3], 300, 36_000), b(days[6], 100, 14_000)], days, T);
    expect(three).toEqual({ price: 60_000 / 500, dailyVolume: 500 / 7 });
    const legacy = normalOf([{ day: days[0], close: 90, volume: 100 }, b(days[1], 100, 10_000), b(days[2], 100, 10_000)], days, T);
    expect(legacy.price).toBe(29_000 / 300); // a bucket without a value counts its close x volume
  });

  it("reads the 3 complete UTC days before today, against the 7 before them", () => {
    const d = watchDays(Date.parse("2026-09-27T05:00:00Z"), T);
    expect(d.window).toEqual(["2026-09-24", "2026-09-25", "2026-09-26"]);
    expect(d.normal).toEqual(["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]);
    expect([d.windowStartAt, d.windowEndAt]).toEqual([Date.parse("2026-09-24T00:00:00Z"), Date.parse("2026-09-27T00:00:00Z")]);
  });
});
