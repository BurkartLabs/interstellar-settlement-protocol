import { describe, it, expect } from "vitest";
import { suggestedListingPrice, SUGGESTION_WINDOW_DAYS, FALLBACK_PRICE } from "../../public/scripts/suggestedPrice.js";

// AB#1166: Create Listing pre-fills a suggested price. It was a mean over every open listing on the public book, the
// standing bids and the viewer's own listed and cancelled rows, so one player listing 1 Silicates at $1,000,000,000
// moved everyone's suggestion from $24 to $166,666,687 (measured on a quiet book), for the cost of one unit. The
// suggestion now comes from what actually traded (the daily price history, AB#715) floored at the best standing bid:
// a listing costs nothing to post, a trade costs its buyer the price.
const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const day = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString().slice(0, 10);
const bucket = (daysAgo, close) => ({ day: day(daysAgo), open: close, high: close, low: close, close, volume: 5, trades: 1 });
const silicatesBid = { id: "npc-buy-silicates-daily", item: "Silicates", unitPrice: 24, remainingQty: 1000, totalQtyPerDay: 1000 };

describe("the suggested listing price (AB#1166)", () => {
  it("a quiet book offers the standing bid", () => {
    expect(suggestedListingPrice("Silicates", { orderBook: [], npcBuyOrders: [silicatesBid], priceHistory: {} }, NOW)).toBe(24);
  });

  it("one listing at $1,000,000,000 does not move it", () => {
    const market = { orderBook: [{ type: "sell", item: "Silicates", quantity: 1, unitPrice: 1_000_000_000 }], npcBuyOrders: [silicatesBid], priceHistory: {} };
    expect(suggestedListingPrice("Silicates", market, NOW)).toBe(24);
  });

  it("follows the most recent trade in the window, above the bid", () => {
    const market = { npcBuyOrders: [silicatesBid], priceHistory: { Silicates: [bucket(3, 28), bucket(1, 30)] }, orderBook: [{ type: "sell", item: "Silicates", quantity: 1, unitPrice: 1_000_000_000 }] };
    expect(suggestedListingPrice("Silicates", market, NOW)).toBe(30);
  });

  it("is never below the standing bid, however low the last trade", () => {
    expect(suggestedListingPrice("Silicates", { npcBuyOrders: [silicatesBid], priceHistory: { Silicates: [bucket(0, 1)] } }, NOW)).toBe(24);
  });

  it("ignores trades older than the window", () => {
    const old = { npcBuyOrders: [silicatesBid], priceHistory: { Silicates: [bucket(SUGGESTION_WINDOW_DAYS + 1, 90)] } };
    expect(suggestedListingPrice("Silicates", old, NOW)).toBe(24);
  });

  it("uses the best of several bids on the same item", () => {
    const bids = [silicatesBid, { ...silicatesBid, id: "b2", unitPrice: 26 }];
    expect(suggestedListingPrice("Silicates", { npcBuyOrders: bids, priceHistory: {} }, NOW)).toBe(26);
  });

  it("an item with no trades and no bid gets the fallback, never a listing's price", () => {
    const market = { orderBook: [{ type: "sell", item: "Aerogel", quantity: 1, unitPrice: 999_999 }], npcBuyOrders: [silicatesBid], priceHistory: {} };
    expect(suggestedListingPrice("Aerogel", market, NOW)).toBe(FALLBACK_PRICE);
  });

  it("copes with a missing or malformed market", () => {
    expect(suggestedListingPrice("Silicates", undefined, NOW)).toBe(FALLBACK_PRICE);
    expect(suggestedListingPrice("Silicates", { priceHistory: { Silicates: "nonsense" }, npcBuyOrders: "no" }, NOW)).toBe(FALLBACK_PRICE);
    expect(suggestedListingPrice("Silicates", { priceHistory: { Silicates: [{ day: day(0), close: -5 }] }, npcBuyOrders: [silicatesBid] }, NOW)).toBe(24);
  });
});
