// What a client receives of the exchange (Bug #425).
//
// The order book on the server is never cut: cutting it used to delete the oldest listings, goods and all. What goes
// to a client is capped when it is read instead: the newest orders, plus every order of the caller's own, so a
// seller always sees their listings however busy the book is. Each order goes without its sellerAccountId, marked
// `mine` for its seller instead (Bug #1145), and without the stationId its goods were listed from (Bug #1171).

import { buyOrderView, orderView } from "./publicViews.js";
import { PRICE_HISTORY_ITEMS } from "./priceHistory.js";
import { NPC_CATALOG } from "./npcCorporations.js";
import { STATIONS_RAW } from "./game/catalog.js";

// ISP-124 (AB#818): who the NPCs are, for the badge and the profile card; the same for every viewer. The home station
// goes by name: the view carries no station id (Bug #1171), and this one is public anyway.
const stationNameOf = (id) => (STATIONS_RAW.stations || STATIONS_RAW).find((s) => s.id === id)?.name || "";
const NPC_DIRECTORY = NPC_CATALOG
  ? {
      corporations: NPC_CATALOG.corporations.map(({ id, name, homeStationId, flavour, trades }) => ({ id, name, homeStation: stationNameOf(homeStationId), flavour, trades })),
      authorities: NPC_CATALOG.authorities.map(({ name, role }) => ({ name, role }))
    }
  : { corporations: [], authorities: [] };

export const ORDER_BOOK_VIEW_LIMIT = 200;

/** The market as `accountId` should see it (null for someone not signed in). The book is newest first. */
export function marketView(market, accountId = null) {
  if (!market || typeof market !== "object") return market;
  // AB#815: NPC asks are shown apart and in full; the cap counts player listings only, so an NPC order can never push
  // a player's listing out of what a client sees (AB#425).
  const all = Array.isArray(market.orderBook) ? market.orderBook : [];
  const npcAsks = all.filter((o) => o?.npc === true);
  const book = all.filter((o) => o?.npc !== true);
  const newest = book.slice(0, ORDER_BOOK_VIEW_LIMIT);
  const own = accountId ? book.slice(ORDER_BOOK_VIEW_LIMIT).filter((o) => o?.sellerAccountId === accountId) : [];
  // AB#1054: players' buy orders, capped and viewed the same way.
  const bids = Array.isArray(market.buyOrders) ? market.buyOrders : [];
  const ownBids = accountId ? bids.slice(ORDER_BOOK_VIEW_LIMIT).filter((o) => o?.buyerAccountId === accountId) : [];
  // ISP-177 (AB#871): the mercenary offers carry corporation ids and a renter; clients get them from GET /mercenaries
  const { mercenaryOffers: _mercenaryOffers, ...rest } = market;
  return {
    ...rest,
    orderBook: newest.concat(own, npcAsks).map((order) => orderView(order, accountId)),
    buyOrders: bids.slice(0, ORDER_BOOK_VIEW_LIMIT).concat(ownBids).map((order) => buyOrderView(order, accountId)),
    tradeItems: [...PRICE_HISTORY_ITEMS].sort(), // what a buy order may name
    npcDirectory: NPC_DIRECTORY
  };
}
