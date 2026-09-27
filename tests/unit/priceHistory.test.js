import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { recordTrade, normalizePriceHistory, historyFor, tradeableItems, PRICE_HISTORY_ITEMS, PRICE_HISTORY_DAYS, dayKey } from "../../server/priceHistory.js";

// AB#715: the day's bucket per item, on a fake clock.
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2147, 2, 10, 9, 0, 0); // 2147-03-10 09:00 UTC
const bucket = (h, item, day) => (h[item] || []).find((b) => b.day === day);

describe("recordTrade (AB#715)", () => {
  it("opens the day's bucket on the first trade", () => {
    const h = {};
    expect(recordTrade(h, "Silicates", 24, 100, T0)).toBe(true);
    expect(h.Silicates).toEqual([{ day: "2147-03-10", open: 24, high: 24, low: 24, close: 24, volume: 100, trades: 1, value: 2400 }]); // value: ISP-232 (AB#927)
  });

  it("raises the high on a higher trade and lowers the low on a lower one; the close is the latest; volume and trades add", () => {
    const h = {};
    recordTrade(h, "Silicates", 24, 100, T0);
    recordTrade(h, "Silicates", 30, 10, T0 + 1000);
    expect(bucket(h, "Silicates", "2147-03-10")).toMatchObject({ open: 24, high: 30, low: 24, close: 30, volume: 110, trades: 2 });
    recordTrade(h, "Silicates", 20, 5, T0 + 2000);
    expect(bucket(h, "Silicates", "2147-03-10")).toEqual({ day: "2147-03-10", open: 24, high: 30, low: 20, close: 20, volume: 115, trades: 3, value: 2400 + 300 + 100 });
  });

  it("keeps the day's traded value, and a bucket saved without one starts from its close x volume (ISP-232, AB#927)", () => {
    const h = { Silicates: [{ day: "2147-03-10", open: 24, high: 24, low: 24, close: 24, volume: 100, trades: 1 }] };
    recordTrade(h, "Silicates", 30, 10, T0);
    expect(bucket(h, "Silicates", "2147-03-10").value).toBe(24 * 100 + 30 * 10);
  });

  it("starts a new bucket on a later day and leaves the earlier one alone", () => {
    const h = {};
    recordTrade(h, "Silicates", 24, 100, T0);
    recordTrade(h, "Silicates", 26, 50, T0 + DAY);
    expect(h.Silicates.map((b) => b.day)).toEqual(["2147-03-10", "2147-03-11"]);
    expect(bucket(h, "Silicates", "2147-03-10")).toMatchObject({ open: 24, close: 24, volume: 100, trades: 1 });
    expect(bucket(h, "Silicates", "2147-03-11")).toMatchObject({ open: 26, close: 26, volume: 50, trades: 1 });
  });

  it("keeps each item separate", () => {
    const h = {};
    recordTrade(h, "Silicates", 24, 100, T0);
    recordTrade(h, "Rare Earths", 140, 3, T0);
    expect(h.Silicates).toHaveLength(1);
    expect(h["Rare Earths"][0]).toMatchObject({ open: 140, volume: 3 });
  });

  it(`keeps ${PRICE_HISTORY_DAYS} days, today included, and drops the oldest`, () => {
    const h = {};
    recordTrade(h, "Silicates", 10, 1, T0);
    for (let d = 1; d < PRICE_HISTORY_DAYS; d += 1) recordTrade(h, "Silicates", 10 + d, 1, T0 + d * DAY);
    expect(h.Silicates).toHaveLength(PRICE_HISTORY_DAYS);
    expect(h.Silicates[0].day).toBe(dayKey(T0));
    recordTrade(h, "Silicates", 200, 1, T0 + PRICE_HISTORY_DAYS * DAY);
    expect(h.Silicates).toHaveLength(PRICE_HISTORY_DAYS);
    expect(h.Silicates[0].day).toBe(dayKey(T0 + DAY));
    expect(h.Silicates.at(-1)).toMatchObject({ day: dayKey(T0 + PRICE_HISTORY_DAYS * DAY), close: 200 });
  });

  it("drops a quiet item's old days when it next trades", () => {
    const h = {};
    recordTrade(h, "Nickel", 18, 1, T0);
    recordTrade(h, "Nickel", 19, 1, T0 + 200 * DAY);
    expect(h.Nickel.map((b) => b.day)).toEqual([dayKey(T0 + 200 * DAY)]);
  });

  it("files a late-arriving trade under its own day, in order", () => {
    const h = {};
    recordTrade(h, "Silicates", 24, 1, T0 + DAY);
    recordTrade(h, "Silicates", 22, 1, T0);
    expect(h.Silicates.map((b) => b.day)).toEqual(["2147-03-10", "2147-03-11"]);
  });

  it("ignores a trade with no positive price or quantity", () => {
    const h = {};
    for (const [p, q] of [[0, 1], [-5, 1], [NaN, 1], [24, 0], [24, -1], [24, "abc"], [Infinity, 1]]) {
      expect(recordTrade(h, "Silicates", p, q, T0)).toBe(false);
    }
    expect(h).toEqual({});
  });
});

describe("the catalog, saved history and the served shape (AB#715)", () => {
  const refinery = JSON.parse(readFileSync(new URL("../../data/refinery-chains.json", import.meta.url), "utf8"));

  it("covers every raw resource and every refinery output, and every other catalog item (AB#884), and nothing else", () => {
    const catalog = JSON.parse(readFileSync(new URL("../../data/items.json", import.meta.url), "utf8")).items.map((i) => i.name);
    expect(PRICE_HISTORY_ITEMS).toEqual(new Set([...tradeableItems(refinery), ...catalog]));
    expect(PRICE_HISTORY_ITEMS.has("Antimatter Drives")).toBe(true); // a Tier 4 product before any chain makes it
    for (const r of refinery.resourceCatalog) expect(PRICE_HISTORY_ITEMS.has(r)).toBe(true);
    for (const c of refinery.chains) for (const o of c.outputs) expect(PRICE_HISTORY_ITEMS.has(o.item)).toBe(true);
    for (const bad of ["__proto__", "constructor", "", "silicates", "Silicates ", "../state"]) expect(PRICE_HISTORY_ITEMS.has(bad)).toBe(false);
  });

  it("keeps a saved history of known items and well-formed buckets only", () => {
    const good = { day: "2147-03-10", open: 24, high: 30, low: 20, close: 25, volume: 10, trades: 2 };
    const saved = {
      Silicates: [good, { day: "yesterday", open: 1 }, { ...good, day: "2147-03-09", accountId: "acc-1" }],
      "Not A Thing": [good],
      ["__proto__"]: [good]
    };
    const clean = normalizePriceHistory(saved);
    expect(Object.keys(clean)).toEqual(["Silicates"]);
    expect(clean.Silicates.map((b) => b.day)).toEqual(["2147-03-09", "2147-03-10"]);
    expect(clean.Silicates[0]).not.toHaveProperty("accountId");
    expect(normalizePriceHistory(null)).toEqual({});
  });

  it("serves copies with prices, volumes and counts only", () => {
    const h = {};
    recordTrade(h, "Silicates", 24, 100, T0);
    h.Silicates[0].seller = "Some Corp";
    const out = historyFor(h, "Silicates");
    expect(Object.keys(out[0]).sort()).toEqual(["close", "day", "high", "low", "open", "trades", "volume"]);
    out[0].close = 999;
    expect(h.Silicates[0].close).toBe(24);
    expect(historyFor(h, "Nickel")).toEqual([]);
  });
});
