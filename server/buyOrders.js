// Player buy orders on the Galactic Exchange (ISP, AB#1054). A corporation posts a price and a quantity for an item;
// the credits for all of it are held at once, the order fills against sell listings at or under its price, oldest
// first, and what is left waits. A listing posted later at or under a waiting order's price fills it too. Either way
// a fill is at the listing's price: the seller asked that much, and the difference goes back to the buyer.
//
// Buy orders are kept in market.buyOrders, apart from the sell book, so nothing that reads market.orderBook as the
// listings (the listing cap, the client's Sell Orders, the dummy reset) has to learn a second kind of entry.
//
// Held credits are booked as "exchange-escrow" going out and "exchange-escrow-return" coming back (finances.js); the
// purchase itself is booked as "exchange-purchases" when it fills, so the ledger's purchases are what was bought.
//
// Every step here is synchronous and the server is one process, so two buyers racing for one listing are served one
// after the other: the second finds what the first left.

import { randomUUID } from "node:crypto";
import { addAccountNotification, getAccountById, getState, mutateAccountState, mutateState, getStationInventory } from "./gameState.js";
import { applyCredits } from "./finances.js";
import { publicName } from "./publicViews.js";
import { PRICE_HISTORY_ITEMS } from "./priceHistory.js";
import { paySeller, takeFromListing, tellSeller } from "./marketSettlement.js";
import { emitToAccount } from "./realtime.js";
import { formatCredits } from "./receipts.js";

/** How many buy orders one corporation may have waiting at once: the same line as listings (Bug #425). */
export const MAX_OPEN_BUY_ORDERS = 50;

const book = () => getState().market.buyOrders || [];
/** Trade History keeps the newest 200. Rows are written out in full below, so the Trade History label test's scan of
 *  the server's unshift calls finds each row type. */
const historyOf = (corp) => {
  if (!Array.isArray(corp.tradeHistory)) corp.tradeHistory = [];
  return corp.tradeHistory;
};
const trimHistory = (corp) => { corp.tradeHistory = corp.tradeHistory.slice(0, 200); };

/**
 * Fill `quantity` of the buy order `bid` from the sell listing `listing`, at the listing's price. The buyer's held
 * credits for that quantity come back and the purchase is paid from them; the goods go to the station the order was
 * placed from; the seller is paid as any sale pays them. `actorId` is whoever's request caused it: the other side is
 * the one told.
 */
function fill(listing, bid, quantity, actorId) {
  const unitPrice = Number(listing.unitPrice || 0);
  const total = quantity * unitPrice;
  const sellerName = listing.seller;
  const buyer = getAccountById(bid.buyerAccountId);
  const buyerName = buyer?.state?.corp?.corporationName || bid.buyer;

  mutateAccountState(bid.buyerAccountId, (state) => {
    applyCredits(state.corp, quantity * Number(bid.unitPrice || 0), "exchange-escrow-return");
    applyCredits(state.corp, -total, "exchange-purchases");
    const inventory = getStationInventory(state.corp, bid.stationId || "earth-station-prime");
    inventory[listing.item] = Number(inventory[listing.item] || 0) + quantity;
    historyOf(state.corp);
    state.corp.tradeHistory.unshift({ id: `th-${randomUUID()}`, type: "bought", item: listing.item, quantity, unitPrice, total, counterparty: publicName(sellerName), at: Date.now() });
    trimHistory(state.corp);
  });

  const leftOnListing = Math.max(0, Number(listing.quantity || 0) - quantity);
  const sale = paySeller(listing, quantity, buyerName, bid.buyerAccountId); // ISP-217 (AB#912): the buyer, for dominance
  takeFromListing(listing.id, listing.item, unitPrice, quantity);
  let leftOnBid = 0;
  mutateState((draft) => {
    const target = (draft.market.buyOrders || []).find((o) => o.id === bid.id);
    if (!target) return;
    target.quantity = Math.max(0, Number(target.quantity || 0) - quantity);
    leftOnBid = target.quantity;
    if (target.quantity <= 0) draft.market.buyOrders = draft.market.buyOrders.filter((o) => o.id !== bid.id);
  });

  if (actorId !== listing.sellerAccountId) tellSeller(listing, quantity, sale, leftOnListing);
  if (actorId !== bid.buyerAccountId) {
    const notification = addAccountNotification(bid.buyerAccountId, {
      type: "market",
      title: "Buy Order Filled",
      protocol: { meaning: leftOnBid > 0 ? "queued" : "complete", screen: "market" }, // ISP-255 (AB#951): the rest stays Lodged
      body:
        `${publicName(sellerName)} sold you ${quantity.toLocaleString("en-US")} ${listing.item} at ${formatCredits(unitPrice)} each ` +
        `against your order at ${formatCredits(bid.unitPrice)}: ${formatCredits(total)}. ` +
        (leftOnBid > 0 ? `${leftOnBid.toLocaleString("en-US")} still wanted.` : "The order is filled.")
    });
    if (notification) emitToAccount(bid.buyerAccountId, "notifications:new", { accountId: bid.buyerAccountId, notification });
    emitToAccount(bid.buyerAccountId, "market:sold", { accountId: bid.buyerAccountId }); // the page reloads its account
  }
  return { listingId: listing.id, buyOrderId: bid.id, item: listing.item, quantity, unitPrice, total };
}

/** Fill the buy order `bidId` from the listings at or under its price, oldest first; returns the fills. */
function matchBuyOrder(bidId, actorId) {
  const fills = [];
  for (;;) {
    const bid = book().find((o) => o.id === bidId);
    if (!bid || Number(bid.quantity) <= 0) break;
    // A listing with no seller account (from before Bug #1145 recorded one) is never matched: there is no one to pay.
    const listing = (getState().market.orderBook || [])
      .filter((o) => o.type === "sell" && o.item === bid.item && o.sellerAccountId && o.sellerAccountId !== bid.buyerAccountId)
      .filter((o) => Number(o.quantity) > 0 && Number(o.unitPrice) <= Number(bid.unitPrice))
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0];
    if (!listing) break;
    fills.push(fill(listing, bid, Math.min(Number(bid.quantity), Number(listing.quantity)), actorId));
  }
  return fills;
}

/** Fill the new listing `listingId` into the waiting buy orders at or over its price, oldest first. */
export function matchListing(listingId, actorId) {
  const fills = [];
  for (;;) {
    const listing = (getState().market.orderBook || []).find((o) => o.id === listingId && o.type === "sell");
    if (!listing || Number(listing.quantity) <= 0 || !listing.sellerAccountId) break;
    const bid = book()
      .filter((o) => o.item === listing.item && o.buyerAccountId !== listing.sellerAccountId)
      .filter((o) => Number(o.quantity) > 0 && Number(o.unitPrice) >= Number(listing.unitPrice))
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0];
    if (!bid) break;
    fills.push(fill(listing, bid, Math.min(Number(bid.quantity), Number(listing.quantity)), actorId));
  }
  return fills;
}

/**
 * Post a buy order for `accountId`. Returns { error } with nothing changed, or { order, fills } once the credits are
 * held and the order has filled what it can.
 */
export function placeBuyOrder(accountId, { item, quantity, unitPrice }) {
  if (!PRICE_HISTORY_ITEMS.has(item)) return { error: "That item is not traded on the exchange." };
  const held = quantity * unitPrice;
  let error = "";
  let code = null;
  let order = null;
  const account = mutateAccountState(accountId, (state) => {
    const corp = state.corp;
    if (book().filter((o) => o.buyerAccountId === accountId).length >= MAX_OPEN_BUY_ORDERS) {
      error = `You have ${MAX_OPEN_BUY_ORDERS} open buy orders; cancel one to place another.`;
      return;
    }
    if (Number(corp.finances?.credits || 0) < held) {
      error = `This order holds ${formatCredits(held)}; you have ${formatCredits(corp.finances?.credits || 0)}. Sell goods or finish an assignment to raise the credits, or buy fewer.`; // Bug #4827
      code = "insufficient-credits";
      return;
    }
    order = {
      id: `bid-${randomUUID()}`,
      item,
      quantity,
      unitPrice,
      buyer: corp.corporationName || "Anonymous",
      buyerAccountId: accountId,
      stationId: corp.currentStationId || "earth-station-prime", // where what it buys is delivered
      createdAt: Date.now()
    };
    applyCredits(corp, -held, "exchange-escrow");
    mutateState((draft) => {
      if (!Array.isArray(draft.market.buyOrders)) draft.market.buyOrders = [];
      draft.market.buyOrders.unshift(order);
    });
    historyOf(corp);
    corp.tradeHistory.unshift({ id: `th-${randomUUID()}`, type: "bid", item, quantity, unitPrice, total: held, counterparty: "Market", at: Date.now() });
    trimHistory(corp);
  });
  if (!account) return { error: "Account not found." };
  if (error || !order) return { error: error || "Unable to place the buy order.", ...(code ? { code } : {}) };
  return { order, fills: matchBuyOrder(order.id, accountId) };
}

/** Take down `accountId`'s buy order `orderId`, returning the credits still held. Null when it is not theirs. */
export function cancelBuyOrder(accountId, orderId) {
  const order = book().find((o) => o.id === orderId && o.buyerAccountId === accountId);
  if (!order) return null;
  const refund = Number(order.quantity || 0) * Number(order.unitPrice || 0);
  const account = mutateAccountState(accountId, (state) => {
    mutateState((draft) => {
      draft.market.buyOrders = (draft.market.buyOrders || []).filter((o) => o.id !== order.id);
    });
    applyCredits(state.corp, refund, "exchange-escrow-return");
    historyOf(state.corp);
    state.corp.tradeHistory.unshift({ id: `th-${randomUUID()}`, type: "cancelled", item: order.item, quantity: order.quantity, unitPrice: order.unitPrice, total: refund, counterparty: "Market", at: Date.now() });
    trimHistory(state.corp);
  });
  return account ? { order, refund, account } : null;
}
