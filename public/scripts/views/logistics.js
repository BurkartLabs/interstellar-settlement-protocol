// The Logistics tab: shipments between stations.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone, formatDuration, toCurrency } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { MAX_TRANSFER_LINES, describeHops, describeLines, feePerUnit, stationHops, transferFee, transitMinutes } from "../logistics.js";
import { appState } from "../state.js";
import { getAllInventory, getCurrentStationInfo, pushFeedback, stationLocationBanner, updateAllViews } from "./shared.js";

export function renderLogistics(data) {
  const station = getCurrentStationInfo(data);
  const bannerEl = document.getElementById("logistics-station-banner");
  if (bannerEl) bannerEl.innerHTML = stationLocationBanner(station);

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
  const hopsFrom = (fromStation) => stationHops(stationRegistry, fromStation, currentStationId);
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
    <div class="logistics-summary">
      <div class="logistics-summary-tile">
        <span class="logistics-summary-label">Docked at</span>
        <span class="logistics-summary-value">${escapeHtml(currentName)}</span>
      </div>
      <div class="logistics-summary-tile">
        <span class="logistics-summary-label">Remote units</span>
        <span class="logistics-summary-value">${totalRemoteUnits.toLocaleString()}</span>
      </div>
      <div class="logistics-summary-tile">
        <span class="logistics-summary-label">Transfer fee</span>
        <span class="logistics-summary-value">${rates ? `${toCurrency(rates.sameSystemFeePerUnit)} / unit in system, +${toCurrency(rates.perJumpFeePerUnit)} a jump` : "By distance"}</span>
      </div>
      <div class="logistics-summary-tile">
        <span class="logistics-summary-label">Credits</span>
        <span class="logistics-summary-value">${toCurrency(credits)}</span>
      </div>
    </div>`;

  // Build per-station cards. Current station uses an inventory list; remote stations use an item-row layout with a
  // pick box and quantity per item, a Move button per row, and one button that moves every picked row together.
  let cardsHtml = "";
  for (const st of stationRegistry) {
    const inv = allInventory[st.id] || {};
    const entries = Object.entries(inv).filter(([, qty]) => Number(qty) > 0);
    const isCurrent = st.id === currentStationId;
    const badge = isCurrent ? `<span class="logistics-current-badge">Docked</span>` : "";
    const subhead = `${escapeHtml(st.body || "")}${st.systemId ? ` · ${escapeHtml(String(st.systemId).toUpperCase())}` : ""}`;
    const hops = isCurrent ? null : hopsFrom(st.id);
    // ISP-279 (AB#986): the quote now names the arrival time too, not just the fee — a delay the player cannot
    // see before sending reads as goods going missing (D-0.5-1's third story, after AB#985's server-side transit).
    const routeFee = rates && hops !== null && entries.length
      ? `<p class="logistics-route-fee">Fee to ${escapeHtml(currentName)}: <strong>${toCurrency(feePerUnit(rates, hops))} per unit</strong>, <strong>${escapeHtml(formatDuration(transitMinutes(rates, hops) * 60_000))} transit</strong> <span class="muted">(${escapeHtml(describeHops(hops))})</span></p>`
      : "";

    let itemsHtml = "";
    if (!entries.length) {
      itemsHtml = `<p class="logistics-empty">No assets stored at this station.</p>`;
    } else if (isCurrent) {
      itemsHtml = `<ul class="logistics-item-list">` + entries
        .map(([item, qty]) => `<li class="logistics-item-row">
          <span class="logistics-item-name">${escapeHtml(item)}</span>
          <span class="logistics-item-qty">${Number(qty).toLocaleString()}</span>
        </li>`).join("") + `</ul>`;
    } else {
      itemsHtml = `<ul class="logistics-item-list">` + entries.map(([item, qty], index) => {
        const maxQty = Number(qty);
        const kept = draft[`${st.id}|${item}`] || {};
        const pickId = `logistics-pick-${escapeHtml(st.id)}-${index}`;
        return `<li class="logistics-item-row logistics-item-row--transfer">
          <input type="checkbox" id="${pickId}" class="logistics-pick" data-from-station="${escapeHtml(st.id)}" data-item="${escapeHtml(item)}"${kept.picked ? " checked" : ""} />
          <label class="logistics-item-meta" for="${pickId}">
            <span class="logistics-item-name">${escapeHtml(item)}</span>
            <span class="logistics-item-qty muted">${maxQty.toLocaleString()} avail</span>
          </label>
          <div class="logistics-transfer-controls">
            <input type="number" class="logistics-qty-input" min="1" step="1" max="${maxQty}" value="${escapeHtml(kept.qty ?? maxQty)}"
              data-from-station="${escapeHtml(st.id)}" data-item="${escapeHtml(item)}" aria-label="Quantity of ${escapeHtml(item)} to move" />
            <button class="btn btn-outline btn-sm logistics-transfer-btn" type="button"
              data-from-station="${escapeHtml(st.id)}" data-item="${escapeHtml(item)}">
              Move → ${escapeHtml(currentName)}
            </button>
          </div>
        </li>`;
      }).join("") + `</ul>
        <div class="logistics-bulk">
          <button class="btn btn-accent btn-sm logistics-bulk-btn" type="button" data-from-station="${escapeHtml(st.id)}" disabled>Move picked items</button>
          <span class="logistics-bulk-fee muted" data-from-station="${escapeHtml(st.id)}">Pick up to ${MAX_TRANSFER_LINES} items to move together.</span>
        </div>`;
    }
    const cardStatus = status && status.stationId === st.id
      ? `<p class="logistics-status logistics-status--${status.tone === "ok" ? "ok" : "error"}" role="${status.tone === "ok" ? "status" : "alert"}">${escapeHtml(status.text)}</p>`
      : "";

    cardsHtml += `
      <section class="logistics-station-card ${isCurrent ? "logistics-station-card--current" : ""}">
        <header class="logistics-station-header">
          <div class="logistics-station-title">
            <h3>${escapeHtml(st.name)}</h3>
            ${badge}
          </div>
          <span class="logistics-station-sub muted">${subhead}</span>
        </header>
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
    <section class="form-card logistics-in-flight">
      <h3>Shipments In Transit</h3>
      ${shipments.length
        ? `<ol class="logistics-in-flight-list">${shipments.map((s) => {
            const remainingMs = Math.max(0, (s.arrivesAt || 0) - Date.now());
            const eta = s.status === "held"
              ? `<span class="logistics-in-flight-held">Held — destination unreachable</span>`
              : `<span class="logistics-in-flight-eta" data-arrives-at="${escapeHtml(String(s.arrivesAt || 0))}">${remainingMs > 0 ? escapeHtml(formatDuration(remainingMs)) : "Arriving"}</span>`;
            return `<li class="logistics-in-flight-item${s.status === "held" ? " logistics-in-flight-item--held" : ""}">
              <span class="logistics-in-flight-route">${escapeHtml(stationName(s.fromStationId))} → ${escapeHtml(stationName(s.toStationId))}</span>
              <span class="logistics-in-flight-fee">${toCurrency(s.fee)}</span>
              <span class="logistics-in-flight-lines">${escapeHtml(describeLines(s.lines))}</span>
              ${eta}
            </li>`;
          }).join("")}</ol>`
        : `<p class="muted">Nothing is in transit. Move goods from a remote station's card above, and they will list here until they arrive.</p>`}
    </section>`;

  // Transfer history, newest first (corp.logisticsHistory keeps the last 100).
  const history = Array.isArray(data.corp?.logisticsHistory) ? data.corp.logisticsHistory : [];
  const historyHtml = `
    <section class="form-card logistics-history">
      <h3>Transfer History</h3>
      ${history.length
        ? `<ol class="logistics-history-list">${history.map((h) => `<li class="logistics-history-item">
              <span class="logistics-history-route">${escapeHtml(stationName(h.from))} → ${escapeHtml(stationName(h.to))}</span>
              <span class="logistics-history-fee">${toCurrency(h.fee)}</span>
              <span class="logistics-history-lines">${escapeHtml(describeLines(h.lines))}</span>
              <time class="logistics-history-time muted" datetime="${escapeHtml(new Date(h.time).toISOString())}">${escapeHtml(new Date(h.time).toLocaleString())}</time>
            </li>`).join("")}</ol>`
        : `<p class="muted">No transfers yet. Goods held at another station can be moved here from its card above.</p>`}
    </section>`;

  contentEl.innerHTML = summary + `<div class="logistics-grid">${cardsHtml}</div>` + inFlightHtml + historyHtml;

  const lineFor = (fromStation, item) => {
    const input = [...contentEl.querySelectorAll(".logistics-qty-input")]
      .find((el) => el.getAttribute("data-from-station") === fromStation && el.getAttribute("data-item") === item);
    // Sent as typed: the server refuses anything but a whole number of at least 1, and says so.
    return { item, quantity: input?.value ?? "" };
  };
  const picked = (fromStation) => [...contentEl.querySelectorAll(".logistics-pick")]
    .filter((box) => box.checked && box.getAttribute("data-from-station") === fromStation)
    .map((box) => lineFor(fromStation, box.getAttribute("data-item")));

  // Keep each card's bulk button and fee preview in step with what is picked.
  const refreshBulk = (fromStation) => {
    const btn = [...contentEl.querySelectorAll(".logistics-bulk-btn")].find((b) => b.getAttribute("data-from-station") === fromStation);
    const feeEl = [...contentEl.querySelectorAll(".logistics-bulk-fee")].find((b) => b.getAttribute("data-from-station") === fromStation);
    if (!btn || !feeEl) return;
    const lines = picked(fromStation);
    const units = lines.reduce((s, l) => s + Math.max(0, Math.floor(Number(l.quantity) || 0)), 0);
    btn.disabled = lines.length === 0;
    btn.textContent = lines.length ? `Move ${lines.length} picked → ${currentName}` : "Move picked items";
    const hops = hopsFrom(fromStation);
    const fee = rates && hops !== null ? `fee ${toCurrency(transferFee(rates, hops, [{ quantity: units }]))}` : "fee quoted when you move";
    feeEl.textContent = lines.length
      ? `${units.toLocaleString()} units, ${fee}${lines.length > MAX_TRANSFER_LINES ? `. At most ${MAX_TRANSFER_LINES} items per transfer.` : ""}`
      : `Pick up to ${MAX_TRANSFER_LINES} items to move together.`;
  };
  const remember = (el) => {
    const key = `${el.getAttribute("data-from-station")}|${el.getAttribute("data-item")}`;
    draft[key] = { ...(draft[key] || {}), ...(el.type === "checkbox" ? { picked: el.checked } : { qty: el.value }) };
    refreshBulk(el.getAttribute("data-from-station"));
  };
  contentEl.querySelectorAll(".logistics-pick, .logistics-qty-input").forEach((el) => {
    el.addEventListener("input", () => remember(el));
    el.addEventListener("change", () => remember(el));
  });
  new Set([...contentEl.querySelectorAll(".logistics-bulk-btn")].map((b) => b.getAttribute("data-from-station"))).forEach(refreshBulk);

  const send = async (btn, fromStation, lines) => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Transferring…";
    try {
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
      pushFeedback(appState.logisticsStatus.text, "success");
    } catch (err) {
      appState.logisticsStatus = { stationId: fromStation, tone: "error", text: err.message || "Transfer failed." };
      btn.textContent = original;
      renderLogistics(appState.data);
      pushFeedback(appState.logisticsStatus.text, "warn");
    }
  };

  contentEl.querySelectorAll(".logistics-transfer-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fromStation = btn.getAttribute("data-from-station");
      send(btn, fromStation, [lineFor(fromStation, btn.getAttribute("data-item"))]);
    });
  });
  contentEl.querySelectorAll(".logistics-bulk-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fromStation = btn.getAttribute("data-from-station");
      send(btn, fromStation, picked(fromStation));
    });
  });
}
