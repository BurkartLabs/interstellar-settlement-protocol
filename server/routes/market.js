// server/routes/market.js: the market routes, split out of server/index.js (AB#1815).
import { bodyNumber } from "../bodyNumber.js";
import { bodyCount } from "../bodyNumber.js";
import { randomUUID } from "node:crypto";
import { npcBidFor } from "../economy.js";
import { accountActionLimiter } from "../rateLimiters.js";
import { getAccountById, getState, mutateAccountState, mutateState, ensureBidShape, bidRuleFor } from "../gameState.js";
import { exchangeTaxBreakdown } from "../game/progression.js"; // ISP-302 (AB#2285): the rate and its royalty share
import { taxOnSale } from "../../public/scripts/exchangeTax.js";
import { getStationInventory } from "../gameState.js";
import { applyCredits } from "../finances.js";
// Bug #1325: each side of a sale is named to the other as the order book names a seller: the corporation name, or
// "Unregistered corporation", never an email address (the buyer's used to be the fallback in the seller's history).
import { publicName } from "../publicViews.js";
import { recordTrade, historyFor, PRICE_HISTORY_ITEMS, PRICE_HISTORY_DAYS } from "../priceHistory.js";
import { requireAuth } from "../auth.js";
import { checkAndResetNpcBuyOrders } from "../ticks.js";
import { emitMarketUpdated } from "../realtime.js";
import { buyOrderReceipt, buyReceipt, listingReceipt, sellToOrderReceipt } from "../receipts.js"; // AB#744
import { cancelBuyOrder, matchListing, placeBuyOrder } from "../buyOrders.js"; // AB#1054
import { paySeller, takeFromListing, tellSeller } from "../marketSettlement.js";
import { buyOrderView } from "../publicViews.js";
import { STATION_REGISTRY } from "../travel.js";

/** How many sell listings one seller may have open at once (Bug #425). */
const MAX_OPEN_LISTINGS = 50;

export function registerMarketRoutes(app) {
  app.post("/api/market/orders", requireAuth, accountActionLimiter, (req, res) => {
    const { type, item, quantity, unitPrice } = req.body ?? {};
    // AB#815: NPC orders are placed by the server's tick only; a request that names one is refused, whatever else it says.
    if (req.body && typeof req.body === "object" && "npc" in req.body) {
      res.status(400).json({ error: "NPC orders are placed by the exchange, not by corporations." });
      return;
    }

    const account = getAccountById(req.auth.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    // Bug #425: whole numbers of at least 1, or refused (they used to be clamped up to 1).
    const normalizedQty = bodyCount(quantity);
    const normalizedUnitPrice = bodyCount(unitPrice);
    if (!type || !item || normalizedQty === null || normalizedUnitPrice === null || (type !== "sell" && type !== "buy")) {
      res.status(400).json({ error: "Missing required order fields." });
      return;
    }

    // AB#1054: a buy order holds its credits, fills from listings at or under its price, and the rest waits.
    if (type === "buy") {
      const before = Number(account.state?.corp?.finances?.credits || 0);
      const placed = placeBuyOrder(req.auth.accountId, { item: String(item), quantity: normalizedQty, unitPrice: normalizedUnitPrice });
      if (placed.error) {
        res.status(400).json({ error: placed.error });
        return;
      }
      const buyerNow = mutateAccountState(req.auth.accountId, () => {}); // the account after every fill
      const filled = placed.fills.reduce((sum, f) => sum + f.quantity, 0);
      const paid = placed.fills.reduce((sum, f) => sum + f.total, 0);
      emitMarketUpdated();
      const receipt = buyOrderReceipt({
        item: placed.order.item, quantity: normalizedQty, unitPrice: normalizedUnitPrice, filled, paid,
        held: (normalizedQty - filled) * normalizedUnitPrice,
        stationName: STATION_REGISTRY[placed.order.stationId]?.name || "your station"
      });
      const waiting = (getState().market.buyOrders || []).find((o) => o.id === placed.order.id);
      res.json({ ok: true, order: waiting ? buyOrderView(waiting, req.auth.accountId) : null, fills: placed.fills, spent: before - Number(buyerNow?.state?.corp?.finances?.credits || 0), account: buyerNow, receipt });
      return;
    }

    let rejectReason = "";
    let order = null;
    const updatedSeller = mutateAccountState(req.auth.accountId, (state) => {
      const stationId = state.corp.currentStationId || "earth-station-prime";
      const inventory = getStationInventory(state.corp, stationId);
      const available = Number(inventory[item] || 0);
      if (available < normalizedQty) {
        rejectReason = "Quantity exceeds available inventory at this station.";
        return;
      }
      // Bug #425: a limit per seller, checked before any goods move, instead of cutting the shared book (which deleted
      // the oldest listings, goods and all).
      const openListings = (getState().market.orderBook || []).filter((o) => o.sellerAccountId === req.auth.accountId).length;
      if (openListings >= MAX_OPEN_LISTINGS) {
        rejectReason = `You have ${MAX_OPEN_LISTINGS} open listings; cancel one to list more.`;
        return;
      }

      // The order goes into the book first and the goods come out after, in the same step: if the insert throws, the
      // goods have not moved. stationId records where they came from, so a cancel returns them there.
      order = {
        id: `ord-${randomUUID()}`,
        type,
        item,
        quantity: normalizedQty,
        unitPrice: normalizedUnitPrice,
        seller: state.corp.corporationName || "Anonymous",
        sellerAccountId: req.auth.accountId,
        stationId,
        createdAt: Date.now()
      };
      mutateState((draft) => {
        if (!Array.isArray(draft.market.orderBook)) draft.market.orderBook = [];
        draft.market.orderBook.unshift(order);
      });
      inventory[item] = available - normalizedQty;
      if (inventory[item] <= 0) {
        delete inventory[item];
      }

      if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
      state.corp.tradeHistory.unshift({
        id: `th-${Date.now()}`,
        type: "listed",
        item,
        quantity: normalizedQty,
        unitPrice: normalizedUnitPrice,
        total: normalizedQty * normalizedUnitPrice,
        counterparty: "Market",
        at: Date.now()
      });
      state.corp.tradeHistory = state.corp.tradeHistory.slice(0, 200);
    });

    if (!updatedSeller || rejectReason || !order) {
      res.status(400).json({ error: rejectReason || "Unable to create sell order." });
      return;
    }

    // AB#1054: a listing at or under a waiting buy order's price sells to it at once, at the listing's price.
    const fills = matchListing(order.id, req.auth.accountId);
    const sellerNow = fills.length ? mutateAccountState(req.auth.accountId, () => {}) : updatedSeller;
    emitMarketUpdated();
    // AB#744: the listing as posted, and where its goods are held.
    const receipt = listingReceipt({
      item: order.item,
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      stationName: STATION_REGISTRY[order.stationId]?.name || "your station",
      soldAtOnce: fills.reduce((sum, f) => sum + f.quantity, 0)
    });
    res.json({ ok: true, order, fills, account: sellerNow, receipt });
  });

  // Bug #425: a seller can take a listing down, getting the unsold goods back at the station they were listed from.
  // Only the seller: anyone else gets 404, so the route says nothing about orders that are not theirs.
  app.post("/api/market/orders/:orderId/cancel", requireAuth, accountActionLimiter, (req, res) => {
    const orderId = String(req.params.orderId || "").trim();
    const order = (getState().market.orderBook || []).find((o) => o.id === orderId && o.sellerAccountId === req.auth.accountId);
    if (!order) {
      // AB#1054: the same route takes down a buy order, returning the credits it still holds.
      const cancelled = cancelBuyOrder(req.auth.accountId, orderId);
      if (!cancelled) {
        res.status(404).json({ error: "You have no listing or buy order with that id." });
        return;
      }
      emitMarketUpdated();
      res.json({ ok: true, cancelled: cancelled.order.id, refunded: cancelled.refund, account: cancelled.account });
      return;
    }

    const account = mutateAccountState(req.auth.accountId, (state) => {
      mutateState((draft) => {
        draft.market.orderBook = (draft.market.orderBook || []).filter((o) => o.id !== order.id);
      });
      const stationId = order.stationId || state.corp.currentStationId || "earth-station-prime";
      const inventory = getStationInventory(state.corp, stationId);
      inventory[order.item] = Number(inventory[order.item] || 0) + Number(order.quantity || 0);
      if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
      state.corp.tradeHistory.unshift({
        id: `th-${randomUUID()}`, type: "cancelled", item: order.item, quantity: order.quantity, unitPrice: order.unitPrice,
        total: order.quantity * order.unitPrice, counterparty: "Market", at: Date.now()
      });
      state.corp.tradeHistory = state.corp.tradeHistory.slice(0, 200);
    });
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    emitMarketUpdated();
    res.json({ ok: true, cancelled: order.id, account });
  });

  app.post("/api/market/orders/:orderId/buy", requireAuth, accountActionLimiter, (req, res) => {
    const orderId = String(req.params.orderId || "").trim();
    const requestedQty = bodyNumber(req.body?.quantity, { fallback: 1, min: 1, integer: true });
    const normalizeIdentity = (value) => String(value || "").trim().toLowerCase();

    const buyerAccount = getAccountById(req.auth.accountId);
    if (!buyerAccount) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    const market = getState().market;
    const order = (market.orderBook || []).find((entry) => entry.id === orderId && entry.type === "sell");
    if (!order) {
      res.status(404).json({ error: "Sell order not found." });
      return;
    }

    if (requestedQty > Number(order.quantity || 0)) {
      res.status(400).json({ error: "Requested quantity exceeds available sell order volume." });
      return;
    }

    const buyerCorpName = normalizeIdentity(buyerAccount.state?.corp?.corporationName);
    const buyerEmail = normalizeIdentity(buyerAccount.email);
    const sellerName = normalizeIdentity(order.seller);
    const isOwnOrderByAccount = Boolean(order.sellerAccountId) && order.sellerAccountId === req.auth.accountId;
    const isOwnOrderByIdentity = !order.sellerAccountId && Boolean(sellerName) && (sellerName === buyerCorpName || sellerName === buyerEmail);

    if (isOwnOrderByAccount || isOwnOrderByIdentity) {
      res.status(400).json({ error: "You cannot buy your own sell order." });
      return;
    }

    const tradeQuantity = requestedQty;
    const tradeTotal = tradeQuantity * Number(order.unitPrice || 0);
    const leftAfterSale = Math.max(0, Number(order.quantity || 0) - tradeQuantity); // read now: `order` is the stored listing
    let rejectReason = "";

    const buyer = mutateAccountState(req.auth.accountId, (state) => {
      const corp = state.corp;
      if (Number(corp.finances.credits || 0) < tradeTotal) {
        rejectReason = "Insufficient credits to execute this buy order.";
        return;
      }

      applyCredits(corp, -tradeTotal, "exchange-purchases");
      const buyerStationId = corp.currentStationId || "earth-station-prime";
      const buyerInv = getStationInventory(corp, buyerStationId);
      buyerInv[order.item] = (buyerInv[order.item] || 0) + tradeQuantity;

      if (!Array.isArray(corp.tradeHistory)) corp.tradeHistory = [];
      corp.tradeHistory.unshift({
        id: `th-${Date.now()}`,
        type: "bought",
        item: order.item,
        quantity: tradeQuantity,
        unitPrice: Number(order.unitPrice || 0),
        total: tradeTotal,
        counterparty: publicName(order.seller),
        at: Date.now()
      });
      corp.tradeHistory = corp.tradeHistory.slice(0, 200);
    });

    if (!buyer || rejectReason) {
      res.status(400).json({ error: rejectReason || "Unable to execute buy order." });
      return;
    }

    // AB#1054: the seller's side, the book and the price history, as a buy order's fill settles them.
    const sale = paySeller(order, tradeQuantity, buyerAccount.state?.corp?.corporationName);
    takeFromListing(orderId, order.item, order.unitPrice, tradeQuantity);
    tellSeller(order, tradeQuantity, sale, leftAfterSale);

    emitMarketUpdated();
    // AB#744: what was bought, and the station it was delivered to (the buyer's, as the mutation used).
    const receipt = buyReceipt({
      item: order.item,
      quantity: tradeQuantity,
      unitPrice: Number(order.unitPrice || 0),
      total: tradeTotal,
      stationName: STATION_REGISTRY[buyer.state.corp.currentStationId || "earth-station-prime"]?.name || "your station"
    });
    res.json({
      ok: true,
      traded: {
        orderId,
        item: order.item,
        quantity: tradeQuantity,
        unitPrice: Number(order.unitPrice || 0),
        total: tradeTotal
      },
      account: buyer,
      receipt
    });
  });
  // ─── Daily price history per item (AB#715) ───────────────────────────────────
  // Global and non-personal: open, high, low, close, volume and trade count per UTC day, the last 90 days. The item is
  // matched against the catalog, and an unknown one is refused without repeating it back. Behind a login like every
  // other route (Bug #423), although nothing in it is personal.

  app.get("/api/market/history/:item", requireAuth, (req, res) => {
    const item = String(req.params.item || "");
    if (!PRICE_HISTORY_ITEMS.has(item)) {
      res.status(400).json({ error: "Unknown item." });
      return;
    }
    res.json({ item, days: PRICE_HISTORY_DAYS, buckets: historyFor(getState().market?.priceHistory, item) });
  });

  // ─── Sell player resources into an NPC standing buy order ────────────────────
  app.post("/api/market/npc-orders/:orderId/sell", requireAuth, accountActionLimiter, (req, res) => {
    const orderId = String(req.params.orderId || "").trim();
    // Bug #425: a whole number of at least 1, or refused; it used to fall back to 1 for "abc", 0 or -5.
    const requestedQty = bodyCount(req.body?.quantity);
    if (requestedQty === null) {
      res.status(400).json({ error: "Quantity must be a whole number of at least 1." });
      return;
    }

    checkAndResetNpcBuyOrders();

    const npcOrder = (getState().market?.npcBuyOrders || []).find((o) => o.id === orderId);
    if (!npcOrder) {
      res.status(404).json({ error: "Standing buy order not found." });
      return;
    }

    // AB#2365: shaped before the quota checks, so an order saved with the world's 7,000 is checked against its own.
    ensureBidShape(npcOrder);
    if (npcOrder.remainingQty <= 0) {
      res.status(400).json({ error: "This order has been fully filled for today. It resets at midnight EST." });
      return;
    }

    if (requestedQty > npcOrder.remainingQty) {
      res.status(400).json({ error: `Only ${Number(npcOrder.remainingQty).toLocaleString()} units remaining in today's order.` });
      return;
    }

    // ISP-87: the bid is what today's volume has left it at, computed here and never taken from the request.
    // AB#2365: over the order's own quota, so a product's bid moves at a Refinery's rate, not the world's 7,000.
    const unitPrice = npcBidFor(npcOrder.basePrice, npcOrder.soldToday, bidRuleFor(npcOrder));
    const tradeTotal = requestedQty * unitPrice;
    let rejectReason = "";
    let tradeTaxPct = 0;
    let tradeTaxAmount = 0;
    let tradeProceeds = tradeTotal;

    const seller = mutateAccountState(req.auth.accountId, (state) => {
      const npcStationId = state.corp.currentStationId || "earth-station-prime";
      const inventory = getStationInventory(state.corp, npcStationId);
      const available = Number(inventory[npcOrder.item] || 0);
      if (available < requestedQty) {
        rejectReason = `Insufficient ${npcOrder.item} at this station (have ${available.toLocaleString()}, need ${requestedQty.toLocaleString()}).`;
        return;
      }

      inventory[npcOrder.item] = available - requestedQty;
      if (inventory[npcOrder.item] <= 0) delete inventory[npcOrder.item];

      // ISP-302 (AB#2285): the rate includes the lease royalty; its share is booked apart, as "lease-royalty".
      const breakdown = exchangeTaxBreakdown(state);
      const taxPct = breakdown.ratePct;
      const { tax: taxAmount, royalty, salesTax, proceeds: sellerProceeds } = taxOnSale(tradeTotal, breakdown);
      tradeTaxPct = taxPct;
      tradeTaxAmount = taxAmount;
      tradeProceeds = sellerProceeds;
      // Bug #984: the gross the NPC paid is income and the tax an expense; the balance moves by the proceeds.
      applyCredits(state.corp, tradeTotal, "exchange");
      applyCredits(state.corp, -salesTax, "exchange-tax");
      applyCredits(state.corp, -royalty, "lease-royalty");

      if (!state.corp.stats) state.corp.stats = {};
      state.corp.stats.silicateSoldOnExchange = (Number(state.corp.stats.silicateSoldOnExchange) || 0) + requestedQty;

      if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
      state.corp.tradeHistory.unshift({
        id: `th-${Date.now()}`,
        type: "sold-npc",
        item: npcOrder.item,
        quantity: requestedQty,
        unitPrice,
        total: tradeTotal,
        taxPct,
        taxAmount,
        proceeds: sellerProceeds,
        counterparty: npcOrder.buyer,
        at: Date.now()
      });
      state.corp.tradeHistory = state.corp.tradeHistory.slice(0, 200);
    });

    if (!seller || rejectReason) {
      res.status(400).json({ error: rejectReason || "Trade failed." });
      return;
    }

    mutateState((draft) => {
      const target = (draft.market.npcBuyOrders || []).find((o) => o.id === orderId);
      if (target) {
        ensureBidShape(target);
        target.remainingQty = Math.max(0, target.remainingQty - requestedQty);
        target.soldToday = Math.max(0, Number(target.soldToday) || 0) + requestedQty;
        target.unitPrice = npcBidFor(target.basePrice, target.soldToday, bidRuleFor(target));
      }
      if (!draft.market.priceHistory) draft.market.priceHistory = {};
      recordTrade(draft.market.priceHistory, npcOrder.item, unitPrice, requestedQty); // AB#715, at the price paid
    });

    emitMarketUpdated();
    const traded = { orderId, item: npcOrder.item, quantity: requestedQty, unitPrice, total: tradeTotal, taxPct: tradeTaxPct, taxAmount: tradeTaxAmount, proceeds: tradeProceeds };
    res.json({ ok: true, traded, account: seller, receipt: sellToOrderReceipt(traded) }); // AB#744
  });
}
