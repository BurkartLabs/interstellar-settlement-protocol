// What a client receives of the exchange (Bug #425).
//
// The order book on the server is never cut: cutting it used to delete the oldest listings, goods and all. What goes
// to a client is capped when it is read instead: the newest orders, plus every order of the caller's own, so a
// seller always sees their listings however busy the book is. Each order goes without its sellerAccountId, marked
// `mine` for its seller instead (Bug #1145), and without the stationId its goods were listed from (Bug #1171).

import { buyOrderView, orderView } from "./publicViews.js";
import { PRICE_HISTORY_ITEMS } from "./priceHistory.js";

export const ORDER_BOOK_VIEW_LIMIT = 200;

/** The market as `accountId` should see it (null for someone not signed in). The book is newest first. */
export function marketView(market, accountId = null) {
  if (!market || typeof market !== "object") return market;
  const book = Array.isArray(market.orderBook) ? market.orderBook : [];
  const newest = book.slice(0, ORDER_BOOK_VIEW_LIMIT);
  const own = accountId ? book.slice(ORDER_BOOK_VIEW_LIMIT).filter((o) => o?.sellerAccountId === accountId) : [];
  // AB#1054: players' buy orders, capped and viewed the same way.
  const bids = Array.isArray(market.buyOrders) ? market.buyOrders : [];
  const ownBids = accountId ? bids.slice(ORDER_BOOK_VIEW_LIMIT).filter((o) => o?.buyerAccountId === accountId) : [];
  return {
    ...market,
    orderBook: newest.concat(own).map((order) => orderView(order, accountId)),
    buyOrders: bids.slice(0, ORDER_BOOK_VIEW_LIMIT).concat(ownBids).map((order) => buyOrderView(order, accountId)),
    tradeItems: [...PRICE_HISTORY_ITEMS].sort() // what a buy order may name
  };
}
