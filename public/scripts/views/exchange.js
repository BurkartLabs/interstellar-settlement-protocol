// The Galactic Exchange tab: listings, buying, selling and the filters.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { DEFAULT_EXCHANGE_VIEW, MY_LISTINGS_SHOWN, SELL_ORDERS_SHOWN, cappedNote, filteredEmptyHtml, saveExchangeView, tradeNumbers, viewOrders } from "../exchangeView.js";
import { deepClone, formatTime, toCurrency } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { appState, viewerStorage } from "../state.js";
import { suggestedListingPrice } from "../suggestedPrice.js";
import { labelTableCells } from "../tableLabels.js";
import { tradeTotalCell, tradeTypeBadge } from "../tradeHistory.js";
import { flashButtonSuccess, getCurrentStationInfo, getInventory, pushFeedback, refreshFromServer, showTradeConfirmation, stationLocationBanner } from "./shared.js";

export function getClientExchangeTaxPct() {
  return Number(appState.data?.corp?.finances?.exchangeSalesTaxPct ?? 8);
}

import { numberMarkup } from "../numberChange.js"; // AB#745: marks a number that is acknowledged when it changes
export function renderMarket(data) {
  const station = getCurrentStationInfo(data);
  const bannerEl = document.getElementById("market-station-banner");
  if (bannerEl) bannerEl.innerHTML = stationLocationBanner(station);

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
  const allSellOrders = (market.orderBook || []).filter((order) => order.type === "sell" && !isOwnSellOrder(order));
  const allMySellOrders = (market.orderBook || []).filter((order) => order.type === "sell" && isOwnSellOrder(order));
  const npcBuyOrders = market.npcBuyOrders || [];

  const view = appState.exchangeView;

  // Build resource filter pills from all visible resources, keeping a remembered resource that has no orders today so
  // the viewer can see which filter is on
  const resourceSet = new Set();
  allSellOrders.forEach((o) => o.item && resourceSet.add(o.item));
  npcBuyOrders.forEach((o) => o.item && resourceSet.add(o.item));
  allMySellOrders.forEach((o) => o.item && resourceSet.add(o.item));
  if (view.resource) resourceSet.add(view.resource);
  const resources = Array.from(resourceSet).sort();

  const filterBar = document.getElementById("exchange-filter-bar");
  if (filterBar) {
    const cur = view.resource;
    filterBar.innerHTML =
      `<button class="exchange-filter-pill${!cur ? " active" : ""}" data-filter="">All</button>` +
      resources.map((r) => `<button class="exchange-filter-pill${cur === r ? " active" : ""}" data-filter="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join("");
  }
  const typeSelect = document.getElementById("exchange-type-filter");
  if (typeSelect) typeSelect.value = view.type;
  const sortSelect = document.getElementById("exchange-sort");
  if (sortSelect) sortSelect.value = view.sort;

  // Order-type filter: one table, or all of them (AB#402)
  const showSection = (id, type) => {
    const el = document.getElementById(id);
    if (el) el.hidden = view.type !== "all" && view.type !== type;
  };
  showSection("exchange-sell-section", "sell");
  showSection("exchange-standing-section", "standing");
  showSection("exchange-mine-section", "mine");

  // Filter by resource and sort, then cap: the cap applies to what the viewer asked to see (AB#402)
  const viewedSellOrders = viewOrders(allSellOrders, view);
  const filteredSellOrders = viewedSellOrders.slice(0, SELL_ORDERS_SHOWN);
  const filteredNpcOrders = viewOrders(npcBuyOrders, view);
  const viewedMySellOrders = viewOrders(allMySellOrders, view);
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
    const tableWrap = filteredEl.parentElement?.querySelector(".table-wrap");
    if (tableWrap) tableWrap.hidden = shown === 0;
    filteredEl.hidden = !(total > 0 && shown === 0);
    filteredEl.innerHTML = filteredEl.hidden ? "" : filteredEmptyHtml(label, view.resource, total);
  };

  // Sell Orders table (player can buy from these)
  if (buyTable) {
    buyTable.innerHTML = filteredSellOrders
      .map(
        (order) => `
          <tr>
            <td>${escapeHtml(order.item)}</td>
            <td>${Number(order.quantity).toLocaleString()}</td>
            <td>${toCurrency(order.unitPrice)}</td>
            <td>${escapeHtml(order.seller || "Anonymous")}</td>
            <td><input class="sell-input" type="number" min="1" max="${Number(order.quantity)}" value="1" data-buy-order-qty="${order.id}" /></td>
            <td><button class="btn btn-accent exchange-buy-btn" type="button" data-buy-order-id="${order.id}" data-buy-item="${escapeHtml(order.item)}" data-buy-price="${Number(order.unitPrice)}" data-buy-qty="${Number(order.quantity)}">Buy</button></td>
          </tr>
        `
      )
      .join("");
  }
  showEmpty(buyEmpty, "exchange-buy-filtered", allSellOrders.length, filteredSellOrders.length, "player sell orders");

  // NPC Standing Buy Orders table (player can sell into these)
  if (npcBuyTable) {
    npcBuyTable.innerHTML = filteredNpcOrders
      .map((order) => {
        const exhausted = order.remainingQty <= 0;
        const fillPct = Math.round(((order.totalQtyPerDay - order.remainingQty) / order.totalQtyPerDay) * 100);
        return `
          <tr class="${exhausted ? "npc-order-exhausted" : ""}">
            <td>${escapeHtml(order.item)}</td>
            <td>${escapeHtml(order.buyer)}</td>
            <td>
              ${toCurrency(order.unitPrice)}
              ${
                // ISP-87: the bid falls as the day's volume is sold into it. Saying so where the price is shown is
                // the difference between a number that looks wrong and a market a player can read.
                Number(order.basePrice) > Number(order.unitPrice)
                  ? `<div class="npc-order-drift">down from ${toCurrency(order.basePrice)} on today&#39;s volume</div>`
                  : ""
              }
            </td>
            <td>
              <div class="npc-order-remaining">${Number(order.remainingQty).toLocaleString()} <span class="npc-order-of-total">/ ${Number(order.totalQtyPerDay).toLocaleString()}</span></div>
              <div class="npc-order-track"><div class="npc-order-fill" style="width:${fillPct}%"></div></div>
            </td>
            <td>
              <input class="sell-input" type="number" min="1" max="${Number(order.remainingQty)}" value="1" data-npc-sell-qty="${order.id}" ${exhausted ? "disabled" : ""} />
            </td>
            <td>
              <button class="btn btn-accent npc-sell-btn" type="button" data-npc-order-id="${order.id}" data-npc-item="${escapeHtml(order.item)}" data-npc-price="${Number(order.unitPrice)}" ${exhausted ? "disabled" : ""}>Sell</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }
  showEmpty(npcBuyEmpty, "npc-buy-filtered", npcBuyOrders.length, filteredNpcOrders.length, "standing buy orders");

  // Inventory snapshot
  const inventory = getInventory();
  const entries = Object.entries(inventory).filter(([, qty]) => Number(qty) > 0);
  const inventoryList = document.getElementById("inventory-list");
  inventoryList.innerHTML = entries.length
    ? entries.map(([name, qty]) => `<li>${escapeHtml(name)}: ${numberMarkup(`exchange:inventory:${data.corp?.currentStationId}:${name}`, qty, Number(qty).toLocaleString())}</li>`).join("")
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
            <td>${Number(qty).toLocaleString()}</td>
            <td><input class="sell-input" type="number" min="1" max="${Number(qty)}" value="1" data-sell-qty="${escapeHtml(name)}" /></td>
            <td><input class="sell-input" type="number" min="1" value="${defaultPrice}" data-sell-price="${escapeHtml(name)}" /></td>
            <td><button class="btn btn-accent" type="button" data-sell-item="${escapeHtml(name)}">Create Listing</button></td>
          </tr>
        `;
        }
      )
      .join("");
  }
  if (sellEmpty) sellEmpty.hidden = entries.length > 0;
  // AB#1857: nothing to list, so no headers over an empty body either (as showEmpty does for the other tables)
  const sellTableWrap = sellGrid?.closest(".table-wrap");
  if (sellTableWrap) sellTableWrap.hidden = entries.length === 0;

  // My Active Listings
  if (mySellOrdersTable) {
    mySellOrdersTable.innerHTML = mySellOrders
      .map(
        (order) => `
          <tr>
            <td>${escapeHtml(order.item)}</td>
            <td>${Number(order.quantity).toLocaleString()}</td>
            <td>${toCurrency(order.unitPrice)}</td>
            <td>${order.createdAt ? formatTime(order.createdAt) : "-"}</td>
            <td><button class="btn btn-ghost exchange-cancel-btn" type="button" data-cancel-order-id="${escapeHtml(order.id)}">Cancel</button></td>
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
            <td class="trade-time">${t.at ? formatTime(t.at) : "-"}</td>
            <td>${tradeTypeBadge(t)}</td>
            <td>${escapeHtml(t.item || "-")}</td>
            <td>${Number(t.quantity || 0).toLocaleString()}</td>
            <td>${toCurrency(t.unitPrice || 0)}</td>
            <td>${totalCell}</td>
            <td class="trade-counterparty">${escapeHtml(t.counterparty || "-")}</td>
          </tr>
        `;
        }
      )
      .join("");
  }
  if (tradeHistoryEmpty) tradeHistoryEmpty.hidden = tradeHistory.length > 0;

  // AB#1055: the action tables stack into one card per row at phone width; each cell carries its column's name
  document.querySelectorAll("#market .data-table--stack").forEach(labelTableCells);
}

/** Galactic Exchange: selling, taking a listing down, buying, the filters, and selling to NPC buy orders. */
export function bindExchangeForms() {
  const sellGrid = document.getElementById("market-sell-grid");
  const listingStatus = document.getElementById("listing-status");
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
      listingStatus.textContent = "No stock available for this item.";
      return;
    }

    if (numbers.ok && numbers.values.quantity > available) {
      listingStatus.textContent = "Quantity exceeds available inventory.";
      return;
    }

    // A listing is public the moment it is made, so it is confirmed like a purchase or a sale: the price is seen
    // before anyone can buy at it.
    if (numbers.ok) {
      const { quantity, unitPrice } = numbers.values;
      const gross = quantity * unitPrice;
      const taxPct = getClientExchangeTaxPct();
      const tax = Math.round(gross * taxPct / 100);
      const confirmed = await showTradeConfirmation({
        heading: "Create Listing",
        title: `List ${item}`,
        confirmLabel: "List",
        rows: [
          { label: "Item", value: item },
          { label: "Quantity", value: quantity.toLocaleString() },
          { label: "Unit Price", value: toCurrency(unitPrice), highlight: true },
          { label: "If it all sells", value: toCurrency(gross) },
          { label: `GEX Sales Tax (${taxPct}%)`, value: `− ${toCurrency(tax)}`, muted: true },
          { label: "You Receive", value: toCurrency(gross - tax), highlight: true }
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

      if (payload.order) {
        appState.data.market.orderBook = [
          payload.order,
          ...(appState.data.market.orderBook || []).filter((order) => order.id !== payload.order.id)
        ];
      }

      renderMarket(appState.data);
      showActionReceipt(payload, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      // the server's own record of what was listed, not what the form thought it sent
      listingStatus.textContent = `Listing created: ${Number(payload.order?.quantity)} ${item} @ ${toCurrency(payload.order?.unitPrice)}.`;
      await refreshFromServer();
    } catch (error) {
      listingStatus.textContent = `Sell listing failed: ${error.message}`;
    }
  });

  // Bug #425: take a listing down and get the unsold goods back at the station they were listed from.
  document.getElementById("my-sell-orders-table")?.addEventListener("click", async (event) => {
    const button = event.target.closest(".exchange-cancel-btn");
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
      if (listingStatus) listingStatus.textContent = ""; // a refusal shown before the cancel no longer applies
      pushFeedback("Listing cancelled; the goods are back in your station inventory.", "success");
    } catch (error) {
      button.disabled = false;
      pushFeedback(`Could not cancel the listing: ${error.message}`, "warn");
    }
  });

  // Exchange buy buttons
  const buyTableEl = document.getElementById("exchange-buy-table");
  buyTableEl?.addEventListener("click", async (event) => {
    const button = event.target.closest(".exchange-buy-btn");
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
    const listingStatus = document.getElementById("listing-status");
    const buyStatus = document.getElementById("buy-status");
    const seller = row?.children[3]?.textContent || "Anonymous";

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
        buyStatus.textContent = `Executed purchase: ${qty.toLocaleString()} \u00d7 ${escapeHtml(item)} at ${toCurrency(price)}/unit.`;
      }
      if (listingStatus) {
        listingStatus.textContent = "";
      }
      pushFeedback(`Purchase executed: ${item} \u00d7 ${qty} @ ${toCurrency(price)}/unit.`, "success");
      flashButtonSuccess(button);
      await refreshFromServer();
      showActionReceipt(payload, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
    } catch (error) {
      if (buyStatus) {
        buyStatus.textContent = `Buy order failed: ${error.message}`;
      }
      pushFeedback(`Buy order rejected. ${error.message}`, "error");
    }
  });

  // Resource pills, order type, sort and Clear filters: change the view, remember it, redraw (AB#402)
  const setExchangeView = (changes) => {
    appState.exchangeView = { ...appState.exchangeView, ...changes };
    saveExchangeView(viewerStorage(), appState.exchangeView);
    renderMarket(appState.data);
  };
  document.getElementById("exchange-filter-bar")?.addEventListener("click", (event) => {
    const pill = event.target.closest(".exchange-filter-pill");
    if (pill) setExchangeView({ resource: pill.getAttribute("data-filter") || "" });
  });
  document.getElementById("exchange-type-filter")?.addEventListener("change", (event) => setExchangeView({ type: event.target.value }));
  document.getElementById("exchange-sort")?.addEventListener("change", (event) => setExchangeView({ sort: event.target.value }));
  document.getElementById("market")?.addEventListener("click", (event) => {
    if (event.target.closest(".exchange-clear-filters")) {
      setExchangeView({ resource: DEFAULT_EXCHANGE_VIEW.resource, type: DEFAULT_EXCHANGE_VIEW.type });
    }
  });

  // NPC standing buy order — sell buttons
  const npcBuyTableEl = document.getElementById("npc-buy-table");
  npcBuyTableEl?.addEventListener("click", async (event) => {
    const button = event.target.closest(".npc-sell-btn");
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
      const taxPct = getClientExchangeTaxPct();
      const taxAmount = Math.round(grossTotal * taxPct / 100);
      const buyer = row?.children[1]?.textContent || "NPC";
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
          { label: `GEX Sales Tax (${taxPct}%)`, value: `− ${toCurrency(taxAmount)}`, muted: true },
          { label: "You Receive", value: toCurrency(grossTotal - taxAmount), highlight: true }
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
      const taxAmt = traded.taxAmount || 0;
      if (npcStatus) {
        const taxNote = taxAmt > 0 ? ` (${toCurrency(taxAmt)} tax)` : "";
        npcStatus.textContent = `Sold ${qty.toLocaleString()} × ${escapeHtml(item)} at ${toCurrency(price)}/unit — ${toCurrency(proceeds)} credited${taxNote}.`;
      }
      pushFeedback(`Sold ${item} × ${qty} @ ${toCurrency(price)}/unit to ${escapeHtml(button.closest("tr")?.children[1]?.textContent || "NPC")}. ${toCurrency(proceeds)} credited.`, "success");
      flashButtonSuccess(button);
      await refreshFromServer();
      showActionReceipt(payload, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
    } catch (error) {
      if (npcStatus) {
        npcStatus.textContent = `Sale failed: ${error.message}`;
      }
      pushFeedback(`NPC sell rejected. ${error.message}`, "error");
    }
  });
}
