// The Logistics tab: shipments between stations.
// AB#739 (ISP-53): everything here moved from app.js unchanged. ISP-79 (AB#768): drawn from the design system.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone, formatDuration, toCurrency } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { MAX_TRANSFER_LINES, describeHops, describeLines, feePerUnit, stationHops, transferFee, transitMinutes } from "../logistics.js";
import { transferFeeWaived } from "../memberRates.js"; // ISP-212 (AB#907)
import { appState } from "../state.js";
import { formatSystemLabel, getAllInventory, getCurrentStationInfo, pushFeedback, updateAllViews } from "./shared.js";

export function renderLogistics(data) {
  const station = getCurrentStationInfo(data);
  // Where the goods come to, in the screen's header (the Station tab's banner is Station's own).
  const dockedEl = document.getElementById("logistics-docked");
  if (dockedEl) {
    dockedEl.textContent = station
      ? `Docked at ${station.name} — ${station.body}, ${formatSystemLabel(station.systemId || "sol")}`
      : "";
  }

  const contentEl = document.getElementById("logistics-content");
  if (!contentEl) return;

  const allInventory = getAllInventory();
  const stationRegistry = appState.stationRegistry || [];
  const currentStationId = data.corp?.currentStationId || "earth-station-prime";
  const credits = Number(data.corp?.finances?.credits || 0);
  const currentName = station?.name || "current station";
  const stationName = (id) => stationRegistry.find((st) => st.id === id)?.name || id;
  // AB#718: the fee depends on how far the goods go. Null until the rates have loaded; the server quotes it then.
  const rates = appState.logisticsRates || null;
  const hopsFrom = (fromStation) => stationHops(stationRegistry, fromStation, currentStationId, appState.navigation);
  // ISP-212 (AB#907): a member moving goods to or from its conglomerate's station, in its system, pays nothing
  const waived = (fromStation, hops) => transferFeeWaived(appState.conglomerate?.station?.id ?? null, fromStation, currentStationId, hops);
  // The last outcome on a station card (AB#717): errors name the fix, and survive the re-renders a tick causes.
  const status = appState.logisticsStatus || null;
  // Picks and typed quantities survive those re-renders too, until the transfer goes through.
  if (!appState.logisticsDraft) appState.logisticsDraft = {};
  const draft = appState.logisticsDraft;

  // Summary tiles
  const totalRemoteUnits = stationRegistry
    .filter((st) => st.id !== currentStationId)
    .reduce((sum, st) => {
      const inv = allInventory[st.id] || {};
      return sum + Object.values(inv).reduce((s, q) => s + Number(q || 0), 0);
    }, 0);

  const summary = `
    <section class="kpi-strip" aria-label="Logistics">
      <div class="kpi-tile">
        <span class="kpi-tile__label">Docked at</span>
        <span class="kpi-tile__value logistics__tile-text">${escapeHtml(currentName)}</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-tile__label">Remote units</span>
        <span class="kpi-tile__value">${totalRemoteUnits.toLocaleString()}</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-tile__label">Transfer fee</span>
        <span class="kpi-tile__value logistics__tile-text">${rates ? `${toCurrency(rates.sameSystemFeePerUnit)} / unit in system, +${toCurrency(rates.perJumpFeePerUnit)} a jump` : "By distance"}</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-tile__label">Credits</span>
        <span class="kpi-tile__value">${toCurrency(credits)}</span>
      </div>
    </section>`;

  // Build per-station cards. Current station uses an inventory list; remote stations use an item-row layout with a
  // pick box and quantity per item, a Move button per row, and one button that moves every picked row together.
  let cardsHtml = "";
  for (const st of stationRegistry) {
    const inv = allInventory[st.id] || {};
    const entries = Object.entries(inv).filter(([, qty]) => Number(qty) > 0);
    const isCurrent = st.id === currentStationId;
    const badge = isCurrent ? `<span class="ui-badge ui-badge--accent">Docked</span>` : "";
    const subhead = `${escapeHtml(st.body || "")}${st.systemId ? ` · ${escapeHtml(formatSystemLabel(st.systemId))}` : ""}`;
    const hops = isCurrent ? null : hopsFrom(st.id);
    // ISP-279 (AB#986): the quote now names the arrival time too, not just the fee — a delay the player cannot
    // see before sending reads as goods going missing (D-0.5-1's third story, after AB#985's server-side transit).
    const routeFee = rates && hops !== null && entries.length
      ? `<p class="ui-card__body logistics__route-fee">Fee to ${escapeHtml(currentName)}: <strong>${waived(st.id, hops) ? "free for members" : `${toCurrency(feePerUnit(rates, hops))} per unit`}</strong>, <strong>${escapeHtml(formatDuration(transitMinutes(rates, hops) * 60_000))} transit</strong> (${escapeHtml(describeHops(hops))})</p>`
      : "";

    let itemsHtml = "";
    if (!entries.length) {
      itemsHtml = `<p class="ui-card__meta">No assets stored at this station.</p>`;
    } else if (isCurrent) {
      itemsHtml = `<ul class="logistics__items">` + entries
        .map(([item, qty]) => `<li class="logistics__item">
          <span class="logistics__item-name">${escapeHtml(item)}</span>
          <span class="ui-figure">${Number(qty).toLocaleString()}</span>
        </li>`).join("") + `</ul>`;
    } else {
      itemsHtml = `<ul class="logistics__items">` + entries.map(([item, qty], index) => {
        const maxQty = Number(qty);
        const kept = draft[`${st.id}|${item}`] || {};
        const pickId = `logistics-pick-${escapeHtml(st.id)}-${index}`;
        return `<li class="logistics__item logistics__item--transfer">
          <input type="checkbox" id="${pickId}" class="logistics__pick" data-from-station="${escapeHtml(st.id)}" data-item="${escapeHtml(item)}"${kept.picked ? " checked" : ""} />
          <label class="logistics__item-label" for="${pickId}">
            <span class="logistics__item-name">${escapeHtml(item)}</span>
            <span class="ui-card__meta">${maxQty.toLocaleString()} avail</span>
          </label>
          <div class="logistics__controls">
            <input type="number" class="ui-input logistics__qty" min="1" step="1" max="${maxQty}" value="${escapeHtml(kept.qty ?? maxQty)}"
              data-from-station="${escapeHtml(st.id)}" data-item="${escapeHtml(item)}" aria-label="Quantity of ${escapeHtml(item)} to move" />
            <button class="ui-button ui-button--secondary logistics__move" type="button"
              data-from-station="${escapeHtml(st.id)}" data-item="${escapeHtml(item)}">
              Move → ${escapeHtml(currentName)}
            </button>
          </div>
        </li>`;
      }).join("") + `</ul>
        <div class="logistics__bulk">
          <button class="ui-button ui-button--secondary logistics__move-picked" type="button" data-from-station="${escapeHtml(st.id)}" disabled>Move picked items</button>
          <span class="ui-field__hint logistics__bulk-fee" data-from-station="${escapeHtml(st.id)}">Pick up to ${MAX_TRANSFER_LINES} items to move together.</span>
        </div>`;
    }
    const cardStatus = status && status.stationId === st.id
      ? `<p class="logistics__status logistics__status--${status.tone === "ok" ? "ok" : "error"}" role="${status.tone === "ok" ? "status" : "alert"}">${escapeHtml(status.text)}</p>`
      : "";

    cardsHtml += `
      <section class="ui-card logistics__station${isCurrent ? " logistics__station--current" : ""}">
        <header class="logistics__station-head">
          <h4 class="ui-card__title">${escapeHtml(st.name)}</h4>
          ${badge}
        </header>
        <p class="ui-card__meta">${subhead}</p>
        ${routeFee}
        ${itemsHtml}
        ${cardStatus}
      </section>`;
  }

  // Shipments in flight (ISP-279, AB#986): corp.shipments (AB#985) until shipmentTick delivers or holds them.
  // Moves to Transfer History on arrival with no reload — the server pushes logistics:arrived over the socket
  // (mirroring travel:arrived) and this whole panel is rebuilt on the next renderAllViews() that follows.
  const shipments = Array.isArray(data.corp?.shipments) ? data.corp.shipments : [];
  const inFlightHtml = `
    <section id="logistics-in-flight" class="ui-panel" aria-labelledby="logistics-in-flight-title">
      <header class="ui-panel__header"><h3 id="logistics-in-flight-title" class="ui-panel__title">Shipments In Transit</h3></header>
      <div class="ui-panel__body">
      ${shipments.length
        ? `<table class="ui-table logistics__in-flight">
            <thead><tr><th scope="col">Route</th><th scope="col">Goods</th><th scope="col" class="ui-table__num">Fee</th><th scope="col">Arrives</th></tr></thead>
            <tbody>${shipments.map((s) => {
            const remainingMs = Math.max(0, (s.arrivesAt || 0) - Date.now());
            const eta = s.status === "held"
              ? `<span class="ui-badge ui-badge--warn">Held</span> Destination unreachable`
              : `<span class="logistics__eta" data-arrives-at="${escapeHtml(String(s.arrivesAt || 0))}">${remainingMs > 0 ? escapeHtml(formatDuration(remainingMs)) : "Arriving"}</span>`;
            return `<tr class="logistics__shipment${s.status === "held" ? " logistics__shipment--held" : ""}">
              <td data-label="Route">${escapeHtml(stationName(s.fromStationId))} → ${escapeHtml(stationName(s.toStationId))}</td>
              <td data-label="Goods">${escapeHtml(describeLines(s.lines))}</td>
              <td class="ui-figure" data-label="Fee">${toCurrency(s.fee)}</td>
              <td data-label="Arrives">${eta}</td>
            </tr>`;
          }).join("")}</tbody></table>`
        : `<div class="ui-state"><p class="ui-state__title">Nothing is in transit.</p><p class="ui-state__why">Move goods from a remote station's card above, and they will list here until they arrive.</p></div>`}
      </div>
    </section>`;

  // Transfer history, newest first (corp.logisticsHistory keeps the last 100).
  const history = Array.isArray(data.corp?.logisticsHistory) ? data.corp.logisticsHistory : [];
  const historyHtml = `
    <section id="logistics-history" class="ui-panel" aria-labelledby="logistics-history-title">
      <header class="ui-panel__header"><h3 id="logistics-history-title" class="ui-panel__title">Transfer History</h3></header>
      <div class="ui-panel__body">
      ${history.length
        ? `<table class="ui-table logistics__history">
            <thead><tr><th scope="col">Route</th><th scope="col">Goods</th><th scope="col" class="ui-table__num">Fee</th><th scope="col">When</th></tr></thead>
            <tbody>${history.map((h) => `<tr>
              <td data-label="Route">${escapeHtml(stationName(h.from))} → ${escapeHtml(stationName(h.to))}</td>
              <td data-label="Goods">${escapeHtml(describeLines(h.lines))}</td>
              <td class="ui-figure" data-label="Fee">${toCurrency(h.fee)}</td>
              <td data-label="When"><time datetime="${escapeHtml(new Date(h.time).toISOString())}">${escapeHtml(new Date(h.time).toLocaleString())}</time></td>
            </tr>`).join("")}</tbody></table>`
        : `<div class="ui-state"><p class="ui-state__title">No transfers yet.</p><p class="ui-state__why">Goods held at another station can be moved here from its card above.</p></div>`}
      </div>
    </section>`;

  contentEl.innerHTML = summary + `<div class="ui-grid logistics__stations">${cardsHtml}</div>` + inFlightHtml + historyHtml;

  const lineFor = (fromStation, item) => {
    const input = [...contentEl.querySelectorAll(".logistics__qty")]
      .find((el) => el.getAttribute("data-from-station") === fromStation && el.getAttribute("data-item") === item);
    // Sent as typed: the server refuses anything but a whole number of at least 1, and says so.
    return { item, quantity: input?.value ?? "" };
  };
  const picked = (fromStation) => [...contentEl.querySelectorAll(".logistics__pick")]
    .filter((box) => box.checked && box.getAttribute("data-from-station") === fromStation)
    .map((box) => lineFor(fromStation, box.getAttribute("data-item")));

  // Keep each card's bulk button and fee preview in step with what is picked.
  const refreshBulk = (fromStation) => {
    const btn = [...contentEl.querySelectorAll(".logistics__move-picked")].find((b) => b.getAttribute("data-from-station") === fromStation);
    const feeEl = [...contentEl.querySelectorAll(".logistics__bulk-fee")].find((b) => b.getAttribute("data-from-station") === fromStation);
    if (!btn || !feeEl) return;
    const lines = picked(fromStation);
    const units = lines.reduce((s, l) => s + Math.max(0, Math.floor(Number(l.quantity) || 0)), 0);
    btn.disabled = lines.length === 0;
    btn.textContent = lines.length ? `Move ${lines.length} picked → ${currentName}` : "Move picked items";
    const hops = hopsFrom(fromStation);
    const fee = rates && hops !== null ? (waived(fromStation, hops) ? "no fee (member, in system)" : `fee ${toCurrency(transferFee(rates, hops, [{ quantity: units }]))}`) : "fee quoted when you move";
    feeEl.textContent = lines.length
      ? `${units.toLocaleString()} units, ${fee}${lines.length > MAX_TRANSFER_LINES ? `. At most ${MAX_TRANSFER_LINES} items per transfer.` : ""}`
      : `Pick up to ${MAX_TRANSFER_LINES} items to move together.`;
  };
  const remember = (el) => {
    const key = `${el.getAttribute("data-from-station")}|${el.getAttribute("data-item")}`;
    draft[key] = { ...(draft[key] || {}), ...(el.type === "checkbox" ? { picked: el.checked } : { qty: el.value }) };
    refreshBulk(el.getAttribute("data-from-station"));
  };
  contentEl.querySelectorAll(".logistics__pick, .logistics__qty").forEach((el) => {
    el.addEventListener("input", () => remember(el));
    el.addEventListener("change", () => remember(el));
  });
  new Set([...contentEl.querySelectorAll(".logistics__move-picked")].map((b) => b.getAttribute("data-from-station"))).forEach(refreshBulk);

  const send = async (btn, fromStation, lines) => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Transferring…";
    try {
      const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/transfer-resources`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromStationId: fromStation, lines })
        }
      );
      const account = await parseJsonResponse(response);
      // AB#985: dispatch no longer delivers on the spot — the shipment arrives on a later tick, so the
      // confirmation names an ETA rather than claiming the goods already moved (corp.logisticsHistory gets its
      // entry on arrival, not here).
      const shipment = account.shipment;
      const etaMin = shipment ? Math.max(1, Math.round((shipment.arrivesAt - shipment.dispatchedAt) / 60_000)) : null;
      appState.logisticsStatus = { stationId: fromStation, tone: "ok", text: shipment
        ? `Dispatched ${describeLines(shipment.lines)} to ${currentName} for ${toCurrency(shipment.fee)} — arriving in ${etaMin} min.`
        : "Transfer dispatched." };
      for (const key of Object.keys(draft)) if (key.startsWith(`${fromStation}|`)) delete draft[key];
      appState.data = deepClone(account.state);
      appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
      updateAllViews();
      showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
      pushFeedback(appState.logisticsStatus.text, "success");
    } catch (err) {
      appState.logisticsStatus = { stationId: fromStation, tone: "error", text: err.message || "Transfer failed." };
      btn.textContent = original;
      renderLogistics(appState.data);
      pushFeedback(appState.logisticsStatus.text, "warn");
    }
  };

  contentEl.querySelectorAll(".logistics__move").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fromStation = btn.getAttribute("data-from-station");
      send(btn, fromStation, [lineFor(fromStation, btn.getAttribute("data-item"))]);
    });
  });
  contentEl.querySelectorAll(".logistics__move-picked").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fromStation = btn.getAttribute("data-from-station");
      send(btn, fromStation, picked(fromStation));
    });
  });
}
