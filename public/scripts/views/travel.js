// The Travel tab: destinations, the journey in progress and its timer.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone, formatDuration } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { appState } from "../state.js";
import { formatSystemLabel, isPlayerTraveling, pushFeedback, refreshFromServer, setTab, updateAllViews } from "./shared.js";

export function renderTravelPage(data) {
  const container = document.getElementById("travel-page");
  if (!container) return;

  const travel = data.corp?.travel;
  if (!travel || !travel.arrivesAt) {
    // Not traveling — check if player is in space (not docked)
    const stationId = data.corp?.currentStationId;
    const systemId = data.corp?.currentSystemId || "sol";
    if (!stationId) {
      // In space — show system arrival / docking options
      const systemStations = (appState.stationRegistry || []).filter(s => s.systemId === systemId);
      const stationButtons = systemStations.map(s =>
        `<button class="btn btn-accent travel-dock-btn" data-station-id="${escapeHtml(s.id)}" style="margin:0.3rem;">${escapeHtml(s.name)}<br><span class="muted" style="font-size:0.72rem;">${escapeHtml(s.body)} — ${escapeHtml(s.designation)}</span></button>`
      ).join("");

      container.innerHTML = `
        <div class="travel-page-outer">
          <div class="travel-page-card">
            <p class="overline travel-page-overline">NAVIGATION COMPUTER</p>
            <h2 class="travel-page-heading">In Open Space</h2>
            <p class="travel-system-label">${escapeHtml(formatSystemLabel(systemId))} System</p>
            <p class="muted" style="margin:1rem 0 1.5rem;font-size:0.85rem;">Your ship is in open space. Select a station to initiate docking approach.</p>
            <div class="travel-dock-options">${stationButtons || '<p class="muted">No stations found in this system.</p>'}</div>
          </div>
        </div>
      `;

      container.querySelectorAll(".travel-dock-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const sid = btn.getAttribute("data-station-id");
          if (!sid || !appState.accountId) return;
          try {
            const receiptTrigger = document.activeElement; // AB#744: focus goes back here when the receipt closes
            const response = await apiFetch(
              `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/travel`,
              { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toStationId: sid }) }
            );
            const account = await parseJsonResponse(response);
            appState.data = deepClone(account.state);
            appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
            updateAllViews();
            showActionReceipt(account, { returnFocusTo: receiptTrigger }); // AB#744: the server's receipt, only on success
            setTab("travel");
          } catch (err) {
            pushFeedback(err.message || "Docking request failed.", "warn");
          }
        });
      });

      clearTravelTimer();
      return;
    }

    container.innerHTML = `<p class="muted">You are not currently in transit.</p>`;
    clearTravelTimer();
    return;
  }

  const isInterstellar = travel.travelType === "interstellar";
  const remaining = Math.max(0, travel.arrivesAt - Date.now());

  let originHtml, destHtml, heading, overline;

  if (isInterstellar) {
    const fromLabel = formatSystemLabel(travel.fromSystemId);
    const toLabel = formatSystemLabel(travel.toSystemId);
    overline = "INTERSTELLAR NAVIGATION";
    heading = "Jump In Progress";
    originHtml = `
      <div class="travel-route-node">
        <span class="travel-route-label">Origin System</span>
        <span class="travel-route-station">${escapeHtml(fromLabel)}</span>
      </div>`;
    destHtml = `
      <div class="travel-route-node">
        <span class="travel-route-label">Destination System</span>
        <span class="travel-route-station">${escapeHtml(toLabel)}</span>
      </div>`;
  } else {
    const from = appState.stationRegistry.find((s) => s.id === travel.fromStationId);
    const dest = appState.stationRegistry.find((s) => s.id === travel.toStationId);
    overline = "NAVIGATION COMPUTER";
    heading = "Docking Approach";
    originHtml = `
      <div class="travel-route-node">
        <span class="travel-route-label">Origin</span>
        <span class="travel-route-station">${escapeHtml(from?.name || "Open Space")}</span>
        <span class="travel-route-body">${escapeHtml(from?.body || "—")}</span>
      </div>`;
    destHtml = `
      <div class="travel-route-node">
        <span class="travel-route-label">Destination</span>
        <span class="travel-route-station">${escapeHtml(dest?.name || travel.toStationId)}</span>
        <span class="travel-route-body">${escapeHtml(dest?.body || "—")}</span>
      </div>`;
  }

  container.innerHTML = `
    <div class="travel-page-outer">
      <div class="travel-page-card ${isInterstellar ? "travel-page-card--interstellar" : ""}">
        <p class="overline travel-page-overline">${overline}</p>
        <h2 class="travel-page-heading">${heading}</h2>

        <div class="travel-route">
          ${originHtml}
          <div class="travel-route-arrow">${isInterstellar ? "⟫" : "➔"}</div>
          ${destHtml}
        </div>

        <div class="travel-progress-bar travel-progress-bar--large">
          <div class="travel-progress-fill" id="travel-progress-fill"></div>
        </div>
        <p class="travel-eta" id="travel-eta">ETA: ${formatDuration(remaining)}</p>

        <p class="muted" style="margin-top:1.5rem;font-size:0.82rem;">
          ${isInterstellar
            ? "Interstellar jump drive engaged. All station services suspended until arrival."
            : "Station services suspended during docking approach. Comms and Starmap remain available."
          }
        </p>
      </div>
    </div>
  `;

  clearTravelTimer();
  appState._travelTimer = setInterval(() => updateTravelProgress(travel), 1000);
  updateTravelProgress(travel);
}

// ─── Travel time labels (must match server constants) ────────────────────────
export function travelTimeBetween(fromStation, toStation) {
  if (!fromStation || !toStation) return 0;
  if (fromStation.body === toStation.body) return 1 * 60 * 1000;
  if (fromStation.systemId === toStation.systemId) return 1 * 60 * 1000;
  return 1 * 60 * 1000;
}

export function clearTravelTimer() {
  if (appState._travelTimer) {
    clearInterval(appState._travelTimer);
    appState._travelTimer = null;
  }
}

export function updateTravelProgress(travel) {
  if (!travel || !travel.arrivesAt || !travel.departedAt) return;
  const now = Date.now();
  const total = travel.arrivesAt - travel.departedAt;
  const elapsed = now - travel.departedAt;
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const remaining = Math.max(0, travel.arrivesAt - now);

  const fill = document.getElementById("travel-progress-fill");
  const eta = document.getElementById("travel-eta");
  if (fill) fill.style.width = `${pct}%`;
  if (eta) eta.textContent = remaining > 0 ? `ETA: ${formatDuration(remaining)}` : "Arriving...";

  // If time is up, refresh from server to get the docked/arrived state
  if (remaining <= 0) {
    clearTravelTimer();
    refreshFromServer().then(() => {
      const activeTab = document.querySelector(".nav-tab.active");
      if (activeTab?.dataset?.tab === "travel") {
        // Check if server resolved the travel
        const stillTraveling = isPlayerTraveling(appState.data || {});
        if (stillTraveling) {
          // Server hasn't resolved yet — retry in 2 seconds
          appState._travelTimer = setTimeout(() => updateTravelProgress(travel), 2000);
          return;
        }
        // For interstellar arrival, stay on travel tab (shows docking options)
        // For local arrival, switch to station tab
        const isInSpace = !appState.data?.corp?.currentStationId;
        if (!isInSpace) {
          setTab("station");
        }
      }
    }).catch(() => {
      // Network error — retry in 3 seconds
      appState._travelTimer = setTimeout(() => updateTravelProgress(travel), 3000);
    });
  }
}
