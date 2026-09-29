// Settling a trade against a sell listing: the seller's side, the book and the price history. Taken out of the buy
// route (server/routes/market.js) for AB#1054, so a listing bought from the book and one filled against a standing buy
// order pay the seller, tax the sale and tell the seller the same way.

import { addAccountNotification, mutateAccountState, mutateState } from "./gameState.js";
import { taxOnSale } from "../public/scripts/exchangeTax.js";
import { applyCredits } from "./finances.js";
import { publicName } from "./publicViews.js";
import { recordTrade } from "./priceHistory.js";
import { emitToAccount } from "./realtime.js";
import { formatCredits } from "./receipts.js";
import { recordSale, sameConglomerate } from "./game/dominanceCounters.js"; // ISP-217 (AB#912)
import { accountsStore } from "./game/store.js";
import { chargeTariff } from "./tariffService.js"; // ISP-230 (AB#925)
import { recordOwnSale, withholdCouncilDebt, withholdDuty } from "./itcService.js"; // ISP-232 (AB#927); ISP-242 (AB#938)
import { withholdRoyaltyDebt } from "./patents.js"; // ISP-236 (AB#931)
import { onSale } from "./standingService.js"; // ISP-238 (AB#933)
import { payStationTax, saleTaxBreakdownAt } from "./game/stationTax.js"; // ISP-212b (AB#4655)
import { stationById } from "./game/stations.js";
import { payConcessionShare } from "./concessions.js"; // ISP-228 (AB#923)

/**
 * Pay the seller of `order` for `quantity` at the listing's price, less the exchange tax, and write their Sold row.
 * Returns what the seller is told (Bug #1167), or null for a listing with no seller account.
 */
export function paySeller(order, quantity, buyerName, buyerAccountId = null) {
  if (!order.sellerAccountId) return null;
  const total = quantity * Number(order.unitPrice || 0);
  let sale = null;
  let royaltyPaid = 0, sellerCorp = null; // ISP-228 (AB#923): the concession holder's share, paid once the seller is saved
  let saleBreakdown = null; // ISP-212b (AB#4655): at a conglomerate's station, its tax goes to the treasury once the seller is saved
  mutateAccountState(order.sellerAccountId, (state) => {
    // ISP-302 (AB#2285): the rate includes the lease royalty; its share is booked apart, as "lease-royalty".
    // ISP-239 (AB#934): the system's tax in force; ISP-212b (AB#4655): or, at a conglomerate's station, the station's
    const breakdown = saleTaxBreakdownAt(state, order.stationId);
    saleBreakdown = breakdown;
    const taxPct = breakdown.ratePct;
    const { tax: taxAmount, royalty, salesTax, proceeds: afterTax } = taxOnSale(total, breakdown);
    // Bug #984: the gross the buyer paid is income and the tax an expense; the balance moves by the proceeds.
    applyCredits(state.corp, total, "exchange");
    // ISP-217 (AB#912): the sale counts toward dominance at the listing's station, unless the buyer is a conglomerate
    // partner: selling to partners must not buy dominance.
    const partner = sameConglomerate(state.corp, accountsStore.accounts?.[buyerAccountId]?.state?.corp);
    if (!partner) recordSale(state.corp, order.stationId, total);
    // ISP-232 (AB#927): a sale at the seller's own price is what the ITC's dumping watch reads (a partner's is not)
    recordOwnSale(state.corp, { item: order.item, quantity, unitPrice: Number(order.unitPrice || 0), partner, stationId: order.stationId });
    applyCredits(state.corp, -salesTax, breakdown.station ? "station-tax" : "exchange-tax");
    // ISP-238 (AB#933): Earth Assembly standing for the tax, ITC standing for a sale at or above normal value. A station's
    // tax goes to its conglomerate, not the ISA, so it earns no Earth Assembly standing (ISP-212b, AB#4655).
    onSale(state.corp, { item: order.item, quantity, unitPrice: Number(order.unitPrice || 0), salesTax: breakdown.station ? 0 : salesTax, partner });
    applyCredits(state.corp, -royalty, "lease-royalty");
    // ISP-230 (AB#925): the concession holder's tariff where the goods are held, at the lower of the listing's posted
    // rate and today's (WARFARE.md: nobody pays a rate they were not shown)
    const tariff = chargeTariff(state.corp, { stationId: order.stationId, base: total, postedPct: order.tariffPct ?? null });
    // ISP-232 (AB#927): duty owed to the ITC takes its share of what is left
    const withheld = withholdDuty(state.corp, afterTax - tariff.amount);
    const councilWithheld = withholdCouncilDebt(state.corp, afterTax - tariff.amount, withheld); // ISP-242 (AB#938): the same 50%
    // ISP-236 (AB#931): then royalty owed on others' patents takes its share of what is left after the duty
    const royaltyWithheld = withholdRoyaltyDebt(state.corp, afterTax - tariff.amount - withheld - councilWithheld);
    const proceeds = afterTax - tariff.amount - withheld - councilWithheld - royaltyWithheld;
    sale = { taxPct, taxAmount, ...(breakdown.station ? { stationTax: { conglomerateName: breakdown.station.conglomerateName, member: breakdown.station.member } } : {}), tariffPct: tariff.pct, tariffAmount: tariff.amount, dutyWithheld: withheld, ...(councilWithheld ? { councilWithheld } : {}), ...(royaltyWithheld ? { royaltyWithheld } : {}), proceeds, buyer: publicName(buyerName) };
    royaltyPaid = royalty;
    sellerCorp = state.corp;
    if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
    state.corp.tradeHistory.unshift({
      id: `th-${Date.now() + 1}`,
      type: "sold",
      item: order.item,
      quantity,
      unitPrice: Number(order.unitPrice || 0),
      total,
      taxPct,
      taxAmount,
      ...(tariff.amount ? { tariffPct: tariff.pct, tariffAmount: tariff.amount, tariffRecord: tariff } : {}), // ISP-241 (AB#937): what a tariff-overcharge case reads
      ...(withheld ? { dutyWithheld: withheld } : {}),
      ...(councilWithheld ? { councilWithheld } : {}), // ISP-242 (AB#938)
      ...(royaltyWithheld ? { royaltyWithheld } : {}),
      proceeds,
      counterparty: sale.buyer,
      at: Date.now()
    });
    state.corp.tradeHistory = state.corp.tradeHistory.slice(0, 200);
  });
  // ISP-228 (AB#923): the concession holder's share of the lease royalty on a sale settled at its system's station
  if (royaltyPaid > 0) payConcessionShare(stationById(order.stationId)?.systemId, royaltyPaid, sellerCorp, Date.now(), "royalty");
  if (sale) payStationTax(saleBreakdown, sale.taxAmount, sellerCorp); // ISP-212b (AB#4655)
  return sale;
}

/** The day's price history takes the trade (AB#715), and the listing loses `quantity`, leaving the book at zero. */
export function takeFromListing(orderId, item, unitPrice, quantity) {
  mutateState((draft) => {
    if (!draft.market.priceHistory) draft.market.priceHistory = {};
    recordTrade(draft.market.priceHistory, item, Number(unitPrice || 0), quantity);
    const target = (draft.market.orderBook || []).find((entry) => entry.id === orderId && entry.type === "sell");
    if (!target) return;
    target.quantity = Math.max(0, Number(target.quantity || 0) - quantity);
    // AB#815: an NPC ask sold out stays in the book at zero until the daily refill; a player's listing goes.
    if (target.quantity <= 0 && target.npc !== true) draft.market.orderBook = draft.market.orderBook.filter((entry) => entry.id !== target.id);
  });
}

/**
 * Bug #1167: the seller is told, in a notification that waits if they are signed out, and "market:sold" to their own
 * sockets only (Bug #1021) so an open page reloads its credits and Trade History.
 */
export function tellSeller(order, quantity, sale, leftAfterSale) {
  if (!sale) return;
  const total = quantity * Number(order.unitPrice || 0);
  const notification = addAccountNotification(order.sellerAccountId, {
    type: "market",
    title: "Listing Sold",
    protocol: { meaning: leftAfterSale > 0 ? "queued" : "complete", screen: "market" }, // ISP-255 (AB#951): the rest stays Lodged
    body:
      `${sale.buyer} bought ${quantity.toLocaleString("en-US")} ${order.item} at ${formatCredits(order.unitPrice)} each: ` +
      `${formatCredits(total)}, less ${formatCredits(sale.taxAmount)} ${sale.stationTax ? `${sale.stationTax.member ? "member" : "station"} tax to ${sale.stationTax.conglomerateName}` : "exchange tax"} (${sale.taxPct}%)` +
      (sale.tariffAmount ? ` and ${formatCredits(sale.tariffAmount)} concession tariff (${sale.tariffPct}%)` : "") +
      (sale.dutyWithheld ? `, with ${formatCredits(sale.dutyWithheld)} withheld toward ITC duty owed` : "") +
      (sale.councilWithheld ? `, ${formatCredits(sale.councilWithheld)} withheld toward an Arbitration Council award` : "") + ", " +
      `${formatCredits(sale.proceeds)} paid to you. ` +
      (leftAfterSale > 0 ? `${leftAfterSale.toLocaleString("en-US")} still listed.` : "The listing is sold out.")
  });
  if (notification) emitToAccount(order.sellerAccountId, "notifications:new", { accountId: order.sellerAccountId, notification });
  emitToAccount(order.sellerAccountId, "market:sold", { accountId: order.sellerAccountId });
}
