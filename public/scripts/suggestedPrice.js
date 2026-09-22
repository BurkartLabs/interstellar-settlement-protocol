// The price Create Listing suggests (AB#1166).
//
// It used to be a mean over every open listing on the public book, the standing bids and the viewer's own listed and
// cancelled rows. A listing costs nothing to post, so one player listing 1 unit at $1,000,000,000 moved every other
// player's suggestion by a hundred million. The suggestion is now what the market has actually paid: the close of the
// most recent day with trades (the daily price history, AB#715, which records player trades and standing-order sales)
// within the window, and never below the best standing bid, the price a seller is guaranteed. A trade costs its
// buyer the price, so moving this takes real credits, not a free listing.

/** How far back a trade still counts as the market price. */
export const SUGGESTION_WINDOW_DAYS = 7;
/** What is suggested for an item nobody has traded and no standing order buys. */
export const FALLBACK_PRICE = 50;

const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/** The whole-credit price to pre-fill for `item`, from `market` ({ priceHistory, npcBuyOrders }) as of `now`. */
export function suggestedListingPrice(item, market, now = Date.now()) {
  const bids = Array.isArray(market?.npcBuyOrders) ? market.npcBuyOrders : [];
  const bestBid = bids.filter((o) => o?.item === item).reduce((best, o) => Math.max(best, positive(o.unitPrice)), 0);

  const buckets = Array.isArray(market?.priceHistory?.[item]) ? market.priceHistory[item] : [];
  const cutoff = new Date(now - SUGGESTION_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = buckets.filter((b) => typeof b?.day === "string" && b.day >= cutoff && positive(b.close));
  const lastClose = recent.length ? positive(recent.reduce((a, b) => (b.day > a.day ? b : a)).close) : 0;

  const price = Math.max(lastClose, bestBid);
  return price > 0 ? Math.max(1, Math.round(price)) : FALLBACK_PRICE;
}
