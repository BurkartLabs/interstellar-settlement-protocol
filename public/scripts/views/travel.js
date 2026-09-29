// The Travel tab: destinations, the journey in progress and its timer.
// AB#739 (ISP-53): everything here moved from app.js unchanged. ISP-83 (AB#772): drawn from the design system.

/** The screen's header: the computer's line over the heading, and what it means for the player. */
function travelHeader(overline, heading, lede, protocol = null) {
  return `<header class="ui-screen__header">
      <p class="travel__overline">${escapeHtml(overline)}</p>
      <h2 class="ui-screen__title">${codeSlotHtml("travel")}${escapeHtml(heading)}</h2>
      ${lede ? `<p class="ui-screen__lede">${escapeHtml(lede)}${protocol ? ` ${protocolLineHtml(protocol)}` : ""}</p>` : ""}
    </header>`;
}

import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone, formatDuration } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { appState } from "../state.js";
import { formatSystemLabel, isPlayerTraveling, pushFeedback, refreshFromServer, setTab, updateAllViews } from "./shared.js";
import { codeSlotHtml } from "../sectionCodes.js"; // ISP-248 (AB#944)
import { protocolLineHtml, refusalMeaning } from "../protocol.js"; // ISP-255 (AB#4831)

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
        `<button class="ui-card ui-card--interactive" data-role="travel-dock" type="button" data-station-id="${escapeHtml(s.id)}">
          <span class="ui-card__title">${escapeHtml(s.name)}</span>
          <span class="ui-card__meta">${escapeHtml(s.body)} — ${escapeHtml(s.designation)}</span>
        </button>`
      ).join("");

      container.innerHTML = `
        ${travelHeader("Navigation computer", "In Open Space", `${formatSystemLabel(systemId)} System. Your ship is in open space. Select a station to initiate docking approach.`)}
        ${stationButtons
          ? `<div class="ui-grid">${stationButtons}</div>`
          : `<div class="ui-state"><p class="ui-state__title">No stations found in this system.</p></div>`}
      `;

      container.querySelectorAll("[data-role=travel-dock]").forEach(btn => {
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
            pushFeedback(err.message || "Docking request failed.", "warn", { meaning: refusalMeaning(err), screen: "travel" }); // ISP-255 (AB#4831)
          }
        });
      });

      clearTravelTimer();
      return;
    }

    container.innerHTML = `${travelHeader("Navigation computer", "Travel")}<div class="ui-state"><p class="ui-state__title">You are not currently in transit.</p></div>`;
    clearTravelTimer();
    return;
  }

  const isInterstellar = travel.travelType === "interstellar";
  const remaining = Math.max(0, travel.arrivesAt - Date.now());

  let origin, dest, heading, overline;
  if (isInterstellar) {
    overline = "Interstellar navigation";
    heading = "Jump In Progress";
    origin = { label: "Origin System", name: formatSystemLabel(travel.fromSystemId) };
    dest = { label: "Destination System", name: formatSystemLabel(travel.toSystemId) };
  } else {
    const from = appState.stationRegistry.find((s) => s.id === travel.fromStationId);
    const to = appState.stationRegistry.find((s) => s.id === travel.toStationId);
    overline = "Navigation computer";
    heading = "Docking Approach";
    origin = { label: "Origin", name: from?.name || "Open Space", body: from?.body || "—" };
    dest = { label: "Destination", name: to?.name || travel.toStationId, body: to?.body || "—" };
  }
  const node = (n) => `<section class="ui-card" data-role="travel-node">
      <p class="ui-card__meta">${escapeHtml(n.label)}</p>
      <p class="ui-card__title">${escapeHtml(n.name)}</p>
      ${n.body ? `<p class="ui-card__meta">${escapeHtml(n.body)}</p>` : ""}
    </section>`;

  container.innerHTML = `
    ${travelHeader(overline, heading, isInterstellar
      ? "Interstellar jump drive engaged. All station services suspended until arrival."
      : "Station services suspended during docking approach. Chat and Starmap remain available.", { meaning: "active", screen: "travel" })}
    <section class="ui-panel" aria-label="Journey">
      <div class="ui-panel__body ui-stack">
        <div class="travel__route">
          ${node(origin)}
          <span class="travel__arrow" aria-hidden="true">${isInterstellar ? "⟫" : "→"}</span>
          ${node(dest)}
        </div>
        <div class="progress-wrap" id="travel-progress" role="progressbar" aria-label="Journey" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-bar" id="travel-progress-fill"></div></div>
        <p class="ui-figure travel__eta" id="travel-eta">ETA: ${formatDuration(remaining)}</p>
      </div>
    </section>
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
  document.getElementById("travel-progress")?.setAttribute("aria-valuenow", String(Math.round(pct)));
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
