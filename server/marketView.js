// What a client receives of the exchange (Bug #425).
//
// The order book on the server is never cut: cutting it used to delete the oldest listings, goods and all. What goes
// to a client is capped when it is read instead: the newest orders, plus every order of the caller's own, so a
// seller always sees their listings however busy the book is.

export const ORDER_BOOK_VIEW_LIMIT = 200;

/** The market as `accountId` should see it (null for someone not signed in). The book is newest first. */
export function marketView(market, accountId = null) {
  if (!market || typeof market !== "object") return market;
  const book = Array.isArray(market.orderBook) ? market.orderBook : [];
  const newest = book.slice(0, ORDER_BOOK_VIEW_LIMIT);
  const own = accountId ? book.slice(ORDER_BOOK_VIEW_LIMIT).filter((o) => o?.sellerAccountId === accountId) : [];
  return { ...market, orderBook: newest.concat(own) };
}
