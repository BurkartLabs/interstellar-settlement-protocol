// The Galactic Exchange tab: listings, buying, selling and the filters.
// AB#739 (ISP-53): everything here moved from app.js unchanged.
// ISP-80 (AB#769): drawn from the design system (ui-table, ui-input, ui-button, ui-tab, ui-state, ui-badge), in the flat
// direction (Decision AB#1801). The row actions are secondary buttons: cyan is kept for one primary control a screen.
// Clicks find their buttons by the data attributes they carry, not by class.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { DEFAULT_EXCHANGE_VIEW, EXCHANGE_PAGES, MY_LISTINGS_SHOWN, ORDER_PAGES, SELL_ORDERS_SHOWN, cappedNote, filteredEmptyHtml, partnerNames, partnersEmptyHtml, saveExchangeView, sellerKey, standingBuyNote, standingBuyRows, standingBuyToggle, tradeNumbers, viewOrders } from "../exchangeView.js";
import { deepClone, formatTime, toCurrency } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { protocolLineHtml, refusalMeaning } from "../protocol.js"; // ISP-255 (AB#951)
import { appState, viewerStorage } from "../state.js";
import { taxOnSale, withBasePct } from "../exchangeTax.js"; // ISP-302 (AB#2285): the same split the server books
import { saleQuote, utcMinute } from "../tariffs.js"; // ISP-231 (AB#926): the tariff the server settles
import { councilWithholding, withheldFrom } from "../itcDuty.js"; // ISP-232 (AB#927): what the server withholds toward ITC duty owed; ISP-243 (AB#939): and Council debts
import { listingWarning } from "../dumping.js"; // ISP-233 (AB#928): the watch's own rule
import { withCents } from "../priceChart.js";
import { suggestedListingPrice } from "../suggestedPrice.js";
import { labelTableCells } from "../tableLabels.js";
import { saleDeductions, tradeTotalCell, tradeTypeBadge } from "../tradeHistory.js";
import { counterpartyHtml } from "../npcProfile.js"; // ISP-124 (AB#818)
import { showNpcProfile } from "./npcProfileModal.js";
import { renderMercenaries } from "./mercenaries.js"; // ISP-177 (AB#871)
import { flashButtonSuccess, getCurrentStationInfo, getInventory, pushFeedback, refreshFromServer, showTradeConfirmation, stationLocationBanner } from "./shared.js";

/** ISP-255 (AB#951): an outcome's protocol on the Galactic Exchange (public/scripts/protocol.js). */
const onExchange = (meaning) => ({ meaning, screen: "market" });
const refusedOnExchange = (error) => onExchange(refusalMeaning(error));
/** A status line's plain words, then the protocol line: markup, so the text is escaped here. */
const withProtocol = (text, protocol) => `${escapeHtml(text)}${protocol ? ` ${protocolLineHtml(protocol)}` : ""}`;

/**
 * The tax rate and its parts, as the server last stored them (ISP-302, AB#2285: finances.exchangeTaxBreakdown). A
 * response from before the breakdown existed has the rate alone, which is then all sales tax.
 */
export function getClientExchangeTaxBreakdown() {
  const finances = appState.data?.corp?.finances;
  const stored = finances?.exchangeTaxBreakdown;
  if (stored && Number.isFinite(stored.ratePct)) return stored;
  const ratePct = Number(finances?.exchangeSalesTaxPct ?? 8);
  return { ratePct, salesTaxPct: ratePct, royaltyPct: 0, royaltyPoints: 0, leasesHeld: (appState.data?.corp?.miningLeases || []).length };
}

export function getClientExchangeTaxPct() {
  return getClientExchangeTaxBreakdown().ratePct;
}

/**
 * A sale's tax lines, as the server will book them (taxOnSale): the sales tax, the royalty when there is one, the rest.
 * Labels stay short: the confirmation's label column does not wrap, and a longer one pushed the values off a phone.
 */
function saleTaxRows(gross) {
  // ISP-231 (AB#926): the concession tariff where the goods are held, quoted with the server's own arithmetic
  const here = clientTariffHere();
  // ISP-239 (AB#934): and the sales tax in force there, which a lobbying campaign may have moved
  const breakdown = withBasePct(getClientExchangeTaxBreakdown(), here?.salesTaxPct);
  const sale = saleQuote(gross, breakdown, here?.pct || 0);
  const withheld = withheldFrom(sale.proceeds, appState.data?.corp?.itcDuty);
  // ISP-243 (AB#939): an Arbitration Council debt takes what the same 50% leaves, as the server's withholdCouncilDebt does
  const debts = appState.data?.corp?.councilDebts || [];
  const council = councilWithholding(sale.proceeds, withheld, debts, debts[0]?.withholdPct).reduce((s, d) => s + d.credits, 0);
  return [
    { label: `GEX Sales Tax (${breakdown.salesTaxPct}%)`, value: `− ${toCurrency(sale.salesTax)}`, muted: true },
    ...(breakdown.royaltyPct > 0 ? [{ label: `ISA Lease Royalty (${breakdown.royaltyPct}%)`, value: `− ${toCurrency(sale.royalty)}`, muted: true }] : []),
    ...(sale.tariff > 0 ? [{ label: `Concession Tariff (${here.pct}%)`, value: `− ${toCurrency(sale.tariff)}`, muted: true }] : []),
    ...(here?.pending ? [{ label: "Tariff Pending", value: `${here.pending.pct}% from ${utcMinute(here.pending.effectiveAt)}`, muted: true }] : []),
    ...(withheld > 0 ? [{ label: "Withheld for ITC Duty", value: `− ${toCurrency(withheld)}`, muted: true }] : []),
    ...(council > 0 ? [{ label: "Withheld for GAC Award", value: `− ${toCurrency(council)}`, muted: true }] : []),
    { label: "You Receive", value: toCurrency(sale.proceeds - withheld - council), highlight: true }
  ];
}

/**
 * ISP-233 (AB#928): before a listing is posted, what the ITC's watch would make of it: nothing at or above the dumping
 * line; below it, the line and how far this listing takes the seller toward an investigation, from its own view of the
 * watch (GET /api/accounts/:id/itc/:item) and the watch's own rule. No warning when the view cannot be read: the
 * listing is not blocked either way.
 */
async function listingWarningRows(item, quantity, unitPrice) {
  let watch = null;
  try {
    watch = await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/itc/${encodeURIComponent(item)}`));
  } catch { return []; }
  const w = listingWarning(watch, quantity, unitPrice);
  if (!w) return [];
  const pct = watch.terms.priceThresholdPct;
  const units = (n) => Math.ceil(n).toLocaleString("en-US");
  const note = w.found
    ? `Below the ITC's dumping line. With ${units(w.already)} units already sold below it in this window, this listing takes you to ${units(w.Q)} against a volume line of ${units(w.volumeLine)}: if it all sells, the Interplanetary Trade Commission opens an investigation and levies about ${toCurrency(w.duty)}, the margin under normal value.`
    : `Below the ITC's dumping line: it counts toward an investigation. With it you would have ${units(w.Q)} units below the line in this window, against a volume line of ${units(w.volumeLine)} and a minimum of ${toCurrency(watch.terms.minValue)} at normal value. The Commission opens an investigation only when both are crossed.`;
  return [
    { label: "ITC Dumping Line", value: `${withCents(w.line, toCurrency)} (${pct}% of ${withCents(w.N, toCurrency)})`, warn: true },
    { note, warn: true }
  ];
}

/** ISP-231 (AB#926): the tariff summary's rate where the corporation is docked now, or null when it is for elsewhere. */
export function clientTariffHere() {
  const here = appState.tariffs?.here;
  return here && here.stationId === (appState.data?.corp?.currentStationId || null) ? here : null;
}

import { numberMarkup } from "../numberChange.js"; // AB#745: marks a number that is acknowledged when it changes
import { refHtml } from "../html.js"; // ISP-249 (AB#945)
import { timeHtml } from "../timeFormat.js";
export function renderMarket(data) {
  const station = getCurrentStationInfo(data);
  const bannerEl = document.getElementById("market-station-banner");
  if (bannerEl) bannerEl.innerHTML = stationLocationBanner(station);
  renderMercenaries(data);

  const buyTable = document.getElementById("exchange-buy-table");
  const buyEmpty = document.getElementById("exchange-buy-empty");
  const sellGrid = document.getElementById("market-sell-grid");
  const sellEmpty = document.getElementById("market-sell-empty");
  const mySellOrdersTable = document.getElementById("my-sell-orders-table");
  const mySellOrdersEmpty = document.getElementById("my-sell-orders-empty");
  const npcBuyTable = document.getElementById("npc-buy-table");
  const npcBuyEmpty = document.getElementById("npc-buy-empty");
  const myCorpName = String(data?.corp?.corporationName || "").trim().toLowerCase();
  const myEmail = String(appState.accountEmail || "").trim().toLowerCase();
  const isOwnSellOrder = (order) => {
    // Bug #1145: the server marks the caller's own listings; it no longer sends anyone's account id.
    if (typeof order?.mine === "boolean") {
      return order.mine;
    }
    const seller = String(order?.seller || "").trim().toLowerCase();
    if (!seller) {
      return false;
    }
    return Boolean((myCorpName && seller === myCorpName) || (myEmail && seller === myEmail));
  };

  const market = data.market || {};
  // AB#815: NPC asks are listed apart (Standing sell orders), never among the players' listings.
  const allSellOrders = (market.orderBook || []).filter((order) => order.type === "sell" && !order.npc && !isOwnSellOrder(order));
  const npcAsks = (market.orderBook || []).filter((order) => order.type === "sell" && order.npc);
  const allMySellOrders = (market.orderBook || []).filter((order) => order.type === "sell" && isOwnSellOrder(order));
  const npcBuyOrders = market.npcBuyOrders || [];
  const allBids = market.buyOrders || []; // AB#1054: players' buy orders, the viewer's own marked `mine`

  // ISP-208 (AB#903): the viewer's conglomerate partners, from the server's last read; the Sellers filter and the
  // Partner badge use them. Outside a conglomerate the filter is not offered and has no effect.
  const partners = partnerNames(appState.conglomerate, data?.corp?.publicId);
  const inConglomerate = Boolean(appState.conglomerate);
  const view = { ...appState.exchangeView, sellers: inConglomerate ? appState.exchangeView.sellers : "all" };
  const tierOf = market.itemTiers || null; // AB#884: the Tier filter's lookup

  // Build resource filter pills from all visible resources, keeping a remembered resource that has no orders today so
  // the viewer can see which filter is on
  const resourceSet = new Set();
  allSellOrders.forEach((o) => o.item && resourceSet.add(o.item));
  npcBuyOrders.forEach((o) => o.item && resourceSet.add(o.item));
  allMySellOrders.forEach((o) => o.item && resourceSet.add(o.item));
  allBids.forEach((o) => o.item && resourceSet.add(o.item));
  if (view.resource) resourceSet.add(view.resource);
  const resources = Array.from(resourceSet).filter((r) => !view.tier || !tierOf || String(tierOf[r]) === view.tier || r === view.resource).sort();

  const filterBar = document.getElementById("exchange-filter-bar");
  if (filterBar) {
    const cur = view.resource;
    const tab = (value, label) => `<button type="button" class="ui-tab" role="tab" aria-selected="${String(cur === value)}" data-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    filterBar.innerHTML = tab("", "All") + resources.map((r) => tab(r, r)).join("");
  }
  const sortSelect = document.getElementById("exchange-sort");
  if (sortSelect) sortSelect.value = view.sort;
  const tierSelect = document.getElementById("exchange-tier-filter");
  if (tierSelect) tierSelect.value = view.tier;
  const sellersField = document.getElementById("exchange-sellers-field");
  if (sellersField) sellersField.hidden = !inConglomerate;
  const sellersSelect = document.getElementById("exchange-sellers-filter");
  if (sellersSelect) sellersSelect.value = view.sellers;

  showExchangePage(view.page); // AB#2472: the subpage the viewer last chose

  // Filter by resource and sort, then cap: the cap applies to what the viewer asked to see (AB#402)
  const viewedSellOrders = viewOrders(allSellOrders, view, { partners, tierOf });
  const filteredSellOrders = viewedSellOrders.slice(0, SELL_ORDERS_SHOWN);
  const filteredNpcOrders = viewOrders(npcBuyOrders, view, { tierOf });
  // AB#4710: with All picked, the buyers for what the player holds here, the rest one press away
  const standing = standingBuyRows(filteredNpcOrders, { view, held: getInventory(), showAll: Boolean(appState.standingShowAll) });
  const viewedMySellOrders = viewOrders(allMySellOrders, view, { tierOf });
  const mySellOrders = viewedMySellOrders.slice(0, MY_LISTINGS_SHOWN);

  // AB#1169: say when the cap left some out, rather than letting 30 rows read as the whole book
  const showCapped = (id, shown, total, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = cappedNote(shown, total, label);
    el.hidden = !el.textContent;
  };
  showCapped("exchange-buy-capped", filteredSellOrders.length, viewedSellOrders.length, "player sell orders");
  showCapped("my-sell-orders-capped", mySellOrders.length, viewedMySellOrders.length, "of your listings");

  // "Nothing listed yet" and "your filter hid it" are different states, shown differently (AB#402)
  const showEmpty = (emptyEl, filteredId, total, shown, label) => {
    if (emptyEl) emptyEl.hidden = total > 0;
    const filteredEl = document.getElementById(filteredId);
    if (!filteredEl) return;
    // No rows: hide the table too, so its headers do not sit over an empty body
    const tableWrap = filteredEl.parentElement?.querySelector(".ui-table-wrap");
    if (tableWrap) tableWrap.hidden = shown === 0;
    filteredEl.hidden = !(total > 0 && shown === 0);
    filteredEl.innerHTML = filteredEl.hidden ? "" : filteredEmptyHtml(label, view.resource || `Tier ${view.tier} items`, total, view.resource ? "resource" : "tier");
  };

  // Sell Orders table (player can buy from these)
  if (buyTable) {
    buyTable.innerHTML = filteredSellOrders
      .map(
        (order) => `
          <tr>
            <td>${escapeHtml(order.item)}</td>
            <td class="ui-table__num">${Number(order.quantity).toLocaleString()}</td>
            <td class="ui-table__num">${toCurrency(order.unitPrice)}</td>
            <td>${escapeHtml(order.seller || "Anonymous")}${partners.has(sellerKey(order.seller)) ? ' <span class="ui-badge ui-badge--success">Partner</span>' : ""}</td>
            <td><input class="ui-input exchange__qty" type="number" min="1" max="${Number(order.quantity)}" value="1" aria-label="Quantity of ${escapeHtml(order.item)} to buy" data-buy-order-qty="${order.id}" /></td>
            <td><button class="ui-button ui-button--secondary" type="button" data-buy-order-id="${order.id}" data-buy-item="${escapeHtml(order.item)}" data-buy-price="${Number(order.unitPrice)}" data-buy-qty="${Number(order.quantity)}">Buy</button></td>
          </tr>
        `
      )
      .join("");
  }
  showEmpty(buyEmpty, "exchange-buy-filtered", allSellOrders.length, filteredSellOrders.length, "player sell orders");
  // ISP-208 (AB#903): when the Sellers filter is what hid them, say so, and how many.
  if (view.sellers === "conglomerate" && allSellOrders.length && !filteredSellOrders.length) {
    const filteredEl = document.getElementById("exchange-buy-filtered");
    if (filteredEl) filteredEl.innerHTML = partnersEmptyHtml(viewOrders(allSellOrders, { ...view, sellers: "all" }, { tierOf }).length, view.resource);
  }

  // AB#815: Standing sell orders, the NPC corporations' asks (player can buy from these), badged NPC. Same columns as Sell
  // orders, so the purchase handler reads the seller from the fourth cell of either.
  const npcSellTable = document.getElementById("npc-sell-table");
  const shownAsks = viewOrders(npcAsks, view, { tierOf });
  if (npcSellTable) {
    npcSellTable.innerHTML = shownAsks
      .map((order) => {
        const soldOut = Number(order.quantity) <= 0;
        return `
          <tr>
            <td>${escapeHtml(order.item)}</td>
            <td class="ui-table__num exchange__left-cell">${Number(order.quantity).toLocaleString()}</td>
            <td class="ui-table__num exchange__price-cell">${toCurrency(order.unitPrice)}</td>
            <td class="exchange__party">${counterpartyHtml(order.seller, market.npcDirectory)}</td>
            <td>${soldOut ? "-" : `<input class="ui-input exchange__qty" type="number" min="1" max="${Number(order.quantity)}" value="1" aria-label="Quantity of ${escapeHtml(order.item)} to buy" data-buy-order-qty="${escapeHtml(order.id)}" />`}</td>
            <td>${soldOut ? "Sold out until tomorrow" : `<button class="ui-button ui-button--secondary" type="button" data-buy-order-id="${escapeHtml(order.id)}" data-buy-item="${escapeHtml(order.item)}" data-buy-price="${Number(order.unitPrice)}" data-buy-qty="${Number(order.quantity)}">Buy</button>`}</td>
          </tr>`;
      })
      .join("");
  }
  showEmpty(document.getElementById("npc-sell-empty"), "npc-sell-filtered", npcAsks.length, shownAsks.length, "standing sell orders");

  // NPC Standing Buy Orders table (player can sell into these)
  if (npcBuyTable) {
    npcBuyTable.innerHTML = standing.rows
      .map((order) => {
        const exhausted = order.remainingQty <= 0;
        const total = Math.max(0, Number(order.totalQtyPerDay) || 0);
        const sold = Math.max(0, total - Math.max(0, Number(order.remainingQty) || 0));
        const boughtLabel = `${sold.toLocaleString()} of ${total.toLocaleString()} bought today`;
        return `
          <tr${exhausted ? ' class="ui-table__muted"' : ""}>
            <td>${escapeHtml(order.item)}</td>
            <td class="exchange__party">${counterpartyHtml(order.buyer, market.npcDirectory)}</td>
            <td class="ui-table__num exchange__price-cell">
              <span class="exchange__price">${toCurrency(order.unitPrice)}${
                // ISP-87: the bid falls as the day's volume is sold into it. Saying so where the price is shown is
                // the difference between a number that looks wrong and a market a player can read.
                Number(order.basePrice) > Number(order.unitPrice)
                  ? `<span class="exchange__drift">down from ${toCurrency(order.basePrice)} on today&#39;s volume</span>`
                  : ""
              }</span>
            </td>
            <td class="exchange__left-cell">
              <span class="exchange__remaining"><span class="ui-figure">${Number(order.remainingQty).toLocaleString()} / ${total.toLocaleString()}</span>
              <progress class="exchange__fill" max="${total || 1}" value="${sold}" aria-label="${boughtLabel}"></progress></span>
            </td>
            <td>
              <input class="ui-input exchange__qty" type="number" min="1" max="${Number(order.remainingQty)}" value="1" aria-label="Quantity of ${escapeHtml(order.item)} to sell" data-npc-sell-qty="${order.id}" ${exhausted ? "disabled" : ""} />
            </td>
            <td>
              <button class="ui-button ui-button--secondary" type="button" data-npc-order-id="${order.id}" data-npc-item="${escapeHtml(order.item)}" data-npc-price="${Number(order.unitPrice)}" ${exhausted ? "disabled" : ""}>Sell</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }
  showEmpty(npcBuyEmpty, "npc-buy-filtered", npcBuyOrders.length, filteredNpcOrders.length, "standing buy orders");
  // AB#4710: the note and the Show all control; no rows held here hides the empty table under the note
  const heldNote = document.getElementById("npc-buy-held-note");
  if (heldNote) {
    heldNote.textContent = standingBuyNote(standing, getCurrentStationInfo(data)?.name);
    heldNote.hidden = !heldNote.textContent;
  }
  const showAllButton = document.getElementById("npc-buy-show-all");
  if (showAllButton) {
    showAllButton.textContent = standingBuyToggle(standing);
    showAllButton.hidden = !showAllButton.textContent;
    showAllButton.setAttribute("aria-expanded", String(!standing.collapsed));
  }
  if (!standing.rows.length && filteredNpcOrders.length) {
    const wrap = npcBuyTable?.closest(".ui-table-wrap");
    if (wrap) wrap.hidden = true;
  }

  // Inventory snapshot
  const inventory = getInventory();
  const entries = Object.entries(inventory).filter(([, qty]) => Number(qty) > 0);
  const inventoryList = document.getElementById("inventory-list");
  inventoryList.innerHTML = entries.length
    ? entries.map(([name, qty]) => `<li class="exchange__stock"><span>${escapeHtml(name)}</span> ${numberMarkup(`exchange:inventory:${data.corp?.currentStationId}:${name}`, qty, Number(qty).toLocaleString())}</li>`).join("")
    : "<li>No inventory available yet. Begin mining and refining to generate tradable stock.</li>";

  // Create Listing grid — default unit price to AVG market price for the item.
  // AB#1166: what the market has actually paid, never a raw listing (public/scripts/suggestedPrice.js)
  if (sellGrid) {
    sellGrid.innerHTML = entries
      .map(
        ([name, qty]) => {
          const defaultPrice = suggestedListingPrice(name, data.market, Date.now());
          return `
          <tr>
            <td>${escapeHtml(name)}</td>
            <td class="ui-table__num">${Number(qty).toLocaleString()}</td>
            <td><input class="ui-input exchange__qty" type="number" min="1" max="${Number(qty)}" value="1" required aria-label="Quantity of ${escapeHtml(name)} to list" data-sell-qty="${escapeHtml(name)}" /></td>
            <td><input class="ui-input exchange__qty" type="number" min="1" value="${defaultPrice}" required aria-label="Unit price for ${escapeHtml(name)}" data-sell-price="${escapeHtml(name)}" /></td>
            <td><span class="exchange__action"><button class="ui-button ui-button--secondary" type="button" data-sell-item="${escapeHtml(name)}">Create Listing</button><span class="exchange__row-status" data-sell-status="${escapeHtml(name)}"></span></span></td>
          </tr>
        `;
        }
      )
      .join("");
  }
  if (sellEmpty) sellEmpty.hidden = entries.length > 0;
  // AB#1857: nothing to list, so no headers over an empty body either (as showEmpty does for the other tables)
  const sellTableWrap = sellGrid?.closest(".ui-table-wrap");
  if (sellTableWrap) sellTableWrap.hidden = entries.length === 0;

  // AB#1054: Buy Orders, the book's other side: the viewer's own can be cancelled, returning what they hold.
  const bidsTable = document.getElementById("exchange-bids-table");
  const shownBids = viewOrders(allBids, view, { tierOf }).slice(0, SELL_ORDERS_SHOWN);
  if (bidsTable) {
    bidsTable.innerHTML = shownBids
      .map((order) => `
          <tr>
            <td>${escapeHtml(order.item)}</td>
            <td class="ui-table__num">${Number(order.quantity).toLocaleString()}</td>
            <td class="ui-table__num">${toCurrency(order.unitPrice)}</td>
            <td>${order.mine ? "You" : escapeHtml(order.buyer || "")}</td>
            <td>${order.createdAt ? formatTime(order.createdAt) : "-"}</td>
            <td>${order.mine ? `<button class="ui-button ui-button--secondary" type="button" data-cancel-bid-id="${escapeHtml(order.id)}">Cancel</button>` : "-"}</td>
          </tr>`)
      .join("");
  }
  showEmpty(document.getElementById("exchange-bids-empty"), "exchange-bids-filtered", allBids.length, shownBids.length, "player buy orders");
  renderBidForm(market, view);

  // My Active Listings
  if (mySellOrdersTable) {
    mySellOrdersTable.innerHTML = mySellOrders
      .map(
        (order) => `
          <tr>
            <td>${escapeHtml(order.item)}</td>
            <td class="ui-table__num">${Number(order.quantity).toLocaleString()}</td>
            <td class="ui-table__num">${toCurrency(order.unitPrice)}</td>
            <td>${order.createdAt ? formatTime(order.createdAt) : "-"}</td>
            <td><button class="ui-button ui-button--secondary" type="button" data-cancel-order-id="${escapeHtml(order.id)}">Cancel</button></td>
          </tr>
        `
      )
      .join("");
  }
  showEmpty(mySellOrdersEmpty, "my-sell-orders-filtered", allMySellOrders.length, mySellOrders.length, "active listings");

  // Trade History
  const tradeHistoryTable = document.getElementById("trade-history-table");
  const tradeHistoryEmpty = document.getElementById("trade-history-empty");
  const tradeHistory = data?.corp?.tradeHistory || [];
  if (tradeHistoryTable) {
    tradeHistoryTable.innerHTML = tradeHistory
      .map(
        (t) => {
          const totalCell = tradeTotalCell(t);
          return `
          <tr>
            <td>${t.at ? timeHtml(t.at) : "-"}${t.ref ? `<br>${refHtml(t.ref)}` : ""}</td>
            <td>${tradeTypeBadge(t)}</td>
            <td>${escapeHtml(t.item || "-")}</td>
            <td class="ui-table__num">${Number(t.quantity || 0).toLocaleString()}</td>
            <td class="ui-table__num">${toCurrency(t.unitPrice || 0)}</td>
            <td class="ui-table__num">${totalCell}</td>
            <td>${escapeHtml(t.counterparty || "-")}</td>
          </tr>
        `;
        }
      )
      .join("");
  }
  if (tradeHistoryEmpty) tradeHistoryEmpty.hidden = tradeHistory.length > 0;
  // ISP-20: an empty table shows no header and no scroll furniture, only the empty state above it.
  const historyWrap = tradeHistoryTable?.closest(".ui-table-wrap");
  if (historyWrap) historyWrap.hidden = tradeHistory.length === 0;

  // AB#1055: every table here is cards below 768px (ui-table); each cell carries its column's name
  document.querySelectorAll("#market .ui-table").forEach(labelTableCells);
  paintListingStatus();
}

/**
 * AB#2057: what Create Listing last said goes under the button that was pressed, in that item's row. It was one line
 * below the whole table, out of sight once the player had scrolled to a row's button, so a refused price looked like
 * a dead click. It lives in appState, so a redraw of the table keeps it. When that row is gone (the whole stock was
 * listed), it goes in the line below the table.
 */
/**
 * AB#2472 (DOCTRINE P-010): show one of the Exchange's subpages, as the ARIA tabs pattern has it (only the selected tab
 * in the tab order), and the price chart and filters only on the pages with orders to filter.
 */
export function showExchangePage(page) {
  const current = EXCHANGE_PAGES.includes(page) ? page : DEFAULT_EXCHANGE_VIEW.page;
  const selected = document.querySelector(`#exchange-pages [data-exchange-page="${current}"]`);
  document.querySelectorAll("#exchange-pages [data-exchange-page]").forEach((tab) => {
    const on = tab === selected;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute("aria-controls") || "");
    if (panel) panel.hidden = !on;
  });
  const tools = document.getElementById("exchange-tools");
  if (tools) tools.hidden = !ORDER_PAGES.has(current);
}

export function paintListingStatus() {
  const status = appState.listingStatus;
  const rows = [...document.querySelectorAll("#market-sell-grid [data-sell-status]")];
  for (const el of rows) {
    el.textContent = "";
    el.className = "exchange__row-status";
    el.removeAttribute("role");
  }
  const below = document.getElementById("listing-status");
  if (below) below.textContent = "";
  if (!status) return;
  const inRow = rows.find((el) => el.getAttribute("data-sell-status") === status.item);
  const target = inRow || below;
  if (!target) return;
  target.innerHTML = withProtocol(status.text, status.protocol);
  if (inRow) {
    inRow.className = `exchange__row-status exchange__row-status--${status.tone === "ok" ? "ok" : "error"}`;
    inRow.setAttribute("role", status.tone === "ok" ? "status" : "alert");
  }
  if (status.reveal) {
    status.reveal = false; // only when it is first said, not on every redraw
    target.scrollIntoView({ block: "nearest" });
  }
}

/** AB#1054: the buy-order form's item list (the exchange's tradeable items) and what the order would hold. */
function renderBidForm(market, view) {
  const select = document.getElementById("bid-item");
  const items = market.tradeItems || [];
  if (select && items.length && select.options.length !== items.length) {
    const keep = select.value || view.resource || "Silicates";
    select.innerHTML = items.map((i) => `<option value="${escapeHtml(i)}"${i === keep ? " selected" : ""}>${escapeHtml(i)}</option>`).join("");
  }
  paintBidTotal();
}

function paintBidTotal() {
  const el = document.getElementById("bid-total");
  if (!el) return;
  const numbers = tradeNumbers({ quantity: document.getElementById("bid-quantity")?.value ?? "", unitPrice: document.getElementById("bid-price")?.value ?? "" });
  el.textContent = numbers.ok
    ? `Holds ${toCurrency(numbers.values.quantity * numbers.values.unitPrice)} now; what fills below your price comes back.`
    : "Enter a whole quantity and price of at least 1.";
}

function sayListing(item, tone, text, protocol = null) {
  appState.listingStatus = { item, tone, text, protocol, reveal: true };
  paintListingStatus();
}

/** Galactic Exchange: selling, taking a listing down, buying, the filters, and selling to NPC buy orders. */
export function bindExchangeForms() {
  const sellGrid = document.getElementById("market-sell-grid");
  const buyStatus = document.getElementById("buy-status");

  sellGrid?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sell-item]");
    if (!button) {
      return;
    }

    const row = button.closest("tr");
    const item = button.getAttribute("data-sell-item");
    const qtyInput = row?.querySelector("[data-sell-qty]");
    const priceInput = row?.querySelector("[data-sell-price]");
    // AB#1164: what was typed, not Math.max(1, Number(x || 1)), which listed a cleared price at $1. A value that is not
    // a whole number of at least 1 goes to the server as typed, and its refusal is what the player reads.
    const typed = { quantity: qtyInput?.value ?? "", unitPrice: priceInput?.value ?? "" };
    const numbers = tradeNumbers(typed);
    const inventory = getInventory();
    const available = Number(inventory[item] || 0);

    if (!item || available <= 0) {
      sayListing(item, "error", "No stock available for this item.", onExchange("refused"));
      return;
    }

    if (numbers.ok && numbers.values.quantity > available) {
      sayListing(item, "error", `You hold ${available.toLocaleString("en-US")} here. List ${available.toLocaleString("en-US")} or fewer.`, onExchange("refused")); // Bug #4827
      return;
    }

    // A listing is public the moment it is made, so it is confirmed like a purchase or a sale: the price is seen
    // before anyone can buy at it.
    if (numbers.ok) {
      const { quantity, unitPrice } = numbers.values;
      const gross = quantity * unitPrice;
      const warning = await listingWarningRows(item, quantity, unitPrice); // ISP-233 (AB#928)
      const confirmed = await showTradeConfirmation({
        heading: "Create Listing",
        title: `List ${item}`,
        confirmLabel: "List",
        rows: [
          { label: "Item", value: item },
          { label: "Quantity", value: quantity.toLocaleString() },
          { label: "Unit Price", value: toCurrency(unitPrice), highlight: true },
          { label: "If it all sells", value: toCurrency(gross) },
          ...saleTaxRows(gross),
          ...warning
        ]
      });
      if (!confirmed) return;
    }

    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch("/api/market/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "sell",
          item,
          quantity: numbers.ok ? numbers.values.quantity : typed.quantity,
          unitPrice: numbers.ok ? numbers.values.unitPrice : typed.unitPrice
        })
      });

      const payload = await parseJsonResponse(response);
      const previousMarket = deepClone(appState.data?.market || { orderBook: [] });

      appState.data = deepClone(payload.account.state);
      appState.data.market = previousMarket;

      const soldAtOnce = (payload.fills || []).reduce((sum, f) => sum + f.quantity, 0); // AB#1054: to buy orders
      if (payload.order && soldAtOnce < Number(payload.order.quantity)) {
        appState.data.market.orderBook = [
          payload.order,
          ...(appState.data.market.orderBook || []).filter((order) => order.id !== payload.order.id)
        ];
      }

      // the server's own record of what was listed, not what the form thought it sent
      const stillListed = Number(payload.order?.quantity) - soldAtOnce;
      appState.listingStatus = soldAtOnce > 0
        ? { item, tone: "ok", text: `Sold ${soldAtOnce} ${item} at once to buy orders; ${stillListed} listed @ ${toCurrency(payload.order?.unitPrice)}.`, protocol: onExchange(stillListed > 0 ? "queued" : "complete") }
        : { item, tone: "ok", text: `Listing created: ${Number(payload.order?.quantity)} ${item} @ ${toCurrency(payload.order?.unitPrice)}.`, protocol: onExchange("queued") };
      renderMarket(appState.data);
      showActionReceipt(payload, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      await refreshFromServer();
    } catch (error) {
      sayListing(item, "error", `Sell listing failed: ${error.message}`, refusedOnExchange(error));
      pushFeedback(`Sell listing failed: ${error.message}`, "warn", refusedOnExchange(error));
    }
  });

  // Bug #425: take a listing down and get the unsold goods back at the station they were listed from.
  document.getElementById("my-sell-orders-table")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-cancel-order-id]");
    if (!button) return;
    const orderId = button.getAttribute("data-cancel-order-id");
    button.disabled = true;
    try {
      const response = await apiFetch(`/api/market/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
      const payload = await parseJsonResponse(response);
      const previousMarket = deepClone(appState.data?.market || { orderBook: [] }); // the order book is all this handler restores (AB#576)
      appState.data = deepClone(payload.account.state);
      appState.data.market = { ...previousMarket, orderBook: (previousMarket.orderBook || []).filter((order) => order.id !== orderId) };
      renderMarket(appState.data);
      appState.listingStatus = null; // a refusal shown before the cancel no longer applies
      paintListingStatus();
      pushFeedback("Listing cancelled; the goods are back in your station inventory.", "success", onExchange("cancelled"));
    } catch (error) {
      button.disabled = false;
      pushFeedback(`Could not cancel the listing: ${error.message}`, "warn", refusedOnExchange(error));
    }
  });

  // AB#1054: place a buy order. The server holds the credits and says what filled; its refusal is what is shown.
  const bidForm = document.getElementById("bid-form");
  for (const id of ["bid-quantity", "bid-price"]) document.getElementById(id)?.addEventListener("input", paintBidTotal);
  bidForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("bid-status");
    const submit = document.getElementById("bid-submit");
    const item = document.getElementById("bid-item")?.value || "";
    const typed = { quantity: document.getElementById("bid-quantity")?.value ?? "", unitPrice: document.getElementById("bid-price")?.value ?? "" };
    const numbers = tradeNumbers(typed);
    if (numbers.ok) {
      const { quantity, unitPrice } = numbers.values;
      const confirmed = await showTradeConfirmation({
        heading: "Place Buy Order",
        title: `Buy ${item}`,
        confirmLabel: "Place order",
        rows: [
          { label: "Item", value: item },
          { label: "Quantity", value: quantity.toLocaleString() },
          { label: "Up to, per unit", value: toCurrency(unitPrice), highlight: true },
          { label: "Held now", value: toCurrency(quantity * unitPrice) }
        ]
      });
      if (!confirmed) return;
    }
    if (submit) submit.disabled = true;
    try {
      const receiptTrigger = document.activeElement;
      const response = await apiFetch("/api/market/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "buy", item, quantity: numbers.ok ? numbers.values.quantity : typed.quantity, unitPrice: numbers.ok ? numbers.values.unitPrice : typed.unitPrice })
      });
      const payload = await parseJsonResponse(response);
      const filled = (payload.fills || []).reduce((sum, f) => sum + f.quantity, 0);
      if (status) status.innerHTML = payload.order ? withProtocol(`Bought ${filled} at once; ${payload.order.quantity} ${item} waiting at ${toCurrency(payload.order.unitPrice)}.`, onExchange("queued")) : withProtocol(`Bought ${filled} ${item}: the order is filled.`, onExchange("complete"));
      showActionReceipt(payload, { returnFocusTo: receiptTrigger });
      await refreshFromServer();
    } catch (error) {
      if (status) status.innerHTML = withProtocol(`Buy order refused: ${error.message}`, refusedOnExchange(error));
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  // AB#1054: take a buy order down; the credits it still holds come back.
  document.getElementById("exchange-bids-table")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-cancel-bid-id]");
    if (!button) return;
    button.disabled = true;
    try {
      const response = await apiFetch(`/api/market/orders/${encodeURIComponent(button.getAttribute("data-cancel-bid-id"))}/cancel`, { method: "POST" });
      const payload = await parseJsonResponse(response);
      pushFeedback(`Buy order cancelled; ${toCurrency(payload.refunded)} returned to your reserves.`, "success", onExchange("cancelled"));
      await refreshFromServer();
    } catch (error) {
      button.disabled = false;
      pushFeedback(`Could not cancel the buy order: ${error.message}`, "warn", refusedOnExchange(error));
    }
  });

  // Exchange buy buttons
  const buyTableEl = document.getElementById("exchange-buy-table");
  // AB#815: the same purchase from a player listing or an NPC ask; both go through POST /orders/:id/buy.
  const buyFromBook = async (event) => {
    const button = event.target.closest("[data-buy-order-id]");
    if (!button) return;
    const row = button.closest("tr");
    const orderId = String(button.getAttribute("data-buy-order-id") || "");
    const item = button.getAttribute("data-buy-item");
    const price = Number(button.getAttribute("data-buy-price"));
    const maxQty = Number(button.getAttribute("data-buy-qty"));
    const qtyInput = row?.querySelector(`[data-buy-order-qty="${orderId}"]`);
    // AB#1164: the quantity as typed. A blank, 0, negative or unreadable quantity used to become 1, and one larger than
    // the listing was quietly cut to it; now the confirmation shows only a quantity that can be bought, and anything
    // else goes to the server as typed, whose refusal is what the player reads.
    const typedQty = qtyInput?.value ?? "";
    const { ok, values } = tradeNumbers({ quantity: typedQty });
    const qty = values.quantity;
    const buyStatus = document.getElementById("buy-status");
    const seller = row?.children[3]?.querySelector("[data-counterparty-name]")?.textContent || row?.children[3]?.textContent || "Anonymous"; // AB#818: the name, not its badge

    if (ok && qty <= maxQty) {
      const confirmed = await showTradeConfirmation({
        heading: "Buy from Sell Order",
        title: `Buy ${item}`,
        confirmLabel: "Buy",
        rows: [
          { label: "Item", value: item },
          { label: "Quantity", value: qty.toLocaleString() },
          { label: "Unit Price", value: toCurrency(price) },
          { label: "Seller", value: seller },
          { label: "Total Cost", value: toCurrency(qty * price), highlight: true }
        ]
      });
      if (!confirmed) return;
    }

    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(`/api/market/orders/${encodeURIComponent(orderId)}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: ok ? qty : typedQty })
      });

      const payload = await parseJsonResponse(response);
      appState.data = deepClone(payload.account.state);
      if (buyStatus) {
        buyStatus.innerHTML = withProtocol(`Executed purchase: ${qty.toLocaleString()} \u00d7 ${item} at ${toCurrency(price)}/unit.`, onExchange("complete"));
      }
      appState.listingStatus = null;
      paintListingStatus();
      pushFeedback(`Purchase executed: ${item} \u00d7 ${qty} @ ${toCurrency(price)}/unit.`, "success", onExchange("complete"));
      flashButtonSuccess(button);
      await refreshFromServer();
      showActionReceipt(payload, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
    } catch (error) {
      if (buyStatus) {
        buyStatus.innerHTML = withProtocol(`Buy order failed: ${error.message}`, refusedOnExchange(error));
      }
      pushFeedback(`Buy order rejected. ${error.message}`, "error", refusedOnExchange(error));
    }
  };
  buyTableEl?.addEventListener("click", buyFromBook);
  document.getElementById("npc-sell-table")?.addEventListener("click", buyFromBook);

  // Resource pills, order type, sort and Clear filters: change the view, remember it, redraw (AB#402)
  const setExchangeView = (changes) => {
    appState.exchangeView = { ...appState.exchangeView, ...changes };
    saveExchangeView(viewerStorage(), appState.exchangeView);
    renderMarket(appState.data);
  };
  document.getElementById("exchange-filter-bar")?.addEventListener("click", (event) => {
    const pill = event.target.closest("[data-filter]");
    if (pill) setExchangeView({ resource: pill.getAttribute("data-filter") || "" });
  });
  // AB#2472: a subpage is chosen by click, or by the arrow keys, Home and End from the selected one. Only the page
  // changes, so the tables are not redrawn.
  const pages = document.getElementById("exchange-pages");
  showExchangePage(appState.exchangeView.page); // before the market's data arrives, so the page never flips once drawn
  const choosePage = (tab, focus) => {
    appState.exchangeView = { ...appState.exchangeView, page: tab.dataset.exchangePage };
    saveExchangeView(viewerStorage(), appState.exchangeView);
    showExchangePage(appState.exchangeView.page);
    if (focus) tab.focus();
  };
  pages?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-exchange-page]");
    if (tab) choosePage(tab, false);
  });
  pages?.addEventListener("keydown", (event) => {
    const all = [...pages.querySelectorAll("[data-exchange-page]")];
    const i = all.indexOf(document.activeElement);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[event.key];
    if (i < 0 || next === undefined) return;
    event.preventDefault();
    choosePage(all[(next + all.length) % all.length], true);
  });
  document.getElementById("exchange-sort")?.addEventListener("change", (event) => setExchangeView({ sort: event.target.value }));
  // AB#884: a tier drops a resource pill chosen from another tier
  document.getElementById("exchange-tier-filter")?.addEventListener("change", (event) => setExchangeView({ tier: event.target.value, resource: DEFAULT_EXCHANGE_VIEW.resource }));
  document.getElementById("exchange-sellers-filter")?.addEventListener("change", (event) => setExchangeView({ sellers: event.target.value })); // ISP-208 (AB#903)
  document.getElementById("market")?.addEventListener("click", (event) => {
    // ISP-124 (AB#818): an NPC's name opens its profile card.
    const npc = event.target.closest("[data-npc-profile]");
    if (npc) {
      showNpcProfile(npc.getAttribute("data-npc-profile"), npc);
      return;
    }
    if (event.target.closest("[data-clear-filters]")) {
      setExchangeView({ resource: DEFAULT_EXCHANGE_VIEW.resource, tier: DEFAULT_EXCHANGE_VIEW.tier });
    }
  });

  // AB#4710: every standing buyer, or back to what the player holds here
  document.getElementById("npc-buy-show-all")?.addEventListener("click", () => {
    appState.standingShowAll = !appState.standingShowAll;
    renderMarket(appState.data);
  });

  // NPC standing buy order — sell buttons
  const npcBuyTableEl = document.getElementById("npc-buy-table");
  npcBuyTableEl?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-npc-order-id]");
    if (!button) return;
    const row = button.closest("tr");
    const orderId = String(button.getAttribute("data-npc-order-id") || "");
    const item = button.getAttribute("data-npc-item");
    const price = Number(button.getAttribute("data-npc-price"));
    const qtyInput = row?.querySelector(`[data-npc-sell-qty="${orderId}"]`);
    // AB#1164: the quantity as typed; a blank, 0 or unreadable one is no longer a sale of 1. Only a whole number of at
    // least 1 is confirmed; anything else goes to the server as typed and its refusal is shown.
    const typedQty = qtyInput?.value ?? "";
    const { ok, values } = tradeNumbers({ quantity: typedQty });
    const qty = values.quantity;
    const npcStatus = document.getElementById("npc-buy-status");

    if (ok) {
      const grossTotal = qty * price;
      const buyer = row?.children[1]?.querySelector("[data-counterparty-name]")?.textContent || row?.children[1]?.textContent || "NPC"; // AB#818
      const confirmed = await showTradeConfirmation({
        heading: "Sell to Standing Buy Order",
        title: `Sell ${item}`,
        confirmLabel: "Sell",
        rows: [
          { label: "Item", value: item },
          { label: "Quantity", value: qty.toLocaleString() },
          { label: "Unit Price", value: toCurrency(price) },
          { label: "Buyer", value: buyer },
          { label: "Gross Total", value: toCurrency(grossTotal) },
          ...saleTaxRows(grossTotal)
        ]
      });
      if (!confirmed) return;
    }

    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(`/api/market/npc-orders/${encodeURIComponent(orderId)}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: ok ? qty : typedQty })
      });

      const payload = await parseJsonResponse(response);
      appState.data = deepClone(payload.account.state);
      const traded = payload.traded || {};
      const proceeds = traded.proceeds != null ? traded.proceeds : qty * price;
      if (npcStatus) {
        // ISP-232 (AB#927): everything the sale took, not only the tax; Bug #4853: the same list the Trade History shows
        const taken = saleDeductions(traded);
        const taxNote = taken.length ? ` (${taken.join(", ")})` : "";
        npcStatus.innerHTML = withProtocol(`Sold ${qty.toLocaleString()} × ${item} at ${toCurrency(price)}/unit — ${toCurrency(proceeds)} credited${taxNote}.`, onExchange("complete"));
      }
      pushFeedback(`Sold ${item} × ${qty} @ ${toCurrency(price)}/unit to ${escapeHtml(button.closest("tr")?.children[1]?.textContent || "NPC")}. ${toCurrency(proceeds)} credited.`, "success", onExchange("complete"));
      flashButtonSuccess(button);
      await refreshFromServer();
      showActionReceipt(payload, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
    } catch (error) {
      if (npcStatus) {
        npcStatus.innerHTML = withProtocol(`Sale failed: ${error.message}`, refusedOnExchange(error));
      }
      pushFeedback(`NPC sell rejected. ${error.message}`, "error", refusedOnExchange(error));
    }
  });
}
