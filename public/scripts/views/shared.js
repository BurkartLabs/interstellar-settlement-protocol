// The pieces more than one tab uses: inventory reads, the feedback log, the station banner, the trade confirmation,
// and the app.js functions a tab calls back into (updateAllViews, setTab...), forwarded once app.js connects them.
// AB#739 (ISP-53): apart from the forwarders, everything here moved from app.js unchanged.

import { revealScroll } from "../firstAction.js";
import { formatTime } from "../helpers.js";
import { escapeHtml, tradeConfirmRowsHtml } from "../html.js";
import { appState } from "../state.js";
import { systemName } from "../displayNames.js"; // AB#1336

// app.js owns these; it hands them over before anything renders (connectViews, called at the top of app.js).
let app = null;
export function connectViews(implementation) {
  app = implementation;
}
export function updateAllViews(...args) {
  return app.updateAllViews(...args);
}
export function setTab(...args) {
  return app.setTab(...args);
}
export function refreshFromServer(...args) {
  return app.refreshFromServer(...args);
}
export function showAuthScreen(...args) {
  return app.showAuthScreen(...args);
}

// ─── Trade confirmation modal ────────────────────────────────────────────────
export function showTradeConfirmation({ heading, title, rows, confirmLabel = "Confirm" }) {
  const modal = document.getElementById("trade-confirm-modal");
  const headingEl = document.getElementById("trade-confirm-heading");
  const titleEl = document.getElementById("trade-confirm-title");
  const bodyEl = document.getElementById("trade-confirm-body");
  const okBtn = document.getElementById("trade-confirm-ok");
  const cancelBtn = document.getElementById("trade-confirm-cancel");

  headingEl.textContent = heading || "Order Confirmation";
  titleEl.textContent = title || "Confirm Trade";
  okBtn.textContent = confirmLabel;

  bodyEl.innerHTML = `<table class="trade-confirm-table"><tbody>${tradeConfirmRowsHtml(rows)}</tbody></table>`;

  modal.hidden = false;

  return new Promise((resolve) => {
    function cleanup() {
      modal.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
    }
    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }
    function onBackdrop(e) { if (e.target === modal) { cleanup(); resolve(false); } }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
  });
}

export function pushFeedback(message, tone = "info") {
  appState.feedbackLog.unshift({
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    tone,
    createdAt: Date.now()
  });
  appState.feedbackLog = appState.feedbackLog.slice(0, 8);
  renderFeedbackLog();
}

export function flashButtonSuccess(button) {
  if (!button) return;
  button.classList.remove("btn-pulse-success");
  void button.offsetWidth; // force reflow to restart animation
  button.classList.add("btn-pulse-success");
  setTimeout(() => button.classList.remove("btn-pulse-success"), 800);
}

export function renderFeedbackLog() {
  const feedbackLog = document.getElementById("feedback-log");
  if (!feedbackLog) {
    return;
  }

  if (!appState.feedbackLog.length) {
    feedbackLog.innerHTML = "<li>Command uplink standing by. Completed actions and queue additions will be logged here.</li>";
    return;
  }

  feedbackLog.innerHTML = appState.feedbackLog
    .map((entry) => `<li class="ui-list__item ui-list__item--${entry.tone}"><strong>${formatTime(entry.createdAt)}</strong> | ${entry.message}</li>`)
    .join("");
}

export function getInventory() {
  if (!appState.data?.corp?.inventory) {
    appState.data.corp.inventory = {};
  }
  const stationId = appState.data.corp.currentStationId || "earth-station-prime";
  if (!appState.data.corp.inventory[stationId]) {
    appState.data.corp.inventory[stationId] = {};
  }
  return appState.data.corp.inventory[stationId];
}

/** Get full per-station inventory map */
export function getAllInventory() {
  if (!appState.data?.corp?.inventory) {
    appState.data.corp.inventory = {};
  }
  return appState.data.corp.inventory;
}

export function getCurrentStationInfo(data) {
  const corp = data.corp || {};
  const stationId = corp.currentStationId || "earth-station-prime";
  const station = appState.stationRegistry.find((s) => s.id === stationId) || appState.stationRegistry[0];
  return station;
}

export function stationLocationBanner(station) {
  if (!station) return "";
  return `<div class="station-location-banner">
    <span class="station-location-icon">&#9670;</span>
    <span class="station-location-text">Docked at <strong>${escapeHtml(station.name)}</strong> &mdash; ${escapeHtml(station.body)}, ${escapeHtml(formatSystemLabel(station.systemId || "sol"))}</span>
  </div>`;
}

export function isPlayerTraveling(data) {
  const travel = data?.corp?.travel;
  return Boolean(travel && travel.arrivesAt);
}

// AB#1336: the catalog's name ("Barnard's Star"); title-casing the id is only for a system the catalog lacks.
export function formatSystemLabel(systemId) {
  return systemName(appState.data?.world?.systems, systemId)
    || (systemId || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function cycleProgressPercent(extractor) {
  const startedAt = Number(extractor?.startedAt || 0);
  const endsAt = Number(extractor?.endsAt || 0);
  if (!startedAt || !endsAt || endsAt <= startedAt) {
    return 0;
  }
  const now = Date.now();
  const elapsed = Math.max(0, now - startedAt);
  const total = Math.max(1, endsAt - startedAt);
  return Math.max(0, Math.min(100, (elapsed / total) * 100));
}

// ISP-298 (AB#1791): the Salvage Assignment (server/game/corporation.js) is paid in time served, not a
// delivered quota, so it has no progress bar to read from inventory — only a clock, read from the same
// acceptedAt/hoursRequired the server checks (server/index.js complete-mission, "time-served" branch).
export function salvageRemainingMs(mission, now = Date.now()) {
  const requiredMs = Number(mission?.hoursRequired || 0) * 3_600_000;
  const elapsedMs = now - Number(mission?.acceptedAt || 0);
  return requiredMs - elapsedMs;
}

/** Scroll `el` to just under the pinned header when it is not already in view below it (AB#1056). */
export function revealUnderHeader(el) {
  if (!el) return;
  const headerBottom = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
  const delta = revealScroll(el.getBoundingClientRect().top, headerBottom, window.innerHeight);
  if (delta) window.scrollBy(0, delta);
}
