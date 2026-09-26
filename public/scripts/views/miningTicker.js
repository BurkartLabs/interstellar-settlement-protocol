// The once-a-second ticker that moves the mining, refinery, R&D and logistics progress bars between server updates.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { formatDurationHours, toCurrency } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { appState } from "../state.js";
import { renderMissions } from "./assignments.js";
import { renderLogistics } from "./logistics.js";
import { renderExpeditionPanel } from "./overview.js";
import { renderRefinery } from "./refinery.js";
import { renderQueue } from "./research.js";
import { refreshFromServer, salvageRemainingMs } from "./shared.js";
import { activeCycleFigures, spentText } from "../leaseLive.js"; // AB#746
import { starmap } from "./starmap.js";
import { renderAssemblyFacility } from "./station.js";

export function isExtractorCycleActive(extractor, now = Date.now()) {
  const startedAt = Number(extractor?.startedAt || 0);
  const endsAt = Number(extractor?.endsAt || 0);
  if (!extractor?.active || !startedAt || !endsAt) {
    return false;
  }
  return now < endsAt;
}

export function stopMiningUiTicker() {
  if (appState.miningUiTicker) {
    clearInterval(appState.miningUiTicker);
    appState.miningUiTicker = null;
  }
}

export function startMiningUiTicker() {
  stopMiningUiTicker();
  let tickCount = 0;
  appState.miningUiTicker = setInterval(() => {
    if (!appState.authenticated || !appState.data) {
      return;
    }
    renderMiningCyclePanel(appState.data);
    renderQueue("rnd-queue", appState.data.queues?.corporateRnD || [], "Permanent corporate unlock track");
    renderQueue("ceo-queue", appState.data.queues?.ceoInsight || [], "CEO-centric growth track");

    // Re-render refinery active runs for live progress
    renderRefinery(appState.data);

    const buildingView = document.getElementById("station-building-view");
    const buildingTitle = document.querySelector("#station-building-content .station__building-header h2");
    if (buildingView && !buildingView.hidden && buildingTitle?.textContent === "Assembly Facility") {
      renderAssemblyFacility(appState.data);
    }

    // Live-update expedition progress bars
    renderExpeditionPanel(appState.data);

    // Live-update starmap belt detail panel expedition progress bars
    starmap.updateExpeditionProgress();

    // Live-update the shipments-in-transit countdown (ISP-279, AB#986)
    if (Array.isArray(appState.data.corp?.shipments) && appState.data.corp.shipments.length) {
      renderLogistics(appState.data);
    }

    // Live-update the Salvage Assignment countdown on its Assignments card (ISP-298, AB#1791). Once it elapses,
    // the whole list re-renders so the countdown becomes a Complete button — everything else here just edits text.
    let salvageElapsed = false;
    document.querySelectorAll("[data-salvage-countdown]").forEach((el) => {
      const mission = (appState.activeMissions || []).find((m) => m.id === el.getAttribute("data-salvage-countdown"));
      if (!mission) return;
      const remaining = salvageRemainingMs(mission);
      if (remaining <= 0) {
        salvageElapsed = true;
      } else {
        el.textContent = `${formatDurationHours(remaining)} remaining`;
      }
    });
    if (salvageElapsed) renderMissions(appState.data);

    // Live-update contract refresh timer
    const timerEl = document.getElementById("contract-refresh-timer");
    if (timerEl && !timerEl.hidden) {
      const nextRefresh = appState.data?.corp?.contractOfferings?.nextRefreshAt || 0;
      const remaining = nextRefresh - Date.now();
      if (remaining > 0) {
        const hrs = Math.floor(remaining / 3600000);
        const mins = Math.floor((remaining % 3600000) / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        timerEl.textContent = `New contracts in ${hrs}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
      } else {
        timerEl.textContent = "New contracts available — refresh to update";
      }
    }

    // Refresh from server every 60 seconds if any extractor or refinery is active
    tickCount += 1;
    if (tickCount % 60 === 0) {
      const hasActiveCycle = (appState.data?.corp?.mining?.silicateExtractors || []).some((ex) => ex.active);
      const hasActiveRefinery = (appState.data?.corp?.refineries || []).some((r) => r.active);
      const hasActiveExpedition = (appState.data?.corp?.asteroidMining?.activeExpeditions || []).length > 0;
      if (hasActiveCycle || hasActiveRefinery || hasActiveExpedition) {
        refreshFromServer();
      }
    }
  }, 1000);
}

export function renderMiningCyclePanel(data) {
  const list = document.getElementById("mine-cycle-list");
  if (!list) {
    return;
  }

  const extractors = data?.corp?.mining?.silicateExtractors || [];
  if (!extractors.length) {
    list.innerHTML = `<div class="ui-state"><p class="ui-state__title">No extractor yard records found.</p></div>`;
    return;
  }

  list.innerHTML = extractors
    .map((extractor) => {
      const active = isExtractorCycleActive(extractor);
      // AB#746: a running cycle shows what it has done so far, from the same figures as the lease view (leaseLive.js).
      const figures = active ? activeCycleFigures(extractor) : null;
      const remainingMs = active ? Math.max(0, Number(extractor.endsAt || 0) - Date.now()) : 0;
      const hours = active && extractor.startedAt && extractor.endsAt
        ? Math.max(1, Math.round((Number(extractor.endsAt) - Number(extractor.startedAt)) / (1000 * 60 * 60)))
        : 0;

      return `
        <article class="ui-card">
          <h4 class="ui-card__title">${escapeHtml(extractor.name || extractor.id || "Extractor Yard")}</h4>
          <p class="station__note">Status: ${active ? "Active" : "Idle"}</p>
          <p class="station__note">Total mined: ${Number(extractor.totalMined || 0).toLocaleString()} | Total spent: ${toCurrency(Number(extractor.totalSpent || 0))}</p>
          ${
            active
              ? `<p class="station__note">Running ${hours}h cycle. Remaining: ${formatDurationHours(remainingMs)} (${figures.pctText}).</p>
                 <div class="progress-wrap" role="progressbar" aria-label="${escapeHtml(`${extractor.name || "Extractor Yard"} cycle`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(figures.fill)}"><div class="progress-bar" style="width:${figures.fill.toFixed(2)}%"></div></div>
                 <dl class="cycle-figures">
                   <div><dt>Mined this cycle</dt><dd>${figures.mined.toLocaleString()} t</dd></div>
                   <div><dt>Spent this cycle</dt><dd>${escapeHtml(spentText(figures, toCurrency))}</dd></div>
                   <div><dt>Rate</dt><dd>${figures.rate.toLocaleString()} t/h</dd></div>
                 </dl>`
              : `<p class="station__note">Ready for next cycle.</p>`
          }
        </article>
      `;
    })
    .join("");
}
