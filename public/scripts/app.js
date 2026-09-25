import { tradeNumbers } from "./exchangeView.js"; // AB#1164, on a line of its own away from the imports other branches add
import { stationBuildingCardsHtml } from "./html.js";
import { renderFinanceCharts, bindChartDurationPickers } from "./charts.js";
import { suggestedListingPrice } from "./suggestedPrice.js"; // AB#1166, on a line of its own away from other branches' imports
import { miningProjection, bestThroughput, costPerHourFor, startupCostFor as clientStartupCostFor } from "./miningProjection.js"; // ISP-86, on a line of its own
import { ASSIGNED_COORDINATOR, COORDINATOR_BYLINE } from "./liaison.js";
import { bindOnce, likeRequest, postFor, replyDraft, quoteDraft, mergeThread } from "./forumActions.js";
import { createStarmapController } from "./starmap.js";
import { escapeHtml, notificationItemsHtml, messageListItemsHtml, forumPostBodyHtml } from "./html.js";
import { DEFAULT_EXCHANGE_VIEW, loadExchangeView, saveExchangeView, viewOrders, filteredEmptyHtml } from "./exchangeView.js";
import { stationStartPromptHtml, milestonesFirst, sidebarStartsCollapsed, revealScroll } from "./firstAction.js"; // AB#1056
import { labelTableCells } from "./tableLabels.js"; // AB#1055
import { isInsightProgramLive, officeRenewalCost } from "./ceoEffects.js";
import { officeLeaseCost, OFFICE_TERMS_DAYS } from "./ceoEffects.js";
import { missionRewardCredits } from "./ceoEffects.js"; // Bug #1009: its own line, after the others, so parallel branches adding imports do not collide
import { requirementLink } from "./levelLinks.js"; // AB#1061
// AB#738 (ISP-52): the shared pieces app.js used to define itself.
import { viewerStorage, appState, IS_DEV_ACCESS, techTree } from "./state.js";
import { connectApiClient, socket, reauthenticateSocket, persistSession, clearSession, redirectToLoginPage, handleSessionExpired, createInvalidSessionError, hydrateSession, refreshSessionToken, apiFetch, parseJsonResponse } from "./apiClient.js";
import { toCurrency, deepClone, formatTime, formatDuration, fmtCredits, fmtSignedCredits, fmtTimestamp, prettifyLedgerLabel, formatDurationHours, formatInboxDate } from "./helpers.js";
import { runIntroDialogue } from "./dialogue.js";
import { connectWalkthroughUi, bindWalkthroughControls, hasSeenWalkthroughOffer, noteWalkthroughEvent, promptWalkthroughOffer, resetWalkthroughForAccount } from "./walkthroughUi.js";

// The moved modules call back into the game screen app.js owns; hand them what they need before anything runs.
connectApiClient({ stopMiningUiTicker, showAuthScreen });
connectWalkthroughUi({ updateAllViews, setTab });



// ------------- ELEMENTS ------------- //
const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const authShell = document.getElementById("auth-shell");
const gameShell = document.getElementById("game-shell");
const replayOnboardingButton = document.getElementById("replay-onboarding-btn");
const notificationToggleButton = document.getElementById("notification-toggle");
const notificationCount = document.getElementById("notification-count");
const notificationPanel = document.getElementById("notification-panel");
const notificationList = document.getElementById("notification-list");
const notificationReadAllButton = document.getElementById("notification-read-all");



const starmap = createStarmapController({
  canvas: document.getElementById("starmap-canvas"),
  fallbackEl: document.getElementById("starmap-fallback"),
  detailsEl: document.getElementById("map-details"),
  overlaySelect: document.getElementById("map-overlay"),
  resetButton: document.getElementById("map-reset"),
  researchCatalog: techTree, // Bug #1270: the lock names the research a jump needs
  getCorpLevel: () => appState.data?.corp?.level || 0,
  async onTravelToSystem(systemId) {
    if (!appState.accountId) return;
    try {
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/travel`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toSystemId: systemId }) }
      );
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
      updateAllViews();
      setTab("travel");
    } catch (err) {
      pushFeedback(err.message || "Interstellar travel request failed.", "warn");
    }
  },
  async onDockAtStation(stationId) {
    if (!appState.accountId) return;
    try {
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/travel`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toStationId: stationId }) }
      );
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
      updateAllViews();
      setTab("travel");
    } catch (err) {
      pushFeedback(err.message || "Docking request failed.", "warn");
    }
  },
  async onScoutBelt(systemId, bodyId, beltKey) {
    if (!appState.accountId) return;
    try {
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/scout-belt`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beltKey }) }
      );
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      await refreshBeltCompositions();
      updateAllViews();
      pushFeedback(beltScoutedText(beltKey, appState.data?.world?.systems), "ok"); // AB#1257: names, not "sol:belt"
    } catch (err) {
      pushFeedback(err.message || "Belt scouting failed.", "warn");
    }
  },
  async onLaunchExpedition(beltKey, duration) {
    if (!appState.accountId) return;
    try {
      const response = await apiFetch(
        `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/launch-expedition`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beltKey, duration }) }
      );
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      updateAllViews();
      pushFeedback("Mining expedition launched!", "ok");
    } catch (err) {
      pushFeedback(err.message || "Expedition launch failed.", "warn");
    }
  }
});





import { starmapMiningState } from "./beltCompositions.js"; // Bug #1264 (placed here, apart from the imports at the top that parallel PRs edit)

// TODO(AB#1050): Ensure this function is updated when we make asteroid belts dynamic
async function refreshBeltCompositions() {
  if (!appState.accountId) return;
  try {
    const res = await apiFetch(
      `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/belt-compositions`
    );
    const data = await parseJsonResponse(res);
    appState.beltCompositions = data.compositions || {};
  } catch (_) { /* silent */ }
}

/** Bug #1264: fetch the revealed compositions and hand them to the Starmap when they land (it redraws an open belt
 * panel). Called on every entry into the game (enterGame: log in, register, restore after a reload) and on refresh;
 * before, a reload never fetched them, so a scouted belt showed neither its composition nor a Scout button. */
function loadBeltCompositionsIntoStarmap() {
  return refreshBeltCompositions().then(() => starmap.setAsteroidMining(starmapMiningState(appState.data, appState.beltCompositions)));
}

import { tradeConfirmRowsHtml, queueItemsHtml } from "./html.js"; // Bug #1002
import { scheduleRndQueue, nextRndStart, rndItemStatus, formatHoursMinutes } from "./rndQueue.js"; // Bug #1258

// ─── Trade confirmation modal ────────────────────────────────────────────────
function getClientExchangeTaxPct() {
  return Number(appState.data?.corp?.finances?.exchangeSalesTaxPct ?? 8);
}

function showTradeConfirmation({ heading, title, rows, confirmLabel = "Confirm" }) {
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

function getTechNode(techId) {
  return techTree.find((item) => item.id === techId) || null;
}

function pushFeedback(message, tone = "info") {
  appState.feedbackLog.unshift({
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    tone,
    createdAt: Date.now()
  });
  appState.feedbackLog = appState.feedbackLog.slice(0, 8);
  renderFeedbackLog();
}

function flashButtonSuccess(button) {
  if (!button) return;
  button.classList.remove("btn-pulse-success");
  void button.offsetWidth; // force reflow to restart animation
  button.classList.add("btn-pulse-success");
  setTimeout(() => button.classList.remove("btn-pulse-success"), 800);
}

function bindRippleEffect() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".btn");
    if (!button || button.disabled) return;
    const ripple = document.createElement("span");
    ripple.className = "btn-ripple-effect";
    const rect = button.getBoundingClientRect();
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
}

function bindCollapsibleSections() {
  // AB#1056: at phone width the sidebar filled the first screen, so it starts collapsed there; its toggles still open it
  if (sidebarStartsCollapsed(window.innerWidth)) {
    document.querySelectorAll(".side-panel .section-toggle").forEach((button) => {
      const content = document.getElementById(button.getAttribute("aria-controls") || "");
      if (!content) return;
      button.setAttribute("aria-expanded", "false");
      content.hidden = true;
    });
  }
  document.querySelectorAll(".section-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const controlsId = button.getAttribute("aria-controls");
      const content = controlsId ? document.getElementById(controlsId) : null;
      if (!content) {
        return;
      }

      const isExpanded = button.getAttribute("aria-expanded") !== "false";
      button.setAttribute("aria-expanded", String(!isExpanded));
      content.hidden = isExpanded;
    });
  });
}

function renderFeedbackLog() {
  const feedbackLog = document.getElementById("feedback-log");
  if (!feedbackLog) {
    return;
  }

  if (!appState.feedbackLog.length) {
    feedbackLog.innerHTML = "<li>Command uplink standing by. Completed actions and queue additions will be logged here.</li>";
    return;
  }

  feedbackLog.innerHTML = appState.feedbackLog
    .map((entry) => `<li class="feedback-${entry.tone}"><strong>${formatTime(entry.createdAt)}</strong> | ${entry.message}</li>`)
    .join("");
}

function renderNotifications() {
  if (!notificationList || !notificationCount) {
    return;
  }

  notificationCount.textContent = String(appState.unreadNotifications || 0);

  if (!appState.notifications.length) {
    notificationList.innerHTML = "<li class=\"notification-item\">No notifications yet.</li>";
    return;
  }

  // Bug #691: every field escaped (public/scripts/html.js, tested in tests/unit/html.test.js).
  notificationList.innerHTML = notificationItemsHtml(appState.notifications.slice(0, 30), formatTime);
}

async function loadNotifications() {
  if (!appState.accountId) {
    appState.notifications = [];
    appState.unreadNotifications = 0;
    renderNotifications();
    return;
  }

  const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/notifications`);
  if (!response.ok) {
    return;
  }

  const payload = await response.json();
  appState.notifications = payload.notifications || [];
  appState.unreadNotifications = Number(payload.unreadCount || 0);
  renderNotifications();
}





function getInventory() {
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
function getAllInventory() {
  if (!appState.data?.corp?.inventory) {
    appState.data.corp.inventory = {};
  }
  return appState.data.corp.inventory;
}

function availableTechNodes(data) {
  const done = new Set(data.corp.unlockedTech || []);
  const inQueue = new Set((data.queues.corporateRnD || []).map((item) => item.techId).filter(Boolean));
  const tier1Ids = techTree.filter((n) => n.tier === 1).map((n) => n.id);
  const allTier1Done = tier1Ids.every((id) => done.has(id));

  return techTree.filter((node) => {
    if (done.has(node.id) || inQueue.has(node.id)) return false;
    if (!node.prereqs.every((req) => done.has(req))) return false;
    if (node.tier >= 2 && !allTier1Done) return false;
    return true;
  });
}

function renderTechTree(data) {
  const treeWrap = document.getElementById("rnd-tech-tree");
  const done = new Set(data.corp.unlockedTech || []);
  const inQueue = new Set((data.queues.corporateRnD || []).map((item) => item.techId).filter(Boolean));

  // Still populate the ghost #rnd-select so the existing submit handler can read it
  const select = document.getElementById("rnd-select");
  const options = availableTechNodes(data);
  if (!options.length) {
    select.innerHTML = '<option value="">No available research nodes</option>';
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = options.map((node) => `<option value="${node.id}">${node.name}</option>`).join("");
  }

  // Render tech rows grouped by tier, then by status
  const tier1Ids = techTree.filter((n) => n.tier === 1).map((n) => n.id);
  const allTier1Done = tier1Ids.every((id) => done.has(id));

  const rows = techTree
    .map((node) => {
      const prereqLabel = node.prereqs.length ? node.prereqs.map((id) => techTree.find((it) => it.id === id)?.name || id).join(", ") : "None";
      const isDone = done.has(node.id);
      const isQueued = inQueue.has(node.id);
      const prereqsMet = node.prereqs.every((req) => done.has(req));
      const tierGated = node.tier >= 2 && !allTier1Done;
      const isLocked = !prereqsMet || tierGated;

      if (isDone) {
        return `<div class="rnd-row rnd-row--done">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(node.name)}</span>
            <span class="rnd-row__effect">${escapeHtml(node.effect)}</span>
          </div>
          <span class="rnd-row__badge rnd-row__badge--done">✓ COMPLETE</span>
        </div>`;
      }

      if (isQueued) {
        return `<div class="rnd-row rnd-row--queued">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(node.name)}</span>
            <span class="rnd-row__effect">${escapeHtml(node.effect)}</span>
            <span class="rnd-row__meta">${node.durationHours}h &middot; ${toCurrency(node.costCredits)}</span>
          </div>
          <span class="rnd-row__badge rnd-row__badge--queued">IN QUEUE</span>
        </div>`;
      }

      if (isLocked) {
        const lockReason = tierGated
          ? "Complete all Tier 1 research first"
          : `Requires: ${escapeHtml(prereqLabel)}`;
        return `<div class="rnd-row rnd-row--locked">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(node.name)} <span class="rnd-tier-badge">T${node.tier}</span></span>
            <span class="rnd-row__effect">${escapeHtml(node.effect)}</span>
            <span class="rnd-row__meta">${lockReason}</span>
          </div>
          <span class="rnd-row__badge rnd-row__badge--locked">LOCKED</span>
        </div>`;
      }

      // Available — show enqueue button
      return `<div class="rnd-row rnd-row--available">
        <div class="rnd-row__info">
          <span class="rnd-row__name">${escapeHtml(node.name)} <span class="rnd-tier-badge">T${node.tier}</span></span>
          <span class="rnd-row__effect">${escapeHtml(node.effect)}</span>
          <span class="rnd-row__meta">${node.durationHours}h &middot; ${toCurrency(node.costCredits)} &middot; Prereqs: ${escapeHtml(prereqLabel)}</span>
        </div>
        <button class="btn btn-accent rnd-enqueue-btn" type="button" data-tech-id="${node.id}">+ Enqueue</button>
      </div>`;
    })
    .join("");

  treeWrap.innerHTML = rows || '<p class="muted">No research nodes configured.</p>';

  // Event delegation — reassignment avoids listener stacking across re-renders
  treeWrap.onclick = (e) => {
    const btn = e.target.closest(".rnd-enqueue-btn");
    if (!btn) return;
    const techId = btn.getAttribute("data-tech-id");
    const rndSelect = document.getElementById("rnd-select");
    const rndForm = document.getElementById("rnd-form");
    if (!rndSelect || !rndForm || !techId) return;
    rndSelect.value = techId;
    rndForm.requestSubmit();
  };

  renderResearchSelectionDetails(data);
}

function renderInsightTree(data) {
  const treeWrap = document.getElementById("ceo-insight-tree");
  if (!treeWrap) return;

  const completed = data.corp.completedInsights || [];
  const queue = data.queues?.ceoInsight || [];
  const queuedIds = queue.map((item) => item.programId).filter(Boolean);

  const programs = appState.insightPrograms;
  const rows = programs
    .map((prog) => {
      const completionCount = completed.filter((id) => id === prog.id).length;
      const queuedCount = queuedIds.filter((id) => id === prog.id).length;
      const maxLevels = prog.maxLevels || 1;
      const isDone = completionCount >= maxLevels;
      const isQueued = queuedCount > 0 && (completionCount + queuedCount >= maxLevels);
      const isLocked = !prog.prereqs.every((req) => completed.includes(req));
      // Bug #983: a planned program has no effect yet; the server refuses it, so it is shown but not offered.
      const isPlanned = !isInsightProgramLive(prog);
      const plannedNote = isPlanned ? `<span class="rnd-row__meta">No effect yet: planned for a later version.</span>` : "";
      const anyQueued = queue.length > 0;
      const canEnqueue = !isPlanned && !isDone && !isQueued && !isLocked && !anyQueued && (completionCount + queuedCount < maxLevels);
      const prereqLabel = prog.prereqs.length
        ? prog.prereqs.map((id) => programs.find((p) => p.id === id)?.name || id).join(", ")
        : "None";

      const levelLabel = maxLevels > 1 ? ` (${completionCount}/${maxLevels})` : "";

      if (isDone) {
        return `<div class="rnd-row rnd-row--done">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}${levelLabel}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
            ${plannedNote}
          </div>
          <span class="rnd-row__badge rnd-row__badge--done">\u2713 COMPLETE</span>
        </div>`;
      }

      if (isQueued || queuedCount > 0) {
        return `<div class="rnd-row rnd-row--queued">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}${levelLabel}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
            <span class="rnd-row__meta">${prog.durationHours}h &middot; ${toCurrency(prog.costCredits)}</span>
            ${plannedNote}
          </div>
          <span class="rnd-row__badge rnd-row__badge--queued">IN QUEUE</span>
        </div>`;
      }

      if (isPlanned) {
        return `<div class="rnd-row rnd-row--locked rnd-row--planned">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
            ${plannedNote}
          </div>
          <span class="rnd-row__badge rnd-row__badge--locked">PLANNED</span>
        </div>`;
      }

      if (isLocked) {
        return `<div class="rnd-row rnd-row--locked">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
            <span class="rnd-row__meta">Requires: ${escapeHtml(prereqLabel)}</span>
          </div>
          <span class="rnd-row__badge rnd-row__badge--locked">LOCKED</span>
        </div>`;
      }

      // Available
      return `<div class="rnd-row rnd-row--available">
        <div class="rnd-row__info">
          <span class="rnd-row__name">${escapeHtml(prog.name)}${levelLabel}</span>
          <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
          <span class="rnd-row__meta">${prog.durationHours}h &middot; ${toCurrency(prog.costCredits)} &middot; Prereqs: ${escapeHtml(prereqLabel)}</span>
        </div>
        ${canEnqueue
          ? `<button class="btn btn-accent ceo-enqueue-btn" type="button" data-program-id="${prog.id}">+ Enroll</button>`
          : `<span class="rnd-row__badge rnd-row__badge--locked">AWAITING SLOT</span>`
        }
      </div>`;
    })
    .join("");

  treeWrap.innerHTML = rows || '<p class="muted">No insight programs configured.</p>';

  treeWrap.onclick = async (e) => {
    const btn = e.target.closest(".ceo-enqueue-btn");
    if (!btn) return;
    const programId = btn.getAttribute("data-program-id");
    if (!programId || !appState.accountId) return;

    btn.disabled = true;
    btn.textContent = "Enrolling\u2026";

    try {
      const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/queue-ceo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId })
      });

      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
      updateAllViews();
    } catch (error) {
      btn.disabled = false;
      btn.textContent = "+ Enroll";
      pushFeedback(`CEO Insight error: ${error.message}`, "warn");
    }
  };
}

function updateCorpIdentity(data) {
  const identity = document.getElementById("corp-identity");
  const corp = data.corp;
  identity.innerHTML = `
    <dt>Corporation</dt><dd>${corp.corporationName}</dd>
    <dt>CEO</dt><dd>${corp.ceo}</dd>
    <dt>Location</dt><dd>${escapeHtml(corp.location || "Earth")}</dd>
    <dt>Level</dt><dd>${corp.level} / ${corp.levelCap}</dd>
    <dt>Employees</dt><dd>${corp.employeeCount} / ${corp.employeeCap}</dd>
    <dt>Building Slots</dt><dd>${corp.buildingSlots}</dd>
    <dt>Fleet Cap</dt><dd>${corp.fleet?.cap ?? corp.unlocks.maxFleetSize}</dd>
  `;

  const milestones = document.getElementById("milestone-list");
  if (milestones) {
    milestones.innerHTML = MILESTONE_ROADMAP
      .map((item) => {
        const done = corp.milestonesCompleted.includes(item);
        return `
          <li class="milestone-item${done ? " done" : ""}">
            <span class="milestone-state">${done ? "Done" : "Open"}</span>
            <span>${escapeHtml(item)}</span>
          </li>
        `;
      })
      .join("");
  }
}

function updateReplayOnboardingVisibility(data) {
  if (!replayOnboardingButton) return;
  const level = Number(data?.corp?.level || 0);
  replayOnboardingButton.hidden = level >= 5;
}

function showStationOverview() {
  const overviewEl = document.getElementById("station-overview-view");
  const detailEl = document.getElementById("station-building-view");
  const contentEl = document.getElementById("station-building-content");
  if (overviewEl) overviewEl.hidden = false;
  if (detailEl) detailEl.hidden = true;
  if (contentEl) contentEl.classList.remove("ge-bg", "icl-bg", "oes-bg");
  appState.stationActiveLease = null;
}

function showStationBuilding(buildingId) {
  const overviewEl = document.getElementById("station-overview-view");
  const detailEl = document.getElementById("station-building-view");
  const contentEl = document.getElementById("station-building-content");
  if (!overviewEl || !detailEl || !contentEl) return;

  const building = appState.buildingRegistry.find((b) => b.id === buildingId);
  if (!building) return;

  overviewEl.hidden = true;
  detailEl.hidden = false;
  // For ISA Contracting & Assignments Bureau, renderBuildingDetail switches tab to 'missions' and returns early
  if (building.id === "isa-contracting-assignments") {
    renderBuildingDetail(building, appState.data);
    return;
  }
  renderBuildingDetail(building, appState.data);
  setTab("station");
}

function renderBuildingDetail(building, data) {
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl) return;

  // Apply building-specific background classes
  contentEl.classList.remove("ge-bg", "icl-bg", "oes-bg");
  if (building.id === "orbital-executive-suites") {
    contentEl.classList.add("oes-bg");
  } else if (building.id === "isa-claims-leases") {
    contentEl.classList.add("icl-bg");
  } else if (building.id === "galactic-exchange") {
    contentEl.classList.add("ge-bg");
  }

  // ISA Contracting & Assignments Bureau → redirect to Missions tab
  if (building.id === "isa-contracting-assignments") {
    showStationOverview();
    appState.missionsView = "board";
    setTab("missions");
    renderMissions(data);
    return;
  }

  if (building.id === "orbital-executive-suites") {
    contentEl.innerHTML = renderOrbitalExecutiveSuites(building, data);
    bindOfficeActions(building, data);
  } else if (building.id === "isa-claims-leases") {
    if (appState.stationActiveLease) {
      const lease = (data.corp?.miningLeases || []).find((l) => l.id === appState.stationActiveLease);
      if (lease) {
        contentEl.innerHTML = renderLeaseManagement(building, lease, data);
        bindLeaseManagementActions(building, lease, data);
      } else {
        // Lease no longer found — fall back to list view
        appState.stationActiveLease = null;
        contentEl.innerHTML = renderISAClaimsLeases(building, data);
        bindISAClaimsLeasesActions(building, data);
      }
    } else {
      contentEl.innerHTML = renderISAClaimsLeases(building, data);
      bindISAClaimsLeasesActions(building, data);
    }
  } else {
    const station = getCurrentStationInfo(data);
    contentEl.innerHTML = `
      <div class="building-detail-header">
        <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
        <h2>${escapeHtml(building.name)}</h2>
      </div>
      ${stationLocationBanner(station)}
      <p class="muted lede">${escapeHtml(building.description)}</p>
      <p class="building-flavor">${escapeHtml(building.flavor)}</p>
      <p class="muted" style="margin-top:1.5rem;">This office is not yet operational. Check back in a future update.</p>
    `;
  }
}

function getCurrentStationInfo(data) {
  const corp = data.corp || {};
  const stationId = corp.currentStationId || "earth-station-prime";
  const station = appState.stationRegistry.find((s) => s.id === stationId) || appState.stationRegistry[0];
  return station;
}

function stationLocationBanner(station) {
  if (!station) return "";
  return `<div class="station-location-banner">
    <span class="station-location-icon">&#9670;</span>
    <span class="station-location-text">Docked at <strong>${escapeHtml(station.name)}</strong> &mdash; ${escapeHtml(station.body)}, ${escapeHtml(station.systemId?.toUpperCase() || "SOL")}</span>
  </div>`;
}

/*
  TODO(AB#739): Move the rendering and functionality of each building to their own dedicated file. Ensure that relevant information is being fetched from the 
  database where applicable.
*/

// ─── Orbital Executive Suites ──────────────────────────────────────────
function renderOrbitalExecutiveSuites(building, data) {
  const corp = data.corp;
  const station = getCurrentStationInfo(data);
  const currentStationId = station?.id || "earth-station-prime";
  const currentBody = station?.body || corp?.location || "Earth";
  const stationId = station?.id || "earth-station-prime";
  const existingOffice = (corp.offices || []).find((o) => o.stationId === stationId);

  const headerHtml = `
    <div class="building-detail-header">
      <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
      <h2>${escapeHtml(building.name)}</h2>
    </div>
    ${stationLocationBanner(station)}
    <p class="muted lede">${escapeHtml(building.description)}</p>
    <p class="building-flavor">${escapeHtml(building.flavor)}</p>
  `;

  if (!existingOffice) {
    return `
      ${headerHtml}
      <section id="lease-suite-box" class="form-card action-surface" style="margin-top:1.5rem;">
        <h3>Lease an Office Suite</h3>
        <p class="muted">Establish a registered corporate presence at ${escapeHtml(station?.name || "this station")} by leasing a suite. This is required before your corporation can hire personnel or engage with station services.</p>
        <dl class="kv-list" style="margin:0.9rem 0;">
          <dt>Lease Cost</dt><dd>${toCurrency(officeLeaseCost(1))} credits a day</dd>
          <dt>Station</dt><dd>${escapeHtml(station?.name || stationId)}</dd>
          <dt>Location</dt><dd>${escapeHtml(currentBody)}, ${escapeHtml(station?.systemId?.toUpperCase() || "SOL")}</dd>
        </dl>
        <p class="muted">The lease runs for the term you choose and can be extended from this office before or after it ends. Without an active office you cannot start a mining cycle.</p>
        <div class="inline-form compact-action-form">
          <label>
            Term
            <select id="rent-office-duration">
              ${OFFICE_TERMS_DAYS.map((days) => `<option value="${days}">${days} days — ${toCurrency(officeLeaseCost(days))}</option>`).join("")}
            </select>
          </label>
          <button id="rent-office-btn" class="btn btn-accent" type="button">Execute Lease Agreement</button>
        </div>
        <p id="rent-office-status" class="muted action-hint"></p>
      </section>
    `;
  }

  const rentedDate = new Date(existingOffice.rentedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });
  const availableStaffCapacity = Math.max(1, corp.employeeCap - corp.employeeCount);

  const now = Date.now();
  const rentedUntil = existingOffice.rentedUntil || 0;
  const leaseExpired = rentedUntil <= now;
  const msRemaining = Math.max(0, rentedUntil - now);
  const daysRemaining = msRemaining / 86_400_000;
  const fullDays = Math.floor(daysRemaining);
  const hoursRemaining = Math.floor((msRemaining % 86_400_000) / 3_600_000);
  const expiryDate = new Date(rentedUntil).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
  const leaseStatusBadge = leaseExpired
    ? `<span class="building-status-badge downtime">Expired</span>`
    : `<span class="building-status-badge operational">Active Lease</span>`;
  const timeRemainingText = leaseExpired
    ? `<span style="color:var(--red,#f44);">Lease expired</span>`
    : `${fullDays}d ${hoursRemaining}h remaining`;

  return `
    ${headerHtml}

    <section class="form-card" style="margin-top:1.5rem;max-width:750px;">
      <h3>Office Status</h3>
      <dl class="kv-list kv-list--compact">
        <dt>Status</dt><dd>${leaseStatusBadge}</dd>
        <dt>Station</dt><dd>${escapeHtml(existingOffice.name)}</dd>
        <dt>Location</dt><dd>${escapeHtml(existingOffice.body)}, ${escapeHtml(existingOffice.systemId?.toUpperCase() || "SOL")}</dd>
        <dt>Lease Commenced</dt><dd>${rentedDate}</dd>
        <dt>Lease Expires</dt><dd>${expiryDate}</dd>
        <dt>Time Remaining</dt><dd>${timeRemainingText}</dd>
      </dl>
    </section>

    <section class="form-card action-surface" style="margin-top:1rem;max-width:750px;">
      <h3>${leaseExpired ? "Renew Expired Lease" : "Extend Lease"}</h3>
      <p class="muted">${leaseExpired ? "Your office lease has expired. Renew to restore access to station services." : "Extend your current lease term. The additional days will be added to your existing expiry date."}</p>
      <form id="renew-office-form" class="inline-form compact-action-form">
        <label>
          Duration
          <select id="renew-office-duration">
            ${[7, 14, 21, 28].map((days) => `<option value="${days}"${days === 28 ? " selected" : ""}>${days} days — ${toCurrency(officeRenewalCost(corp.completedInsights, days))}</option>`).join("")}
          </select>
        </label>
        <button class="btn btn-accent" type="submit">${leaseExpired ? "Renew Lease" : "Extend Lease"}</button>
      </form>
      <p id="renew-office-status" class="muted action-hint"></p>
    </section>

    <section class="form-card action-surface" style="margin-top:1rem;max-width:750px;">
      <h3>Workforce — Hire Personnel</h3>
      <p class="muted">Recruit employees through your registered office. Each hire costs ${toCurrency(2000)} credits and adds ${toCurrency(150)}/day to operational payroll.</p>
      <form id="office-hire-form" class="inline-form compact-action-form">
        <label>
          Head Count
          <input id="office-hire-count" type="number" min="1" max="${availableStaffCapacity}" value="1" />
        </label>
        <button class="btn btn-accent" type="submit">Hire Personnel</button>
      </form>
      <p id="office-hire-hint" class="muted action-hint">Available headroom: ${corp.employeeCap - corp.employeeCount} position(s). Staffing: ${corp.employeeCount} / ${corp.employeeCap}.</p>
      <p id="office-hire-status" class="muted"></p>
    </section>

    <section class="form-card" style="margin-top:1rem;max-width:750px;">
      <h3>Station Services</h3>
      <p class="muted">Visit the ISA Claims &amp; Leases Division to file extraction rights applications. Each station's claims office files leases on the body it orbits.</p>
    </section>
  `;
}

function bindOfficeActions(building, data) {
  const rentBtn = document.getElementById("rent-office-btn");
  if (rentBtn) {
    rentBtn.addEventListener("click", async () => {
      const statusEl = document.getElementById("rent-office-status");
      const corp = appState.data?.corp;
      const currentStationId = corp?.currentStationId || "earth-station-prime";
      const station = appState.stationRegistry.find((s) => s.id === currentStationId) || appState.stationRegistry[0];
      const durationDays = Number(document.getElementById("rent-office-duration")?.value) || OFFICE_TERMS_DAYS[0];

      rentBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Processing lease agreement...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/rent-office`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stationId: station?.id || "earth-station-prime", durationDays }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
          // AB#1056: hiring is the next thing to do, and on a phone its form sat a screen and a half down
          revealUnderHeader(document.getElementById("office-hire-form")?.closest(".form-card"));
        } else {
          const cost = officeLeaseCost(durationDays);
          if ((appState.data.corp.finances.credits || 0) < cost) {
            throw new Error(`Leasing requires ${toCurrency(cost)} credits. Current reserves: ${toCurrency(appState.data.corp.finances.credits)}.`);
          }
          if (!Array.isArray(appState.data.corp.offices)) appState.data.corp.offices = [];
          appState.data.corp.finances.credits -= cost;
          appState.data.corp.offices.push({
            stationId: station?.id || "earth-station-prime",
            name: station?.name || "Earth Station Prime",
            body: currentBody,
            systemId: station?.systemId || "sol",
            tier: station?.tier || 1,
            rentedAt: Date.now(),
            rentedUntil: Date.now() + durationDays * 86_400_000,
            durationDays
          });
          updateAllViews();
          showStationBuilding(building.id);
        }
        pushFeedback(`Office lease confirmed at ${station?.name || "Earth Station Prime"}.`, "success");
      } catch (err) {
        rentBtn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Lease agreement failed.";
      }
    });
  }

  const renewForm = document.getElementById("renew-office-form");
  if (renewForm) {
    renewForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const durationSelect = document.getElementById("renew-office-duration");
      const statusEl = document.getElementById("renew-office-status");
      const durationDays = Number(durationSelect?.value || 28);
      const submitBtn = renewForm.querySelector("button[type=submit]");
      const corp = appState.data?.corp;
      const currentStationId = corp?.currentStationId || "earth-station-prime";
      const station = appState.stationRegistry.find((s) => s.id === currentStationId) || appState.stationRegistry[0];

      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Processing lease renewal...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/renew-office`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stationId: station?.id || "earth-station-prime", durationDays }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
        } else {
          const renewalCost = officeRenewalCost(corp.completedInsights, durationDays);
          if ((corp.finances.credits || 0) < renewalCost) {
            throw new Error(`Renewal requires ${toCurrency(renewalCost)} credits. Current reserves: ${toCurrency(corp.finances.credits)}.`);
          }
          const office = (corp.offices || []).find((o) => o.stationId === (station?.id || "earth-station-prime"));
          if (!office) throw new Error("No office found to renew.");
          corp.finances.credits -= renewalCost;
          const now = Date.now();
          office.rentedUntil = Math.max(office.rentedUntil || now, now) + durationDays * 86_400_000;
          updateAllViews();
          showStationBuilding(building.id);
        }
        pushFeedback(`Lease extended by ${durationDays} days.`, "success");
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Lease renewal failed.";
      }
    });
  }

  const hireForm = document.getElementById("office-hire-form");
  if (hireForm) {
    hireForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const countInput = document.getElementById("office-hire-count");
      const statusEl = document.getElementById("office-hire-status");
      const count = Math.max(1, Number(countInput?.value || 1));
      const submitBtn = hireForm.querySelector("button[type=submit]");

      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Processing hire order...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/hire`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
        } else {
          const corp = appState.data.corp;
          const available = Math.max(0, corp.employeeCap - corp.employeeCount);
          const hired = Math.min(count, available);
          const cost = hired * 2000;
          if (hired <= 0) throw new Error("No available headroom to hire additional personnel.");
          if (corp.finances.credits < cost) throw new Error(`Hiring requires ${toCurrency(cost)} credits.`);
          corp.employeeCount += hired;
          corp.finances.credits -= cost;
          corp.finances.dailyCosts += hired * 150;
          updateAllViews();
          showStationBuilding(building.id);
        }
        pushFeedback(`Personnel hired successfully.`, "success");
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Hire action failed.";
      }
    });
  }
}

// ─── ISA Claims & Leases Division ──────────────────────────────────────────

// The bodies the ISA leases. Module level so a full lease can say which are left (Bug #1057).
const LEASE_BODIES = [
  { body: "Earth", cost: 20000, description: "Grants two (2) on-surface building slots for Basic Extractor Yard construction. Abundant mineral and silicate deposits across diverse terrain." },
  { body: "Mars", cost: 25000, description: "Grants two (2) on-surface building slots for Basic Extractor Yard construction. Primary source of silicate deposits." },
  { body: "Luna", cost: 30000, description: "Grants two (2) on-surface building slots. Lunar regolith operations with access to Helium-3 deposits." }
];

import { leaseFullAdvice } from "./slotAdvice.js";
/** The bodies this corporation has not leased yet, each with the station that files it, for public/scripts/slotAdvice.js. */
function unleasedBodiesForPage(corp) {
  const leased = new Set((corp?.miningLeases || []).map((l) => l.body));
  return LEASE_BODIES.filter((b) => !leased.has(b.body))
    .map((b) => ({ body: b.body, station: (appState.stationRegistry || []).find((st) => st.body === b.body)?.name }))
    .filter((b) => b.station);
}

function renderISAClaimsLeases(building, data) {
  const corp = data.corp;
  const station = getCurrentStationInfo(data);
  const stationBody = station?.body || "Earth";
  const allLeases = corp?.miningLeases || [];
  const leases = allLeases.filter((l) => l.body === stationBody);

  const headerHtml = `
    <div class="building-detail-header">
      <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
      <h2>${escapeHtml(building.name)}</h2>
    </div>
    ${stationLocationBanner(station)}
    <p class="muted lede">${escapeHtml(building.description)}</p>
    <p class="building-flavor">${escapeHtml(building.flavor)}</p>
  `;

  const hasOffice = Boolean((corp?.offices || []).length > 0);
  const EMPLOYEES_PER_LEASE = 5;
  const totalLeaseCount = allLeases.length;
  const requiredForNext = (totalLeaseCount + 1) * EMPLOYEES_PER_LEASE;
  const currentEmployees = corp?.employeeCount || 0;

  // Active leases section
  let leasesHtml = "";
  if (leases.length === 0) {
    leasesHtml = `<p class="muted" style="margin-top:0.4rem;">${escapeHtml(claimsNoLeasesText(hasOffice))}</p>`; // Bug #1060
  } else {
    leasesHtml = `<div class="lease-card-grid">`;
    for (const lease of leases) {
      const extractorCount = (lease.extractorIds || []).length;
      const issuedDate = new Date(lease.issuedAt || Date.now()).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric"
      });
      leasesHtml += `
        <div class="lease-card">
          <div class="lease-card-header">
            <span class="lease-body-badge">${escapeHtml(lease.body)}</span>
            <span class="lease-type-label">${escapeHtml(lease.leaseType || "Silicate Extraction")}</span>
          </div>
          <dl class="kv-list kv-list--compact" style="margin:0.6rem 0;">
            <dt>Claim ID</dt><dd><code>${escapeHtml(lease.id)}</code></dd>
            <dt>Issued</dt><dd>${issuedDate}</dd>
            <dt>Building Slots</dt><dd>${extractorCount} / ${lease.buildingSlots || 2} used</dd>
          </dl>
          <button class="btn btn-outline btn-sm lease-manage-btn" data-lease-id="${escapeHtml(lease.id)}" type="button">
            Manage Lease
          </button>
        </div>
      `;
    }
    leasesHtml += `</div>`;
  }

  // Purchase section — only show bodies accessible from this station

  const ownedBodies = new Set(leases.map((l) => l.body));
  const availableBodies = LEASE_BODIES.filter((b) => b.body === stationBody && !ownedBodies.has(b.body));

  let purchaseHtml = "";
  const hasLocalBodies = LEASE_BODIES.some((b) => b.body === stationBody);

  if (!hasOffice) {
    purchaseHtml = `<p class="muted">A registered corporate office is required before the ISA will process lease applications. Visit the Orbital Executive Suites first.</p>`;
  } else if (!hasLocalBodies) {
    purchaseHtml = `<p class="muted">No extraction zones are available at ${escapeHtml(station?.name || "this station")}. Travel to a station orbiting a resource-bearing body to file new lease applications.</p>`;
  } else if (availableBodies.length === 0) {
    // Bug #1060: say where the other leases are filed, by station name from the registry.
    purchaseHtml = `<p class="muted">${escapeHtml(claimsAllTakenText({
      offeredBodies: LEASE_BODIES.map((b) => b.body),
      ownedBodies: allLeases.map((l) => l.body), // every lease held, not only this station's
      stations: appState.stationRegistry || []
    }))}</p>`;
  } else {
    purchaseHtml = availableBodies.map((entry) => {
      const canAfford = (corp?.finances?.credits || 0) >= entry.cost;
      const hasEnoughStaff = currentEmployees >= requiredForNext;
      return `
        <div class="lease-purchase-block" style="margin-bottom:1.2rem;">
          <h4 style="margin:0 0 0.5rem;">${escapeHtml(entry.body)} — Silicate Extraction Lease</h4>
          <p class="muted" style="margin-bottom:0.8rem;">${escapeHtml(entry.description)}</p>
          <dl class="kv-list kv-list--compact" style="max-width:380px;margin-bottom:0.9rem;">
            <dt>Lease Cost</dt><dd>${toCurrency(entry.cost)} credits (one-time)</dd>
            <dt>Employee Requirement</dt><dd>${requiredForNext} on payroll (current: ${currentEmployees})</dd>
            <dt>Building Slots Granted</dt><dd>2 on-surface slots</dd>
          </dl>
          ${!hasEnoughStaff ? `<p class="muted action-hint" style="color:var(--warn,#f0ad4e);">Hire at least ${requiredForNext - currentEmployees} more employee(s) before filing this application.</p>` : ""}
          <button class="purchase-lease-btn btn btn-accent" type="button" data-body="${escapeHtml(entry.body)}" ${!hasEnoughStaff || !canAfford ? "disabled" : ""}>
            File Lease Application — ${escapeHtml(entry.body)}
          </button>
        </div>
      `;
    }).join("");
  }

  return `
    ${headerHtml}
    <section class="form-card" style="margin-top:1.5rem;">
      <h3>Active Mining Claims</h3>
      ${leasesHtml}
    </section>
    <section class="form-card action-surface" style="margin-top:1rem;">
      <h3>File Extraction Lease Application</h3>
      ${purchaseHtml}
    </section>
  `;
}

function bindISAClaimsLeasesActions(building, data) {
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl) return;

  // Purchase lease buttons (one per available body)
  contentEl.querySelectorAll(".purchase-lease-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const body = btn.getAttribute("data-body");
      if (!body) return;
      btn.disabled = true;
      btn.textContent = "Submitting lease application to ISA...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/purchase-lease`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
        }
        pushFeedback(`${body} mining lease approved by the ISA.`, "success");
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `File Lease Application — ${body}`;
        pushFeedback(err.message || "Lease application failed.", "warn");
      }
    });
  });

  // Manage buttons for each lease card
  contentEl.querySelectorAll(".lease-manage-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const leaseId = btn.getAttribute("data-lease-id");
      if (leaseId) {
        appState.stationActiveLease = leaseId;
        renderBuildingDetail(building, appState.data || data);
      }
    });
  });
}

// Bug #1091: the running figures, shared by the lease view and its live refresh. Imported beside their use.
import { activeCycleFigures, extractorState } from "./leaseLive.js";

/**
 * Refresh the open lease view's running figures from the latest extractors, in place, so a Start Cycle form being
 * filled in is not wiped. When an extractor changes state (a cycle ends or breaks down) the row's layout changes,
 * so the view is redrawn instead. Does nothing when no lease view is open.
 */
function refreshOpenLeaseView(extractors) {
  const rows = document.querySelectorAll("[data-live-ex]");
  if (!rows.length) return;
  const byId = new Map((extractors || []).map((ex) => [ex.id, ex]));
  for (const row of rows) {
    const ex = byId.get(row.getAttribute("data-live-ex"));
    if (!ex || extractorState(ex) !== row.getAttribute("data-live-state")) {
      showStationBuilding("isa-claims-leases");
      return;
    }
    if (extractorState(ex) !== "active" || !ex.endsAt || !ex.startedAt) continue;
    const { pct, hrs, mins, mined, fees } = activeCycleFigures(ex);
    const set = (key, text) => { const el = row.querySelector(`[data-live="${key}"]`); if (el) el.textContent = text; };
    set("pct", `${pct}%`);
    set("left", `${hrs}h ${mins}m left`);
    set("remaining", `${hrs}h ${mins}m`);
    set("mined", mined.toLocaleString());
    set("fees", toCurrency(fees));
    const fill = row.querySelector('[data-live="fill"]');
    if (fill) fill.style.width = `${pct}%`;
  }
}

function renderLeaseManagement(building, lease, data) {
  const corp = data.corp;
  const extractors = (corp?.mining?.silicateExtractors || []).filter((ex) => ex.leaseId === lease.id);
  const usedSlots = extractors.length;
  const totalSlots = lease.buildingSlots || 2;
  const hasSlotAvailable = usedSlots < totalSlots;
  const buildCost = 50000;
  const canAffordBuild = (corp?.finances?.credits || 0) >= buildCost;

  const issuedDate = new Date(lease.issuedAt || Date.now()).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });

  // Extractor list
  let extractorRows = "";
  for (const ex of extractors) {
    let statusClass = "idle";
    if (ex.downtimeActive) {
      statusClass = "downtime";
    } else if (ex.active) {
      statusClass = "active";
    }
    let cycleInfo = "";
    let progressBarHtml = "";

    if (ex.downtimeActive) {
      const downtimeStart = Number(ex.downtimeStartedAt || Date.now());
      const now = Date.now();
      const downtimeDur = now - downtimeStart;
      const dtHrs = Math.floor(downtimeDur / 3_600_000);
      const dtMins = Math.floor((downtimeDur % 3_600_000) / 60_000);

      // Show where the mining cycle was paused
      let cyclePct = 0;
      let cycleRemaining = "";
      let cycleElapsed = "";
      if (ex.endsAt && ex.startedAt) {
        const cycleDuration = ex.endsAt - ex.startedAt;
        const elapsedBeforeDowntime = Math.min(downtimeStart - ex.startedAt, cycleDuration);
        cyclePct = cycleDuration > 0 ? Math.min(100, Math.round((elapsedBeforeDowntime / cycleDuration) * 100)) : 0;
        const remainMs = Math.max(0, cycleDuration - elapsedBeforeDowntime);
        const remHrs = Math.floor(remainMs / 3_600_000);
        const remMins = Math.floor((remainMs % 3_600_000) / 60_000);
        const elapHrs = Math.floor(elapsedBeforeDowntime / 3_600_000);
        const elapMins = Math.floor((elapsedBeforeDowntime % 3_600_000) / 60_000);
        cycleRemaining = `${remHrs}h ${remMins}m remaining when halted`;
        cycleElapsed = `${elapHrs}h ${elapMins}m elapsed before shutdown`;
      }

      cycleInfo = `<span class="extractor-cycle-status downtime">Equipment Offline &mdash; Down for ${dtHrs}h ${dtMins}m</span>`;
      progressBarHtml = `
        <div class="extractor-progress-wrap">
          <div class="extractor-progress-header">
            <span class="extractor-progress-pct">${cyclePct}% (paused)</span>
            <span class="extractor-progress-time">${cycleRemaining}</span>
          </div>
          <div class="extractor-progress-track">
            <div class="extractor-progress-fill downtime" style="width:${cyclePct}%"></div>
          </div>
          <div class="extractor-stat-row">
            <span class="extractor-stat"><span class="extractor-stat-label">Cycle progress</span><span class="extractor-stat-value">${cycleElapsed}</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Downtime elapsed</span><span class="extractor-stat-value">${dtHrs}h ${dtMins}m</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Mined before halt</span><span class="extractor-stat-value">${(ex.minedThisCycle || 0).toLocaleString()}</span></span>
          </div>
        </div>
      `;
    } else if (ex.active && ex.endsAt && ex.startedAt) {
      // Bug #1091: the figures come from public/scripts/leaseLive.js, and carry data-live so mining:updated can refresh
      // them in place while the view stays open.
      const { pct, hrs, mins, mined, fees: estimatedFees } = activeCycleFigures(ex);

      cycleInfo = `<span class="extractor-cycle-status">${ex.throughputPerHour} t/h &mdash; <span data-live="remaining">${hrs}h ${mins}m</span> remaining</span>`;
      progressBarHtml = `
        <div class="extractor-progress-wrap">
          <div class="extractor-progress-header">
            <span class="extractor-progress-pct" data-live="pct">${pct}%</span>
            <span class="extractor-progress-time" data-live="left">${hrs}h ${mins}m left</span>
          </div>
          <div class="extractor-progress-track">
            <div class="extractor-progress-fill" data-live="fill" style="width:${pct}%"></div>
          </div>
          <div class="extractor-stat-row">
            <span class="extractor-stat"><span class="extractor-stat-label">Mined this cycle</span><span class="extractor-stat-value" data-live="mined">${mined.toLocaleString()}</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Fees incurred</span><span class="extractor-stat-value" data-live="fees">${toCurrency(estimatedFees)}</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Rate</span><span class="extractor-stat-value">${ex.throughputPerHour} t/h</span></span>
          </div>
        </div>
      `;
    } else if (ex.totalMined > 0) {
      cycleInfo = `<span class="extractor-cycle-status idle">Idle &mdash; ${ex.totalMined.toLocaleString()} t extracted lifetime</span>`;
    } else {
      cycleInfo = `<span class="extractor-cycle-status idle">Idle &mdash; no cycle history</span>`;
    }

    const mineFormId = `mine-form-${ex.id}`;
    const mineFormHtml = !ex.active
      ? `<form class="inline-form compact-action-form lease-mine-form" id="${escapeHtml(mineFormId)}" data-extractor-id="${escapeHtml(ex.id)}" style="margin-top:0.5rem;">
          <label>Throughput (t/h)<input type="number" name="amount" min="10" max="250" value="40" style="width:72px;" /></label>
          <label>Duration (hrs)<input type="number" name="hours" min="1" max="72" value="24" style="width:60px;" /></label>
          <button class="btn btn-accent btn-sm" type="submit">Start Cycle</button>
        </form>
        <p class="muted action-hint lease-mine-projection" data-for="${escapeHtml(ex.id)}">${escapeHtml(mineProjectionText(40))}</p>
        <p class="muted action-hint lease-mine-status" data-for="${escapeHtml(ex.id)}"></p>`
      : "";

    // AB#1052: a Stop control on a running cycle (including one paused in downtime, since that is still
    // extractor.active — see server/game/mining.js). It ends the cycle now, keeping what has been mined.
    const stopButtonHtml = ex.active
      ? `<button type="button" class="btn btn-outline btn-sm lease-stop-btn" data-extractor-id="${escapeHtml(ex.id)}" data-extractor-name="${escapeHtml(ex.name)}" style="margin-top:0.5rem;">Stop Cycle</button>
        <p class="muted action-hint lease-stop-status" data-for="${escapeHtml(ex.id)}"></p>`
      : "";

    const mineFormVisible = !ex.active && !ex.downtimeActive;
    extractorRows += `
      <div class="extractor-row ${statusClass}" data-live-ex="${escapeHtml(ex.id)}" data-live-state="${extractorState(ex)}">
        <div class="extractor-row-header">
          <strong>${escapeHtml(ex.name)}</strong>
          <span class="building-status-badge ${statusClass}">${ex.downtimeActive ? "Downtime" : (ex.active ? "Active" : "Idle")}</span>
        </div>
        ${ex.downtimeActive ? cycleInfo : (ex.active ? "" : cycleInfo)}
        ${progressBarHtml}
        ${mineFormVisible ? mineFormHtml : ""}
        ${ex.active ? stopButtonHtml : ""}
      </div>
    `;
  }

  const extractorSection = extractors.length === 0
    ? `<p class="muted" style="margin-top:0.4rem;">No extraction facilities on this claim yet. Commission a yard below to begin operations.</p>`
    : `<div class="extractor-list">${extractorRows}</div>`;

  const buildSection = hasSlotAvailable
    ? `<div class="lease-purchase-block" style="margin-top:0.6rem;">
        <h4 style="margin:0 0 0.4rem;">Commission Basic Extractor Yard</h4>
        <p class="muted" style="margin-bottom:0.7rem;">Deploys an extraction facility to this lease's surface allocation. Slot usage: ${usedSlots}/${totalSlots}.</p>
        <dl class="kv-list kv-list--compact" style="max-width:360px;margin-bottom:0.8rem;">
          <dt>Construction Cost</dt><dd>${toCurrency(buildCost)} credits</dd>
          <dt>Asset Value</dt><dd>${toCurrency(36000)} credits</dd>
        </dl>
        <button id="lease-build-extractor-btn" class="btn btn-accent" type="button" ${!canAffordBuild ? "disabled" : ""}>
          Commission Extractor Yard
        </button>
        <p id="lease-build-extractor-status" class="muted action-hint"></p>
      </div>`
    : `<p class="muted" style="margin-top:0.6rem;">This lease's building slots are fully allocated (${usedSlots}/${totalSlots}). ${escapeHtml(leaseFullAdvice(corp, lease, unleasedBodiesForPage(corp)))}</p>`;

  const station = getCurrentStationInfo(data);

  return `
    <div class="building-detail-header">
      <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
      <h2>Mining Lease — ${escapeHtml(lease.body)}</h2>
    </div>
    ${stationLocationBanner(station)}
    <button id="lease-back-btn" class="btn btn-outline btn-sm" type="button" style="margin-bottom:1.2rem;">&#8592; Back to Claims &amp; Leases</button>

    <section class="form-card lease-management-card" style="margin-top:0;">
      <h3>Lease Details</h3>
      <dl class="kv-list kv-list--compact">
        <dt>Claim ID</dt><dd><code>${escapeHtml(lease.id)}</code></dd>
        <dt>Body</dt><dd>${escapeHtml(lease.body)}</dd>
        <dt>Lease Type</dt><dd>${escapeHtml(lease.leaseType || "Silicate Extraction")}</dd>
        <dt>Issued</dt><dd>${issuedDate}</dd>
        <dt>Building Slots</dt><dd>${usedSlots} / ${totalSlots} used</dd>
      </dl>
    </section>

    <section class="form-card lease-management-card" style="margin-top:1rem;">
      <h3>Extraction Facilities</h3>
      ${extractorSection}
    </section>

    <section class="form-card action-surface lease-management-card" style="margin-top:1rem;">
      <h3>Commission Infrastructure</h3>
      ${buildSection}
    </section>
  `;
}

function bindLeaseManagementActions(building, lease, data) {
  const backBtn = document.getElementById("lease-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      appState.stationActiveLease = null;
      renderBuildingDetail(building, appState.data || data);
    });
  }

  const buildBtn = document.getElementById("lease-build-extractor-btn");
  if (buildBtn) {
    buildBtn.addEventListener("click", async () => {
      const statusEl = document.getElementById("lease-build-extractor-status");
      buildBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Commissioning extraction facility...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/lease/${encodeURIComponent(lease.id)}/build-extractor`,
            { method: "POST" }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        } else {
          // Demo account fallback
          const corp = appState.data.corp;
          const cost = 50000;
          if ((corp.finances.credits || 0) < cost) throw new Error(`Construction requires ${toCurrency(cost)} credits.`);
          if (!Array.isArray(corp.mining.silicateExtractors)) corp.mining.silicateExtractors = [];
          const nextIndex = corp.mining.silicateExtractors.length + 1;
          const newId = `ext-basic-${nextIndex}`;
          corp.buildings.push({ name: "Basic Extractor Yard", tier: 1, status: "Operational" });
          corp.mining.silicateExtractors.push({
            id: newId, name: `Basic Extractor Yard #${nextIndex}`, tier: 1, active: false,
            startedAt: null, lastTickAt: null, endsAt: null, throughputPerHour: 0,
            operationCostPerHour: 0, totalMined: 0, totalSpent: 0, lastCompletedAt: null, leaseId: lease.id
          });
          const leaseObj = corp.miningLeases.find((l) => l.id === lease.id);
          if (leaseObj) { if (!Array.isArray(leaseObj.extractorIds)) leaseObj.extractorIds = []; leaseObj.extractorIds.push(newId); }
          corp.finances.credits -= cost;
          corp.finances.assets = (corp.finances.assets || 0) + 36000;
          updateAllViews();
          const updatedLease = corp.miningLeases.find((l) => l.id === lease.id);
          renderBuildingDetail(building, appState.data);
        }
        pushFeedback("Basic Extractor Yard commissioned and linked to lease.", "success");
      } catch (err) {
        buildBtn.disabled = false;
        // If the server can't find the lease (e.g. server restarted and lost in-memory state),
        // the client state is stale. Clear it and send the user back to the list view.
        if (err.message && err.message.includes("could not be found")) {
          appState.stationActiveLease = null;
          pushFeedback("Session state out of sync — please re-purchase your lease.", "error");
          renderBuildingDetail(building, appState.data);
          return;
        }
        if (statusEl) statusEl.textContent = err.message || "Construction failed.";
      }
    });
  }

  // ISP-86: what an hour at the chosen rate earns after its running cost, shown before the cycle starts. The
  // running cost rises faster than the rate, so the top of the range is no longer the answer to everything and
  // the player can see that while they are choosing rather than afterwards.
  const showMineProjection = (form) => {
    const line = form.parentElement?.querySelector(`.lease-mine-projection[data-for="${CSS.escape(form.getAttribute("data-extractor-id") || "")}"]`);
    if (!line) return;
    const rate = Math.max(10, Math.min(250, Number(form.querySelector('[name="amount"]')?.value || 40)));
    line.textContent = mineProjectionText(rate);
  };

  // Mining cycle forms
  document.querySelectorAll(".lease-mine-form").forEach((form) => {
    showMineProjection(form);
    form.querySelector('[name="amount"]')?.addEventListener("input", () => showMineProjection(form));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const extractorId = form.getAttribute("data-extractor-id");
      const amount = Number(form.querySelector('[name="amount"]')?.value || 40);
      const hours = Number(form.querySelector('[name="hours"]')?.value || 24);
      const statusEl = document.querySelector(`.lease-mine-status[data-for="${CSS.escape(extractorId)}"]`);
      const submitBtn = form.querySelector("button[type=submit]");
      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Initiating mining cycle...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/lease/${encodeURIComponent(lease.id)}/start-mining`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ extractorId, amount, hours }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        } else {
          // Demo fallback
          const corp = appState.data.corp;
          const throughputPerHour = Math.max(10, Math.min(250, amount));
          // ISP-86: the same curve the server charges, from the server's own constants.
          const operations = appState.economy?.operations;
          const operationCostPerHour = costPerHourFor(throughputPerHour, operations);
          const startupCost = clientStartupCostFor(operationCostPerHour, operations);
          if ((corp.finances.credits || 0) < startupCost) throw new Error(`Startup requires ${toCurrency(startupCost)} credits.`);
          const ex = corp.mining.silicateExtractors.find((e) => e.id === extractorId);
          if (!ex) throw new Error("Extractor not found.");
          if (ex.active) throw new Error("Extractor already has an active cycle.");
          const now = Date.now();
          corp.finances.credits -= startupCost;
          ex.active = true; ex.startedAt = now; ex.lastTickAt = now;
          ex.endsAt = now + hours * 3_600_000;
          ex.throughputPerHour = throughputPerHour;
          ex.operationCostPerHour = operationCostPerHour;
          ex.totalSpent += startupCost;
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        }
        pushFeedback("Mining cycle started.", "success");
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Mining cycle failed to start.";
      }
    });
  });

  // AB#1052: stop a running cycle early, keeping what has been mined and settling the cost for the time used.
  document.querySelectorAll(".lease-stop-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const extractorId = btn.getAttribute("data-extractor-id");
      const extractorName = btn.getAttribute("data-extractor-name") || "This extractor";
      const statusEl = document.querySelector(`.lease-stop-status[data-for="${CSS.escape(extractorId)}"]`);

      const confirmed = await showTradeConfirmation({
        heading: "Stop Mining Cycle",
        title: `Stop ${extractorName}?`,
        confirmLabel: "Stop Cycle",
        rows: [
          { label: "Extractor", value: extractorName },
          { label: "What happens", value: "Ends the cycle now. Silicates mined so far are kept; running costs stop." }
        ]
      });
      if (!confirmed) return;

      btn.disabled = true;
      if (statusEl) statusEl.textContent = "Stopping mining cycle...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/lease/${encodeURIComponent(lease.id)}/stop-mining`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extractorId }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        } else {
          // Demo fallback: settle the elapsed time the same way the server would, then stop.
          const corp = appState.data.corp;
          const ex = corp.mining.silicateExtractors.find((e) => e.id === extractorId);
          if (!ex) throw new Error("Extractor not found.");
          if (!ex.active) throw new Error("This extractor has no mining cycle running.");
          const now = Date.now();
          const elapsedHours = Math.max(0, (Math.min(now, ex.endsAt || now) - (ex.lastTickAt || ex.startedAt || now)) / 3_600_000);
          const mined = Math.floor(elapsedHours * (ex.throughputPerHour || 0));
          const cost = Math.floor(elapsedHours * (ex.operationCostPerHour || 0));
          ex.minedThisCycle = (ex.minedThisCycle || 0) + mined;
          ex.totalMined = (ex.totalMined || 0) + mined;
          corp.finances.credits = Math.max(0, (corp.finances.credits || 0) - cost);
          ex.totalSpent = (ex.totalSpent || 0) + cost;
          ex.active = false;
          ex.endsAt = now;
          ex.lastTickAt = now;
          ex.lastCompletedAt = now;
          updateAllViews();
          renderBuildingDetail(building, appState.data);
        }
        pushFeedback("Mining cycle stopped.", "success");
      } catch (err) {
        btn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || "Could not stop the mining cycle.";
      }
    });
  });
}

// ─── Tabs allowed during travel ──────────────────────────────────────────────
// TODO(AB#1053): Overhaul Travel Page design
const TRAVEL_ALLOWED_TABS = new Set(["overview", "inbox", "chat", "forums", "starmap", "travel"]);

function isPlayerTraveling(data) {
  const travel = data?.corp?.travel;
  return Boolean(travel && travel.arrivesAt);
}

function isPlayerInSpace(data) {
  return !data?.corp?.currentStationId && !isPlayerTraveling(data);
}

function enforceTravelTabLockdown(data) {
  const traveling = isPlayerTraveling(data);
  const inSpace = isPlayerInSpace(data);
  const showTravelTab = traveling || inSpace;
  const travelTabBtn = document.querySelector('.tab-btn[data-tab="travel"]');

  // Show/hide the Travel tab button
  if (travelTabBtn) travelTabBtn.hidden = !showTravelTab;

  // Enable/disable tabs
  tabButtons.forEach((btn) => {
    const tabId = btn.dataset.tab;
    if (traveling && !TRAVEL_ALLOWED_TABS.has(tabId)) {
      btn.disabled = true;
      btn.classList.add("tab-btn--locked");
    } else {
      btn.disabled = false;
      btn.classList.remove("tab-btn--locked");
    }
  });

  // If currently on a locked tab, switch to travel
  if (traveling) {
    const activeTab = document.querySelector(".tab-btn.active");
    const activeId = activeTab?.dataset?.tab;
    if (!activeId || !TRAVEL_ALLOWED_TABS.has(activeId)) {
      setTab("travel");
    }
  }

  // If in space (just arrived in system), switch to travel to show docking options
  if (inSpace) {
    const activeTab = document.querySelector(".tab-btn.active");
    const activeId = activeTab?.dataset?.tab;
    if (activeId === "station") {
      setTab("travel");
    }
  }
}

function formatSystemLabel(systemId) {
  return (systemId || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function renderTravelPage(data) {
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
            const response = await apiFetch(
              `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/travel`,
              { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toStationId: sid }) }
            );
            const account = await parseJsonResponse(response);
            appState.data = deepClone(account.state);
            appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
            updateAllViews();
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
function travelTimeBetween(fromStation, toStation) {
  if (!fromStation || !toStation) return 0;
  if (fromStation.body === toStation.body) return 1 * 60 * 1000;
  if (fromStation.systemId === toStation.systemId) return 1 * 60 * 1000;
  return 1 * 60 * 1000;
}


// Next to its one caller, not in the block at the top, where every branch adding an import collides (Bug #1253).
import { renderStationFacilities } from "./stationFacilities.js";

function renderStation(data) {
  const header = document.getElementById("station-location-header");
  const npcGrid = document.getElementById("station-npc-buildings");
  const playerGrid = document.getElementById("station-player-buildings");
  const travelBanner = document.getElementById("station-travel-banner");
  const overviewView = document.getElementById("station-overview-view");
  if (!header || !npcGrid || !playerGrid) return;

  const corp = data.corp || {};
  const currentStationId = corp.currentStationId;

  // If player is not docked, show an in-space message
  if (!currentStationId) {
    const systemId = corp.currentSystemId || "sol";
    header.innerHTML = `
      <p class="overline">IN OPEN SPACE</p>
      <h2>${escapeHtml(formatSystemLabel(systemId))} System</h2>
      <p class="muted lede">You are not docked at any station. Use the Travel tab or Starmap to dock at a station in this system.</p>
    `;
    npcGrid.innerHTML = "";
    playerGrid.innerHTML = "";
    const facSection = document.getElementById("station-facilities-section");
    if (facSection) facSection.hidden = true;
    if (travelBanner) travelBanner.hidden = true;
    if (overviewView) overviewView.hidden = false;
    return;
  }

  const station = appState.stationRegistry.find((s) => s.id === currentStationId) || appState.stationRegistry[0];

  // Always show station content (travel lockdown handled by tab system now)
  if (travelBanner) travelBanner.hidden = true;
  // Only restore overview if no building detail is currently open
  const buildingDetailView = document.getElementById("station-building-view");
  const buildingDetailOpen = buildingDetailView && !buildingDetailView.hidden;
  if (overviewView && !buildingDetailOpen) overviewView.hidden = false;

  if (!station) {
    header.innerHTML = `<h2>Station</h2><p class="muted">No station data available for your current location.</p>`;
    return;
  }

  header.innerHTML = `
    <p class="overline">${escapeHtml(station.designation)} &#47;&#47; ${escapeHtml(station.systemId.toUpperCase())}</p>
    <h2>${escapeHtml(station.name)}</h2>
    ${stationStartPromptHtml(corp)}
    <p class="muted lede">${escapeHtml(station.description)}</p>
  `;

  // ── Station buildings ──
  const stationBuildings = station.buildingIds
    .map((id) => appState.buildingRegistry.find((b) => b.id === id))
    .filter(Boolean);

  npcGrid.innerHTML = stationBuildingCardsHtml(stationBuildings);

  // ── Operational Facilities (Assembly, Refinery — prominent usable cards, and Construct) ──
  // Bug #1253: rendered and bound in one place, stationFacilities.js.
  renderStationFacilities(document, data.corp, {
    accountId: () => appState.accountId,
    request: async (path, init) => parseJsonResponse(await apiFetch(path, init)),
    onEnter: (name) => {
      if (name === "Assembly Facility") renderAssemblyFacility(data);
      else if (name === "Refinery") setTab("refinery");
    },
    onBuilt: (account) => {
      appState.data = deepClone(account.state);
      updateAllViews();
      pushFeedback("Assembly Facility online. Enter it to fabricate Mining Probes.", "ok");
    },
    onError: (error) => pushFeedback(error.message || "Construction failed.", "warn")
  });

  // ── Licensed Corporate Holdings (Extractor Yards — filtered to current station body) ──
  const stationBody = station.body;
  const leases = data.corp?.miningLeases || [];
  const leasesAtStation = leases.filter((l) => l.body === stationBody);
  const leaseIdsAtStation = new Set(leasesAtStation.map((l) => l.id));

  // Count extractors at this station via their lease linkage. Only show
  // extractors whose lease body matches the current station's body.
  const allExtractors = data.corp?.mining?.silicateExtractors || [];
  const displayExtractors = allExtractors.filter(
    (ex) => ex.leaseId && leaseIdsAtStation.has(ex.leaseId)
  );

  const extractorBuildingCount = displayExtractors.length;

  if (!extractorBuildingCount) {
    playerGrid.innerHTML = `<p class="muted">No extractor yards deployed at ${escapeHtml(station.name)}. Yards are linked to mining leases on ${escapeHtml(stationBody)}.</p>`;
  } else {
    playerGrid.innerHTML = displayExtractors
      .map(
        (ex) => {
          const statusText = ex.active ? "Active" : "Idle";
          const statusClass = ex.active ? "operational" : "idle";
          return `
            <article class="building-card data-card">
              <header class="building-card-header">
                <span class="faction-code-badge corp-badge">CORP</span>
                <h3>${escapeHtml(ex.name || "Basic Extractor Yard")}</h3>
              </header>
              <p class="muted">Tier ${ex.tier || 1} &mdash; <span class="building-status-badge ${statusClass}">${statusText}</span></p>
              <footer class="building-card-footer"></footer>
            </article>
          `;
        }
      )
      .join("");
  }
}

function renderAssemblyFacility(data) {
  const overviewView = document.getElementById("station-overview-view");
  const buildingView = document.getElementById("station-building-view");
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl || !buildingView) return;

  if (overviewView) overviewView.hidden = true;
  buildingView.hidden = false;
  contentEl.classList.remove("ge-bg", "icl-bg", "oes-bg");

  const am = data.corp?.asteroidMining || {};
  const probeCount = am.probeCount || 0;
  const fleet = data.corp?.fleet || { cap: 2, vessels: probeCount, full: probeCount >= 2, raiseText: "" }; // Bug #586
  const hasProspecting = (data.corp?.unlockedTech || []).includes("tt-asteroid-prospecting");
  const station = getCurrentStationInfo(data);

  let probeSection = "";
  if (!hasProspecting) {
    probeSection = `<p class="muted">Research <em>Asteroid Prospecting Arrays</em> to unlock Mining Probe fabrication.</p>`;
  } else {
    const fabQueue = am.fabricationQueue || [];
    const activeFab = fabQueue[0] || null;
    const pendingCount = fabQueue.length;
    const canBuild = !fleet.full && !activeFab;
    const deployedCount = (am.activeExpeditions || []).length;

    let fabProgressHtml = "";
    if (activeFab) {
      const elapsed = Date.now() - activeFab.startedAt;
      const total = activeFab.completesAt - activeFab.startedAt;
      const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
      const remainMs = Math.max(0, activeFab.completesAt - Date.now());
      fabProgressHtml = `
        <div class="assembly-fab-progress" style="margin-top:0.75rem;">
          <p class="muted" style="font-size:0.8rem;">Fabricating Mining Probe &mdash; ${formatDuration(remainMs)} remaining</p>
          <div class="progress-wrap"><div class="progress-bar" id="fab-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
        </div>
      `;
    }

    probeSection = `
      <div class="assembly-probe-status">
        <img src="/images/mining_probe.png" alt="Mining Probe" class="assembly-probe-img" />
        <div>
          <p>Mining Probes: <strong>${fleet.vessels} / ${fleet.cap}</strong> Fleet Cap <span class="muted">(${probeCount} in hangar${deployedCount > 0 ? `, ${deployedCount} on expedition` : ""}${pendingCount > 0 ? `, ${pendingCount} in fabrication` : ""})</span></p>
          ${canBuild
            ? `<button id="build-probe-btn" class="btn btn-accent">Fabricate Mining Probe (¤8,000)</button>`
            : activeFab
              ? ""
              : `<p class="muted">Your fleet is at its Fleet Cap. ${fleet.raiseText}</p>`
          }
          ${fabProgressHtml}
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = `
    <div class="building-detail-header">
      <span class="faction-code-badge corp-badge">CORP</span>
      <h2>Assembly Facility</h2>
    </div>
    ${stationLocationBanner(station)}
    <p class="muted lede">A modular manufacturing bay capable of fabricating autonomous mining probes and other deployable units.</p>
    ${probeSection}
  `;

  const buildProbeBtn = contentEl.querySelector("#build-probe-btn");
  if (buildProbeBtn) {
    buildProbeBtn.addEventListener("click", async () => {
      if (!appState.accountId) return;
      try {
        const res = await apiFetch(
          `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/build-mining-probe`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        const account = await parseJsonResponse(res);
        appState.data = deepClone(account.state);
        updateAllViews();
        renderAssemblyFacility(appState.data);
        // AB#1257: it said "fabricated" here, 30 minutes before the probe existed; that line now comes on completion.
        pushFeedback(probeFabricationStartedText(appState.data?.corp?.asteroidMining?.fabricationQueue), "ok");
      } catch (err) {
        pushFeedback(err.message || "Probe fabrication failed.", "warn");
      }
    });
  }
}

// The asteroid-mining feedback lines (AB#1257), beside the fabrication handler that writes one of them.
import { beltScoutedText, probeFabricationStartedText, probeReadyText } from "./miningFeedback.js";

function clearTravelTimer() {
  if (appState._travelTimer) {
    clearInterval(appState._travelTimer);
    appState._travelTimer = null;
  }
}

function updateTravelProgress(travel) {
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
      const activeTab = document.querySelector(".tab-btn.active");
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

function bindBuildingActions() {
  document.getElementById("station-npc-buildings")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-building-action]");
    if (!btn) return;
    const action = btn.dataset.buildingAction;
    if (action?.startsWith("tab:")) {
      setTab(action.slice(4));
    } else if (action?.startsWith("building:")) {
      showStationBuilding(action.slice(9));
    }
  });

  document.getElementById("station-back-btn")?.addEventListener("click", () => {
    showStationOverview();
  });

  // AB#1056: the Start here prompt opens the Suites; it has its own attribute so the walkthrough's highlight, which
  // finds the Suites card by data-building-action, still lands on the card.
  document.getElementById("station-location-header")?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-start-office]")) return;
    showStationBuilding("orbital-executive-suites");
    // straight to the lease form, which sits under the Suites' description and was below the fold on a phone
    revealUnderHeader(document.getElementById("rent-office-btn")?.closest(".form-card") || document.getElementById("station-building-view"));
  });
}

// ─── Financial Control Board (CORP-FIN-1) — KPI strip and ledger tables ─────

function setKpi(id, value, options = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.classList.remove("kpi-tile__value--positive", "kpi-tile__value--negative");
  if (options.tone === "positive") el.classList.add("kpi-tile__value--positive");
  else if (options.tone === "negative") el.classList.add("kpi-tile__value--negative");
}

function setTrend(id, deltaText, direction) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = deltaText;
  el.classList.remove("kpi-tile__trend--up", "kpi-tile__trend--down", "kpi-tile__trend--flat");
  if (direction === "up") el.classList.add("kpi-tile__trend--up");
  else if (direction === "down") el.classList.add("kpi-tile__trend--down");
  else el.classList.add("kpi-tile__trend--flat");
}

function describeTrend(curr, prev) {
  if (!Number.isFinite(prev)) return { text: "", direction: "flat" };
  const delta = curr - prev;
  if (delta === 0) return { text: "▬ no change", direction: "flat" };
  const sign = delta > 0 ? "▲" : "▼";
  return {
    text: `${sign} $${Math.abs(Math.round(delta)).toLocaleString()}`,
    direction: delta > 0 ? "up" : "down"
  };
}

// ─── Daily statements (AB#714): the books the server closes at 00:00 UTC (AB#713) ─────
import { statementHtml, statementDayOptionsHtml, statementsEmptyHtml, statementsToSeries } from "./statements.js";
import { setStatementSeries } from "./charts.js";

const STATEMENT_DAY_MS = 24 * 60 * 60 * 1000;
const statementsState = { data: null, loadedForDay: null, selectedDay: null, loading: false };

/** Fetch the closed days and render them. Runs when the Financial Core opens, and again once a new day has closed. */
async function loadStatements() {
  if (!appState.accountId || statementsState.loading) return;
  statementsState.loading = true;
  try {
    const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/finances/statements`);
    statementsState.data = await parseJsonResponse(response);
    statementsState.loadedForDay = Math.floor(Date.now() / STATEMENT_DAY_MS);
    renderStatements();
  } catch (err) {
    const body = document.getElementById("statement-body");
    if (body) body.innerHTML = `<p class="muted">The statements could not be loaded: ${escapeHtml(err.message || "try again shortly")}.</p>`;
  } finally {
    statementsState.loading = false;
  }
}

function renderStatements() {
  const body = document.getElementById("statement-body");
  const picker = document.getElementById("statement-day");
  if (!body || !picker || !statementsState.data) return;
  const statements = Array.isArray(statementsState.data.statements) ? statementsState.data.statements : [];
  setStatementSeries(statementsToSeries(statements));
  const pickerLabel = picker.closest("label");
  if (!statements.length) {
    if (pickerLabel) pickerLabel.hidden = true;
    body.innerHTML = statementsEmptyHtml(statementsState.data.today);
    return;
  }
  // Yesterday by default (the newest closed day); a day chosen earlier stays chosen while it is kept.
  const chosen = statements.find((s) => s.day === statementsState.selectedDay) || statements[0];
  statementsState.selectedDay = chosen.day;
  picker.innerHTML = statementDayOptionsHtml(statements, chosen.day);
  if (pickerLabel) pickerLabel.hidden = false;
  body.innerHTML = statementHtml(chosen);
}

document.getElementById("statement-day")?.addEventListener("change", (event) => {
  statementsState.selectedDay = event.target.value;
  renderStatements();
});

/** A day has closed since the statements were loaded: load them again (checked on each finance update). */
function refreshStatementsIfDayClosed() {
  if (statementsState.loadedForDay === null) return;
  if (Math.floor(Date.now() / STATEMENT_DAY_MS) !== statementsState.loadedForDay) loadStatements();
}

function renderFinanceDashboard(finances) {
  if (!finances) return;
  const credits = Number(finances.credits) || 0;
  const assets = Number(finances.assets) || 0;
  const dailyRevenue = Number(finances.dailyRevenue) || 0;
  const dailyCosts = Number(finances.dailyCosts) || 0;
  // Bug #1022: the cost side is what was booked in the last 24 hours, not the payroll rate.
  const dailyExpenses = Number(finances.dailyExpenses) || 0;
  const inventory = Number(finances.inventoryValue) || 0;
  const netFlow = dailyRevenue - dailyExpenses;
  const snaps = Array.isArray(finances.snapshots) ? finances.snapshots : [];
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const liabilities = latest ? latest.liabilities : Math.round(dailyCosts * 7);
  const netWorth = credits + assets + inventory - liabilities;

  setKpi("kpi-net-worth", `$${fmtCredits(netWorth)}`);
  setKpi("kpi-credits", `$${fmtCredits(credits)}`);
  setKpi(
    "kpi-net-flow",
    `${netFlow >= 0 ? "+" : "-"}$${Math.abs(Math.round(netFlow)).toLocaleString()}/day`,
    { tone: netFlow >= 0 ? "positive" : "negative" }
  );
  setKpi("kpi-revenue", `$${fmtCredits(dailyRevenue)}`);
  setKpi("kpi-costs", `$${fmtCredits(dailyExpenses)}`);

  let runwayLabel;
  if (dailyExpenses <= 0) runwayLabel = "∞";
  else runwayLabel = `${(credits / dailyExpenses).toFixed(1)} d`;
  setKpi("kpi-runway", runwayLabel);

  const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
  const nwTrend = describeTrend(netWorth, prev ? prev.netWorth : NaN);
  setTrend("kpi-net-worth-trend", nwTrend.text, nwTrend.direction);
  const credTrend = describeTrend(credits, prev ? prev.credits : NaN);
  setTrend("kpi-credits-trend", credTrend.text, credTrend.direction);

  const meta = document.getElementById("finance-last-snapshot");
  if (meta) meta.textContent = latest ? fmtTimestamp(latest.t) : "no snapshots yet";

  renderPnlTable(finances);
  renderBalanceTable(finances, { credits, assets, inventory, liabilities, netWorth });
}

function renderPnlTable(finances) {
  const table = document.getElementById("finance-pnl-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const tfoot = table.querySelector("tfoot");
  if (!tbody || !tfoot) return;

  const income = finances.incomeBySource || {};
  const expenses = finances.expensesByCategory || {};
  const lifetimeRevenue = Number(finances.lifetimeRevenue) || 0;
  const lifetimeCosts = Number(finances.lifetimeCosts) || 0;
  const net = lifetimeRevenue - lifetimeCosts;

  const incomeRows = Object.entries(income)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const expenseRows = Object.entries(expenses)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  const rowsHtml = [];
  rowsHtml.push(`<tr><th colspan="2" style="color:#6cf0c2">Revenue</th></tr>`);
  if (incomeRows.length === 0) {
    rowsHtml.push(`<tr><td>—</td><td class="num">0</td></tr>`);
  } else {
    for (const [k, v] of incomeRows) {
      rowsHtml.push(`<tr><td>${escapeHtml(prettifyLedgerLabel(k))}</td><td class="num num--positive">+${fmtCredits(v)}</td></tr>`);
    }
  }
  rowsHtml.push(`<tr><th colspan="2" style="color:#f0a06a">Expenses</th></tr>`);
  if (expenseRows.length === 0) {
    rowsHtml.push(`<tr><td>—</td><td class="num">0</td></tr>`);
  } else {
    for (const [k, v] of expenseRows) {
      rowsHtml.push(`<tr><td>${escapeHtml(prettifyLedgerLabel(k))}</td><td class="num num--negative">−${fmtCredits(v)}</td></tr>`);
    }
  }
  tbody.innerHTML = rowsHtml.join("");

  const netClass = net >= 0 ? "num--positive" : "num--negative";
  tfoot.innerHTML = `
    <tr><td>Lifetime Revenue</td><td class="num num--positive">+${fmtCredits(lifetimeRevenue)}</td></tr>
    <tr><td>Lifetime Costs</td><td class="num num--negative">−${fmtCredits(lifetimeCosts)}</td></tr>
    <tr><td><strong>Net Position</strong></td><td class="num ${netClass}"><strong>${fmtSignedCredits(net)}</strong></td></tr>
  `;
}

function renderBalanceTable(finances, derived) {
  const table = document.getElementById("finance-balance-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const tfoot = table.querySelector("tfoot");
  if (!tbody || !tfoot) return;

  const { credits, assets, inventory, liabilities, netWorth } = derived;
  const dailyRevenue = Number(finances.dailyRevenue) || 0;
  const dailyCosts = Number(finances.dailyCosts) || 0;
  const dailyExpenses = Number(finances.dailyExpenses) || 0;
  const forwardOps = Math.round(dailyCosts * 7);
  // Bug #1097: wages owed are their own line, not part of the lease figure; payroll is charged, at this rate.
  const payrollOwed = Math.max(0, Math.round(Number(finances.payrollArrears) || 0));
  const leaseShare = Math.max(0, liabilities - forwardOps - payrollOwed);
  const staff = Math.max(0, Math.floor(Number(appState.data?.corp?.employeeCount) || 0));

  tbody.innerHTML = `
    <tr><th colspan="2" style="color:#6cf0c2">Assets</th></tr>
    <tr><td>Liquid Credits</td><td class="num">${fmtCredits(credits)}</td></tr>
    <tr><td>Facilities &amp; Probes</td><td class="num">${fmtCredits(assets)}</td></tr>
    <tr><td>Inventory (at standing bids)</td><td class="num">${fmtCredits(inventory)}</td></tr>
    <tr><th colspan="2" style="color:#f0a06a">Liabilities</th></tr>
    <tr><td>Forward Operating (7d)</td><td class="num">${fmtCredits(forwardOps)}</td></tr>
    <tr><td>Lease Commitments</td><td class="num">${fmtCredits(leaseShare)}</td></tr>
    ${payrollOwed > 0 ? `<tr><td>Payroll Owed</td><td class="num num--negative">${fmtCredits(payrollOwed)}</td></tr>` : ""}
    <tr><th colspan="2" style="color:#89a7bd">Operating Profile</th></tr>
    <tr><td>Daily Revenue</td><td class="num num--positive">+${fmtCredits(dailyRevenue)}</td></tr>
    <tr><td>Daily Costs</td><td class="num num--negative">−${fmtCredits(dailyExpenses)}</td></tr>
    <tr><td>Payroll (${staff} staff × 150 a day)</td><td class="num num--negative">−${fmtCredits(staff * 150)}</td></tr>
  `;

  const nwClass = netWorth >= 0 ? "num--positive" : "num--negative";
  tfoot.innerHTML = `
    <tr><td>Total Assets</td><td class="num num--positive">${fmtCredits(credits + assets + inventory)}</td></tr>
    <tr><td>Total Liabilities</td><td class="num num--negative">−${fmtCredits(liabilities)}</td></tr>
    <tr><td><strong>Net Worth</strong></td><td class="num ${nwClass}"><strong>${fmtSignedCredits(netWorth)}</strong></td></tr>
  `;
}


function updateOverview(data) {
  const cards = [];

  // ISP-298 (AB#1791): a corporation the Salvage Assignment is offered to, or already working it, is told so
  // here — the first thing on Overview — rather than left to find Assignments unprompted (T-078). Matched by
  // kind, not id: the offer and the active copy are the same contract, materialized from ECONOMY.salvage
  // (server/game/corporation.js), and there is currently exactly one time-served contract shape.
  const salvageOffer = (data.corp?.contractOfferings?.missions || []).find((m) => m.kind === "time-served");
  const salvageActive = (data.corp?.activeMissions || []).find((m) => m.kind === "time-served");
  if (salvageActive) {
    const remaining = salvageRemainingMs(salvageActive);
    cards.push({
      title: "ISA Salvage Assignment",
      value: remaining > 0 ? `${formatDurationHours(remaining)} remaining` : "Ready to report",
      body: remaining > 0
        ? "Reporting for documented salvage work. Return to Assignments once your time is served to collect payment."
        : "Your time is served. Report to Assignments to collect payment.",
      jump: "missions"
    });
  } else if (salvageOffer) {
    cards.push({
      title: "ISA Salvage Assignment",
      value: "Available",
      body: "The Bureau is offering emergency salvage work: no funds to lose and nothing left to sell. See Assignments.",
      jump: "missions"
    });
  }

  cards.push(
    {
      title: "Cash Reserves",
      value: toCurrency(data.corp.finances.credits),
      body: "Total corporate credits on hand."
    },
    {
      title: "Net Daily Flow",
      value: toCurrency((Number(data.corp.finances.dailyRevenue) || 0) - (Number(data.corp.finances.dailyExpenses) || 0)),
      body: "Income minus costs booked in the last 24 hours. This drives long-horizon compounding over years."
    },
    {
      title: "Conglomerate Status",
      value: (() => {
        const playerCong = (data.conglomerates || []).find((c) => c.id === data.corp?.conglomerateId);
        return playerCong ? `${playerCong.name} — ${playerCong.memberCount} / ${playerCong.maxMembers} members` : "Independent";
      })(),
      body: (() => {
        const playerCong = (data.conglomerates || []).find((c) => c.id === data.corp?.conglomerateId);
        return playerCong
          ? "Alliance scaling path: early groups stay small and unlock higher membership over time."
          : "You are not affiliated with a conglomerate. Joining one unlocks pooled resources, co-ownership, and alliance operations.";
      })()
    },
    {
      title: "Military Power",
      value: `${data.corp.military.attackValue} ATK / ${data.corp.military.defenseValue} DEF`,
      body: "Deterministic baseline before unit counters, R&D multipliers, and leadership effects."
    }
  );

  const wrap = document.getElementById("overview-cards");
  wrap.innerHTML = cards
    .map(
      // Bug #691 audit: the Conglomerate card's value carries a player-chosen conglomerate name.
      (card) => `
      <section class="data-card"${card.jump ? ` data-jump="${card.jump}" role="button" tabindex="0" style="cursor:pointer"` : ""}>
        <h3>${escapeHtml(card.title)}</h3>
        <p><strong>${escapeHtml(card.value)}</strong></p>
        <p class="muted">${escapeHtml(card.body)}</p>
      </section>
    `
    )
    .join("");
}

function renderLevel2Progress(data) {
  const requirementsWrap = document.getElementById("level2-requirements");
  const status = document.getElementById("level2-status");
  const title = document.getElementById("level-requirements-title");
  const lede = document.getElementById("level-requirements-lede");

  if (!requirementsWrap || !status) {
    return;
  }

  // AB#1056: early on, the next milestones are the first thing on the Overview, above the brief and the stat cards
  const milestonesSection = requirementsWrap.closest("section.form-card");
  const overviewPanel = document.getElementById("overview");
  const expeditionPanel = document.getElementById("expedition-panel");
  if (milestonesSection && overviewPanel && expeditionPanel) {
    const first = milestonesFirst(data?.corp?.level);
    const isFirst = overviewPanel.firstElementChild === milestonesSection;
    if (first && !isFirst) overviewPanel.prepend(milestonesSection);
    if (!first && isFirst) expeditionPanel.after(milestonesSection);
  }

  // Map requirement IDs to the tab they should navigate to
  // TODO(AB#798): This information should be stored in the database OR in milestones.json
  const REQ_TAB = {
    officeRented:               "station",
    hire5:                      "station",
    hire10:                     "station",
    hire15:                     "station",
    hire25:                     "station",
    marsLease:                  "station",
    secondLease:                "station",
    lunaLease:                  "station",
    extractor:                  "station",
    extractor2:                 "station",
    extractor3:                 "station",
    mine300:                    "station",
    researchBasicExtraction:    "rnd",
    researchIndustrialSafety:   "rnd",
    researchEnergyRouting:      "rnd",
    sell300Silicate:            "market",
    sell50000Silicate:          "market",
    missions25:                 "missions",
    // Levels 6 to 10 since Bug #424
    assemblyFacility:           "station",
    refinery:                   "refinery",
    expeditions3:               "starmap",
    expeditions10:              "starmap",
    refine1000:                 "refinery",
    refine10000:                "refinery",
    sell100000Silicate:         "market",
    researchAssemblyFabrication: "rnd",
    researchAsteroidProspecting: "rnd",
    researchMaterialCompression: "rnd",
    researchNanoLattice:        "rnd",
    researchNearStarNavigation: "rnd"
  };

  const level = Number(data?.corp?.level || 0);
  const nextLevel = level + 1;
  const nextKey = `level${nextLevel}`;
  const nextProgress = data?.corp?.levelProgress?.[nextKey];

  // Bug #424: the top of the ladder is reachable now, so say it is the top rather than offer a level that does not exist.
  const levelCap = Number(data?.corp?.levelCap || 0);
  if (levelCap && level >= levelCap) {
    if (title) title.textContent = `Corporation Level ${level}: the top of this build`;
    if (lede) lede.textContent = `You have reached the highest level this build defines. Levels ${levelCap + 1} to 40 are planned for a later version.`;
    requirementsWrap.innerHTML = "";
    status.textContent = "";
    return;
  }

  if (title) {
    title.textContent = `Corporation Level ${nextLevel} Milestones`;
  }
  if (lede) {
    lede.textContent = `Complete these requirements to advance from Level ${level} to Level ${nextLevel}.`;
  }

  if (!nextProgress?.requirements?.length) {
    requirementsWrap.innerHTML =
      '<section class="data-card"><p class="muted">No additional level requirements are currently defined for this profile.</p></section>';
    status.textContent = "";
    return;
  }

  requirementsWrap.innerHTML = nextProgress.requirements
    .map((req) => {
      const doneClass = req.complete ? " requirement-done" : "";
      const reqId = `${nextKey}:${req.id}`;
      const justCompletedClass =
        appState.requirementsInitialized && req.complete && !appState.completedRequirementIds.has(reqId)
          ? " just-completed"
          : "";
      if (req.complete) {
        appState.completedRequirementIds.add(reqId);
      }
      // AB#1061: a lease milestone leads to the station that files its body, by way of the Starmap when docked elsewhere
      const link = requirementLink(req, data?.corp?.currentStationId || null, appState.stationRegistry, REQ_TAB[req.id]);
      const jumpAttr = link ? ` data-jump="${link.tab}"` : "";
      const clickable = link && !req.complete ? " requirement-clickable" : "";
      return `
      <section class="data-card requirement-card${doneClass}${justCompletedClass}${clickable}"${jumpAttr}>
        <h3 class="requirement-title">${req.title}</h3>
        <p><strong>${req.progress} / ${req.target}</strong></p>
        <p class="muted requirement-state">${req.complete ? "Completed" : link ? escapeHtml(link.label) : "In Progress"}</p>
        ${!req.complete && link?.hint ? `<p class="muted requirement-hint">${escapeHtml(link.hint)}</p>` : ""}
      </section>
      `;
    })
    .join("");

  status.textContent = `Complete the requirements above to advance from Corporation Level ${level} to ${nextLevel}.`;
  appState.requirementsInitialized = true;
}

function cycleProgressPercent(extractor) {
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
function salvageRemainingMs(mission, now = Date.now()) {
  const requiredMs = Number(mission?.hoursRequired || 0) * 3_600_000;
  const elapsedMs = now - Number(mission?.acceptedAt || 0);
  return requiredMs - elapsedMs;
}

// ISP-297 (AB#1789) gave the Salvage Assignment risk: "None" — a real fourth value this ternary did not have a
// class for, which fell through to risk-high and painted a riskless contract red. Named so a future risk value
// fails the same way loudly (a blank badge) rather than quietly inheriting "high".
function missionRiskClass(risk) {
  if (risk === "Low") return "risk-low";
  if (risk === "Medium") return "risk-med";
  if (risk === "High") return "risk-high";
  if (risk === "None") return "risk-none";
  return "risk-high";
}

function isExtractorCycleActive(extractor, now = Date.now()) {
  const startedAt = Number(extractor?.startedAt || 0);
  const endsAt = Number(extractor?.endsAt || 0);
  if (!extractor?.active || !startedAt || !endsAt) {
    return false;
  }
  return now < endsAt;
}

function stopMiningUiTicker() {
  if (appState.miningUiTicker) {
    clearInterval(appState.miningUiTicker);
    appState.miningUiTicker = null;
  }
}

function startMiningUiTicker() {
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
    const buildingTitle = document.querySelector("#station-building-content .building-detail-header h2");
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

function renderMiningCyclePanel(data) {
  const list = document.getElementById("mine-cycle-list");
  if (!list) {
    return;
  }

  const extractors = data?.corp?.mining?.silicateExtractors || [];
  if (!extractors.length) {
    list.innerHTML = `<article class="queue-item"><p class="muted">No extractor yard records found.</p></article>`;
    return;
  }

  list.innerHTML = extractors
    .map((extractor) => {
      const progress = cycleProgressPercent(extractor);
      const active = isExtractorCycleActive(extractor);
      const remainingMs = active ? Math.max(0, Number(extractor.endsAt || 0) - Date.now()) : 0;
      const hours = active && extractor.startedAt && extractor.endsAt
        ? Math.max(1, Math.round((Number(extractor.endsAt) - Number(extractor.startedAt)) / (1000 * 60 * 60)))
        : 0;

      return `
        <article class="queue-item">
          <h3>${escapeHtml(extractor.name || extractor.id || "Extractor Yard")}</h3>
          <p class="muted">Status: ${active ? "Active" : "Idle"}</p>
          <p class="muted">Total mined: ${Number(extractor.totalMined || 0).toLocaleString()} | Total spent: ${toCurrency(Number(extractor.totalSpent || 0))}</p>
          ${
            active
              ? `<p class="muted">Running ${hours}h cycle at ${Number(extractor.throughputPerHour || 0)}/hour. Remaining: ${formatDurationHours(remainingMs)}.</p>
                 <div class="progress-wrap"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>`
              : `<p class="muted">Ready for next cycle.</p>`
          }
        </article>
      `;
    })
    .join("");
}

/**
 * ISP-86: what an hour at this rate earns after its running cost, and what the best rate would be. Rendered into
 * the extractor row itself, because the row is rewritten whenever a cycle ticks and anything written to it
 * afterwards is wiped by the next rewrite.
 */
function mineProjectionText(rate) {
  const economy = appState.economy;
  if (!economy?.operations) return "";
  const efficiency = miningEfficiencyOf(appState.data?.corp);
  const at = miningProjection(rate, { operations: economy.operations, unitPrice: economy.silicateUnitPrice, taxPct: economy.salesTaxPct, efficiency });
  const best = bestThroughput({ operations: economy.operations, unitPrice: economy.silicateUnitPrice, taxPct: economy.salesTaxPct, efficiency });
  const net = at.profitPerHour >= 0 ? `nets ${toCurrency(at.profitPerHour)}/hour` : `loses ${toCurrency(Math.abs(at.profitPerHour))}/hour`;
  return `At ${rate} t/h: earns ${toCurrency(at.revenuePerHour)}/hour, costs ${toCurrency(at.costPerHour)}/hour, ${net}. `
    + (best.throughputPerHour === rate
      ? "That is the best rate for your research."
      : `Best for your research: ${best.throughputPerHour} t/h, netting ${toCurrency(best.profitPerHour)}/hour.`);
}

/** What the corporation's research multiplies an hour of extraction by (ISP-86; the server applies the same two). */
function miningEfficiencyOf(corp) {
  const tech = corp?.unlockedTech || [];
  let efficiency = 1;
  if (tech.includes("tt-basic-extraction")) efficiency *= 1.1;
  if (tech.includes("tt-supply-forecast")) efficiency *= 1.06;
  return efficiency;
}

function renderResearchSelectionDetails(data) {
  const select = document.getElementById("rnd-select");
  const details = document.getElementById("rnd-selected-details");
  if (!select || !details) {
    return;
  }

  const node = getTechNode(select.value);
  if (!node) {
    details.textContent = "No available research nodes meet current prerequisites.";
    return;
  }

  const prereqLabel = node.prereqs.length ? node.prereqs.map((id) => getTechNode(id)?.name || id).join(", ") : "None";
  details.textContent = `${node.name} costs ${toCurrency(node.costCredits)} credits, runs for ${node.durationHours}h, and requires: ${prereqLabel}.`;
}

function queueProgress(item) {
  if (!item.startedAt) {
    return 0;
  }
  const elapsedHours = (Date.now() - item.startedAt) / (1000 * 60 * 60);
  return Math.max(0, Math.min(100, (elapsedHours / item.durationHours) * 100));
}

function renderQueue(elId, queue, subtitle) {
  const el = document.getElementById(elId);
  if (!queue.length) {
    el.innerHTML = `<article class="queue-item"><p>No queued items yet.</p><p class="muted">${escapeHtml(subtitle)}</p></article>`;
    return;
  }

  if (elId === "rnd-queue") {
    el.innerHTML = rndQueueHtml(queue, subtitle);
    return;
  }

  el.innerHTML = queueItemsHtml(queue, subtitle, {
    progressOf: queueProgress,
    remainingLabel: (item) => {
      const remainingMs = Math.max(0, (item.startedAt + item.durationHours * 3_600_000) - Date.now());
      const rHrs = Math.floor(remainingMs / 3_600_000);
      const rMins = Math.floor((remainingMs % 3_600_000) / 60_000);
      return remainingMs > 0 ? `${rHrs}h ${rMins}m remaining` : "Completing...";
    },
    formatCredits: toCurrency
  });
}

// Corporate R&D researches one technology at a time (Bug #1258): an item behind another is "Queued, starts in ...".
// Scheduled on a copy, so a queue saved before the fix shows the order the server will run it in.
function rndQueueHtml(queue, subtitle) {
  const now = Date.now();
  const scheduled = scheduleRndQueue(queue.map((item) => ({ ...item })), now);
  return queueItemsHtml(scheduled, subtitle, {
    progressOf: (item) => (rndItemStatus(item, now).state === "queued" ? 0 : queueProgress(item)),
    remainingLabel: (item) => {
      const status = rndItemStatus(item, now);
      if (status.state === "queued") return `Queued, starts in ${formatHoursMinutes(status.startsInMs)}`;
      return status.state === "running" ? `${formatHoursMinutes(status.remainingMs)} remaining` : "Completing...";
    },
    statusOf: (item) => (rndItemStatus(item, now).state === "queued" ? "Queued" : "In progress"),
    formatCredits: toCurrency
  });
}
// TODO(AB#824): Remove duplicate. This should be stored in the database
const RESOURCE_CATALOG = [
  "Silicates", "Helium-3", "Nickel", "Titanium", "Carbon",
  "Water Ice", "Rare Earths", "Thorium", "Hydrogen", "Lithium",
  "Cobalt", "Uranium", "Exotic Matter"
];
// TODO(AB#798): Remove. This is defined within gameState.js but should be fetched from the DB or from milestones.json
const MILESTONE_ROADMAP = [
  "Rent an Office", "Hire 5 Employees", "Reached Corporation Level 1",
  "Purchase a Mining Lease", "Build a Basic Extractor Yard", "Mine 300 Silicate",
  "Reached Corporation Level 2", "Sell 300 Silicate on the Galactic Exchange",
  "Research Basic Extraction Analytics", "Reached Corporation Level 3",
  "Build a Second Extractor Yard", "Hire 10 Employees", "Research Industrial Safety Protocols",
  "Sell 50,000 Silicate", "Reached Corporation Level 4", "Research High-Density Energy Routing",
  "Purchase a Second Mining Lease", "Build a Third Extractor Yard", "Hire 15 Employees",
  "Reached Corporation Level 5", "Research Ferric Core Extraction Facility", "Hire 25 Employees",
  "Build a Ferric Mining Complex", "Reached Corporation Level 6",
  "Research Multi-Stage Refinery Protocols", "Build a Refinery Complex",
  "Reached Corporation Level 7", "Manufacture 5,000 Iron-Silicate Alloys",
  "Complete 25 Missions", "Reached Corporation Level 8",
  "Research Cryo-genic Vapor Extraction Theory", "Purchase a Mining Claim on Luna",
  "Build a Cryo-vapor Extractor Array", "Sell 500 Cryo-Silicate Foam",
  "Sell 500 Hydrated Ferric Compounds", "Reached Corporation Level 9",
  "Research Carbonaceous Slurry Recovery Theory", "Purchase a Mining Claim on an Asteroid Belt",
  "Research Asteroid Belt Mining Protocols", "Start a Belt Mining Operation",
  "Sell 500 Carbon Silicate Composites", "Sell 500 Carbo-Iron Alloys",
  "Sell 500 Hydro-Carbon Emulsion Base", "Research Extrasolar Expansion Protocols",
  "Reached Corporation Level 10"
];

// Next to its caller, not in the block at the top, where branches adding imports collide (Bug #1254).
import { refineryBuildButtonHtml } from "./html.js";

function renderRefinery(data) {
  const catalog = document.getElementById("resource-catalog");
  catalog.innerHTML = RESOURCE_CATALOG.map((res) => `<span class="pill">${escapeHtml(res)}</span>`).join("");

  const refineries = data.corp?.refineries || [];
  const corp = data.corp || {};
  const unlockedTech = new Set(data.corp?.unlockedTech || []);
  const stationId = data.corp?.currentStationId || "earth-station-prime";
  const inventoryByStation = data.corp?.inventory || {};
  const inventory = inventoryByStation[stationId] || {};
  const buildings = Array.isArray(corp.buildings) ? corp.buildings : [];
  const buildingSlots = Number(corp.buildingSlots || 2);
  const hasOpenBuildingSlot = buildings.length < buildingSlots;
  const hasRefinery = refineries.length > 0;
  const MAX_REFINERIES = 2;
  const belowRefineryCap = refineries.length < MAX_REFINERIES;
  const canBuildRefinery = unlockedTech.has("tt-material-compression") && unlockedTech.has("tt-nano-lattice");
  const refineryStatus = appState.refineryStatus;

  // ── Active Runs ──
  const refineryChains = data.world?.refineryChains || [];

  const activeEl = document.getElementById("refinery-active-runs");
  const activeRefineries = refineries.filter((r) => r.active);
  if (!activeRefineries.length) {
    activeEl.innerHTML = `<article class="queue-item"><p class="muted">${hasRefinery ? "No active refinery cycles. Start a production run below." : "Build a Refinery to begin processing raw materials."}</p></article>`;
  } else {
    activeEl.innerHTML = activeRefineries.map((ref) => {
      const chain = refineryChains.find((c) => c.id === ref.chainId);
      const progress = cycleProgressPercent(ref);
      const remainingMs = Math.max(0, Number(ref.endsAt || 0) - Date.now());
      const scale = Math.max(1, Number(ref.cycleScale || 1));
      const totalInput = chain ? Number(chain.inputQuantityPerCycle || 100) * scale : 0;
      const outputLabel = chain
        ? chain.outputs.map((o) => `${(Number(o.quantityPerCycle) || 0) * scale} ${o.item}`).join(", ")
        : "Unknown";
      // Bug #692: outputs land where the inputs came from, whatever station the corporation is at when the cycle ends.
      const deliveryStation = (appState.stationRegistry || []).find((s) => s.id === ref.stationId);
      const deliveryLabel = deliveryStation?.name || ref.stationId || "an unknown station";
      return `
        <article class="queue-item">
          <h3>${escapeHtml(ref.name)}</h3>
          <p class="muted">Processing: ${chain ? `${totalInput.toLocaleString()} ${escapeHtml(chain.input)}` : "Unknown"} → ${escapeHtml(outputLabel)}</p>
          <p class="muted">Delivers to: ${escapeHtml(deliveryLabel)}</p>
          <p class="muted">Remaining: ${formatDurationHours(remainingMs)} (${progress.toFixed(1)}%)</p>
          <div class="progress-wrap"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
        </article>
      `;
    }).join("");
  }

  // ── Available Chains ──
  const chainsEl = document.getElementById("refinery-chains");
  // Capture which refine-quantity input has focus (and its caret) so we can
  // restore it after re-rendering — otherwise periodic re-renders steal focus.
  const focusedInput = document.activeElement && document.activeElement.classList?.contains("refine-quantity-input")
    ? {
        id: document.activeElement.id,
        selStart: document.activeElement.selectionStart,
        selEnd: document.activeElement.selectionEnd
      }
    : null;
  const statusHtml = refineryStatus?.text
    ? `<article class="queue-item"><p class="muted" style="color:${refineryStatus.type === "ok" ? "var(--color-accent)" : "var(--color-warn)"}">${escapeHtml(refineryStatus.text)}</p></article>`
    : "";

  chainsEl.innerHTML = statusHtml + refineryChains
    .map((chain) => {
      const techGated = Array.isArray(chain.requiresTechIds) && !chain.requiresTechIds.every((t) => unlockedTech.has(t));
      const outputLabel = Array.isArray(chain.outputs)
        ? chain.outputs.map((o) => typeof o === "string" ? o : `${o.quantityPerCycle} ${o.item}`).join(", ")
        : String(chain.outputs);
      const inputAvailable = Number(inventory[chain.input] || 0);
      const perCycle = Number(chain.inputQuantityPerCycle || 100);
      // Whole batches, at least 100 units: the rule start-refinery checks too (refineQuantity.js).
      const minQty = refineMinimum(perCycle);
      const hasInput = inputAvailable >= minQty;
      const idleRefinery = refineries.find((r) => !r.active);
      const canStart = hasRefinery && !techGated && hasInput && idleRefinery;
      // Default the quantity input to whichever is larger: the minimum, or as
      // much of the player's stock as fits in whole batches.
      const computedDefault = Math.max(minQty, Math.floor(inputAvailable / perCycle) * perCycle || minQty);
      // What the player typed stays as typed, blank included (AB#1255); Start Run checks it and refuses, not the render.
      const fieldValue = refineQuantityFieldValue(appState.refineQuantityOverrides[chain.id], computedDefault);
      const quantityError = appState.refineQuantityErrors[chain.id];
      const inputId = `refine-qty-${chain.id}`;

      return `
        <section class="data-card">
          <h3>${escapeHtml(chain.input)} Refining</h3>
          <p class="muted">${perCycle} ${escapeHtml(chain.input)} per batch → ${escapeHtml(outputLabel)}</p>
          <p class="muted">Cycle: ${chain.cycleDurationHours || "?"}h per batch</p>
          ${techGated
            // ISP-292 (AB#1761): a requirement not yet met, not a warning — the muted token, not amber.
            ? `<p class="muted">Requires: ${escapeHtml((chain.requiresResearch || []).join(", "))}</p>`
            : `<p class="muted" style="color:var(--color-accent)">Research: ✓ Unlocked</p>`
          }
          <p class="muted">Inventory: ${inputAvailable.toLocaleString()} ${escapeHtml(chain.input)}${!hasInput && !techGated ? ` (need ${minQty})` : ""}</p>
          ${canStart
            ? `<div class="refine-quantity-row" style="display:flex;gap:0.5rem;align-items:center;margin:0.5rem 0;">
                <label for="${escapeHtml(inputId)}" class="muted" style="font-size:0.85rem;">Quantity</label>
                <input id="${escapeHtml(inputId)}" class="refine-quantity-input" type="number"
                  min="${minQty}" step="${perCycle}" value="${escapeHtml(fieldValue)}"
                  data-chain-id="${escapeHtml(chain.id)}"
                  style="width:9rem;padding:0.3rem 0.5rem;background:var(--color-bg-deep);border:1px solid var(--color-border);color:var(--color-text);border-radius:4px;" />
                <span class="muted" style="font-size:0.8rem;">min ${minQty}, step ${perCycle}</span>
              </div>
              ${quantityError ? `<p class="refine-quantity-error" role="alert" style="color:var(--warn);margin:0 0 0.5rem;">${escapeHtml(quantityError)}</p>` : ""}
              <button class="btn btn-accent refinery-start-btn" data-chain-id="${escapeHtml(chain.id)}" data-refinery-id="${escapeHtml(idleRefinery.id)}" data-quantity-input="${escapeHtml(inputId)}" data-per-cycle="${perCycle}" data-input="${escapeHtml(chain.input)}" data-available="${inputAvailable}" data-hours="${Number(chain.cycleDurationHours) || 0}">Start Run</button>`
            : belowRefineryCap && canBuildRefinery
              ? refineryBuildButtonHtml({ hasRefinery, used: buildings.length, slots: buildingSlots })
              : !hasRefinery && !canBuildRefinery
                // ISP-292 (AB#1761): a requirement not yet met, not a warning — the muted token, not amber.
                ? `<p class="muted">Refinery construction requires: Material Compression I and Nano-Lattice Weaving research.</p>`
                : hasRefinery && !idleRefinery
                  ? `<p class="muted" style="color:var(--color-warn)">All refineries busy.</p>`
                  : ""
          }
        </section>
      `;
    })
    .join("");

  // ── Event delegation for start/build ──
  // Track quantity edits so re-renders (every few seconds) don't blow them away.
  chainsEl.oninput = (e) => {
    const qty = e.target.closest(".refine-quantity-input");
    if (!qty) return;
    const chainId = qty.getAttribute("data-chain-id");
    if (!chainId) return;
    appState.refineQuantityOverrides[chainId] = qty.value;
    delete appState.refineQuantityErrors[chainId]; // the reason was about the old value
  };

  // Restore focus/caret on the quantity input that was being edited.
  if (focusedInput?.id) {
    const restored = document.getElementById(focusedInput.id);
    if (restored && typeof restored.focus === "function") {
      restored.focus();
      try {
        if (focusedInput.selStart != null && typeof restored.setSelectionRange === "function") {
          restored.setSelectionRange(focusedInput.selStart, focusedInput.selEnd ?? focusedInput.selStart);
        }
      } catch (_) { /* ignore — number inputs don't always allow selection */ }
    }
  }

  chainsEl.onclick = async (e) => {
    const startBtn = e.target.closest(".refinery-start-btn");
    if (startBtn && appState.accountId) {
      const chainId = startBtn.getAttribute("data-chain-id");
      const refineryId = startBtn.getAttribute("data-refinery-id");
      const qtyInputId = startBtn.getAttribute("data-quantity-input");
      const qtyInput = qtyInputId ? document.getElementById(qtyInputId) : null;
      const input = startBtn.getAttribute("data-input");
      // AB#1255: what is in the field, checked and sent as it is, or refused beside it; never replaced by a default.
      const check = refineQuantityCheck(qtyInput ? qtyInput.value : "", {
        perCycle: Number(startBtn.getAttribute("data-per-cycle")),
        input,
        available: Number(startBtn.getAttribute("data-available"))
      });
      if (!check.ok) {
        appState.refineQuantityErrors[chainId] = check.reason;
        updateAllViews();
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      try {
        const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/start-refinery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chainId, refineryId, inputQuantity: check.quantity })
        });
        const account = await parseJsonResponse(response);
        delete appState.refineQuantityOverrides[chainId];
        delete appState.refineQuantityErrors[chainId];
        const hours = Number(startBtn.getAttribute("data-hours")) * check.batches;
        const started = `Refinery run started: ${check.quantity.toLocaleString("en-US")} ${input}, ready in ${hours}h.`;
        appState.refineryStatus = { type: "ok", text: started };
        pushFeedback(started, "ok");
        appState.data = deepClone(account.state);
        appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        updateAllViews();
      } catch (error) {
        startBtn.disabled = false;
        startBtn.textContent = "Start Run";
        appState.refineQuantityErrors[chainId] = error.message;
        pushFeedback(`Refinery error: ${error.message}`, "warn");
        updateAllViews();
      }
      return;
    }

    const buildBtn = e.target.closest(".refinery-build-btn");
    if (buildBtn) {
      const disabledReason = buildBtn.getAttribute("data-disabled-reason");
      if (disabledReason) {
        appState.refineryStatus = { type: "warn", text: disabledReason };
        updateAllViews();
        pushFeedback(`Build error: ${disabledReason}`, "warn");
        return;
      }

      buildBtn.disabled = true;
      buildBtn.textContent = "Building…";
      try {
        if (appState.accountId) {
          const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/build-refinery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        } else {
          const corp = appState.data?.corp;
          if (!corp) {
            throw new Error("Corporation state is unavailable.");
          }

          const unlockedTechSet = new Set(corp.unlockedTech || []);
          if (!unlockedTechSet.has("tt-material-compression") || !unlockedTechSet.has("tt-nano-lattice")) {
            throw new Error("Refinery construction requires Material Compression I and Nano-Lattice Weaving research.");
          }

          const buildings = Array.isArray(corp.buildings) ? corp.buildings : (corp.buildings = []);
          const buildingSlots = Number(corp.buildingSlots || 2);
          if (buildings.length >= buildingSlots) {
            throw new Error(`Refinery requires 1 open building slot. Current usage: ${buildings.length}/${buildingSlots}.`);
          }

          if (!corp.finances || typeof corp.finances !== "object") {
            corp.finances = { credits: 0, assets: 0 };
          }
          const buildCost = 75000;
          const assetValue = 55000;
          if (Number(corp.finances.credits || 0) < buildCost) {
            throw new Error(`Refinery construction requires ${toCurrency(buildCost)} credits.`);
          }

          buildings.push({ name: "Refinery", tier: 1, status: "Operational" });

          if (!Array.isArray(corp.refineries)) corp.refineries = [];
          const nextIndex = corp.refineries.length + 1;
          corp.refineries.push({
            id: `ref-${nextIndex}`,
            name: `Refinery #${nextIndex}`,
            tier: 1,
            active: false,
            chainId: null,
            startedAt: null,
            lastTickAt: null,
            endsAt: null,
            cyclesCompleted: 0,
            totalInputConsumed: 0,
            totalOutputProduced: 0
          });

          corp.finances.credits -= buildCost;
          corp.finances.assets = Number(corp.finances.assets || 0) + assetValue;
        }

        appState.refineryStatus = { type: "ok", text: "Refinery commissioned." };
        updateAllViews();
        pushFeedback("Refinery commissioned.", "ok");
      } catch (error) {
        appState.refineryStatus = { type: "warn", text: error.message };
        updateAllViews();
        pushFeedback(`Build error: ${error.message}`, "warn");
      }
    }
  };
}

// renderRefinery's run-size rule, shared with start-refinery (AB#1255). After the function, where no other branch adds.
import { refineMinimum, refineQuantityCheck, refineQuantityFieldValue } from "./refineQuantity.js";

// ─── Assets ──────────────────────────────────────────────────────────────────
function renderAssets(data) {
  const bannerEl = document.getElementById("assets-station-banner");
  if (bannerEl) bannerEl.innerHTML = "";

  const contentEl = document.getElementById("assets-content");
  if (!contentEl) return;

  const allInventory = getAllInventory();
  const stationRegistry = appState.stationRegistry || [];
  const corp = data.corp || {};

  // ── Active sub-tab ──
  const activeTab = contentEl.dataset.activeTab || "inventory";

  // ── Inventory: single consolidated table ──
  // Build flat rows: resource, station, qty  — then aggregate totals
  const resourceMap = {}; // { resourceName: { stationId: qty } }
  for (const st of stationRegistry) {
    const inv = allInventory[st.id] || {};
    for (const [item, qty] of Object.entries(inv)) {
      const q = Number(qty);
      if (q <= 0) continue;
      if (!resourceMap[item]) resourceMap[item] = {};
      resourceMap[item][st.id] = q;
    }
  }

  const resourceNames = Object.keys(resourceMap).sort();
  let inventoryRows = "";
  let grandTotal = 0;
  if (resourceNames.length === 0) {
    inventoryRows = `<tr><td colspan="3" class="assets-empty">No resources in inventory.</td></tr>`;
  } else {
    for (const resource of resourceNames) {
      const stations = resourceMap[resource];
      const stationEntries = Object.entries(stations);
      const total = stationEntries.reduce((s, [, q]) => s + q, 0);
      grandTotal += total;

      // First station row includes the resource name with rowspan
      let first = true;
      for (const [stId, qty] of stationEntries) {
        const st = stationRegistry.find(s => s.id === stId);
        const stName = st?.name || stId;
        if (first) {
          inventoryRows += `<tr>
            <td class="assets-resource-name" rowspan="${stationEntries.length}">${escapeHtml(resource)}</td>
            <td>${escapeHtml(stName)}</td>
            <td class="num">${qty.toLocaleString()}</td>
          </tr>`;
          first = false;
        } else {
          inventoryRows += `<tr>
            <td>${escapeHtml(stName)}</td>
            <td class="num">${qty.toLocaleString()}</td>
          </tr>`;
        }
      }
    }
  }

  const inventoryPanel = `
    <table class="assets-table">
      <thead><tr><th>Resource</th><th>Location</th><th class="num">Qty</th></tr></thead>
      <tbody>${inventoryRows}</tbody>
      ${grandTotal > 0 ? `<tfoot><tr><td colspan="2">Total</td><td class="num">${grandTotal.toLocaleString()}</td></tr></tfoot>` : ""}
    </table>`;

  // ── Infrastructure: offices + leases + extractors in one table ──
  const offices = corp.offices || [];
  const leases = corp.miningLeases || [];
  const extractors = corp.mining?.silicateExtractors || [];

  let infraRows = "";
  // Offices
  const seenStations = new Set();
  for (const o of offices) {
    if (seenStations.has(o.stationId)) continue;
    seenStations.add(o.stationId);
    const st = stationRegistry.find(s => s.id === o.stationId);
    const expired = o.rentedUntil && o.rentedUntil <= Date.now();
    const statusCls = expired ? "expired" : "operational";
    const statusText = expired ? "Expired" : "Active";
    infraRows += `<tr>
      <td>Office Lease</td>
      <td>${escapeHtml(st?.name || o.stationId)}</td>
      <td><span class="building-status-badge ${statusCls}">${statusText}</span></td>
      <td class="muted">—</td>
    </tr>`;
  }

  // Mining leases
  for (const l of leases) {
    const exCount = (l.extractorIds || []).length;
    const leaseExtractors = extractors.filter(ex => ex.leaseId === l.id);
    const totalMined = leaseExtractors.reduce((sum, ex) => sum + Number(ex.totalMined || 0), 0);
    infraRows += `<tr>
      <td>Mining Lease</td>
      <td>${escapeHtml(l.body)}</td>
      <td><span class="building-status-badge operational">Active</span></td>
      <td class="num">${exCount}/${l.buildingSlots || 2} slots · ${totalMined.toLocaleString()} mined</td>
    </tr>`;
  }

  // Extractors — show actual location (lease body) in the location column
  for (const ex of extractors) {
    const status = ex.downtimeActive ? "Downtime" : ex.active ? "Active" : "Idle";
    const statusCls = ex.downtimeActive ? "downtime" : ex.active ? "operational" : "idle";
    // Resolve location with the most authoritative source first:
    //   1. ex.body — stored directly on the extractor (post-fix)
    //   2. lease.body when leaseId resolves
    //   3. lease whose extractorIds list contains us (legacy linkage)
    //   4. nothing → show "Unassigned" rather than silently defaulting to the
    //      first lease, which masks broken leaseId links and frustrates the
    //      player when a yard "moves" between hydrations.
    let locationBody = ex.body || null;
    if (!locationBody) {
      let lease = ex.leaseId ? leases.find(l => l.id === ex.leaseId) : null;
      if (!lease) {
        const stripped = ex.leaseId ? String(ex.leaseId).split("::").pop() : null;
        if (stripped) lease = leases.find(l => String(l.id).split("::").pop() === stripped);
      }
      if (!lease) lease = leases.find(l => Array.isArray(l.extractorIds) && l.extractorIds.includes(ex.id));
      if (lease?.body) locationBody = lease.body;
    }
    const yardName = ex.name || ex.id;
    const locationLabel = locationBody
      ? `${escapeHtml(yardName)} <span class="muted">— ${escapeHtml(locationBody)}</span>`
      : `${escapeHtml(yardName)} <span class="muted" style="color:var(--color-warn)">— Unassigned</span>`;
    infraRows += `<tr>
      <td>Extractor</td>
      <td>${locationLabel}</td>
      <td><span class="building-status-badge ${statusCls}">${status}</span></td>
      <td class="num">${Number(ex.totalMined || 0).toLocaleString()} mined</td>
    </tr>`;
  }

  if (!infraRows) {
    infraRows = `<tr><td colspan="4" class="assets-empty">No infrastructure registered.</td></tr>`;
  }

  const infraPanel = `
    <table class="assets-table">
      <thead><tr><th>Asset</th><th>Location / ID</th><th>Status</th><th class="num">Details</th></tr></thead>
      <tbody>${infraRows}</tbody>
    </table>`;

  // ── Summary bar ──
  const totalResources = resourceNames.length;
  const totalOffices = seenStations.size;
  const totalLeases = leases.length;
  const totalExtractors = extractors.length;

  contentEl.innerHTML = `
    <div class="assets-summary-bar">
      <div class="assets-stat"><span class="assets-stat-value">${grandTotal.toLocaleString()}</span><span class="assets-stat-label">Units Stored</span></div>
      <div class="assets-stat"><span class="assets-stat-value">${totalResources}</span><span class="assets-stat-label">Resource Types</span></div>
      <div class="assets-stat"><span class="assets-stat-value">${totalOffices}</span><span class="assets-stat-label">Offices</span></div>
      <div class="assets-stat"><span class="assets-stat-value">${totalLeases}</span><span class="assets-stat-label">Leases</span></div>
      <div class="assets-stat"><span class="assets-stat-value">${totalExtractors}</span><span class="assets-stat-label">Extractors</span></div>
    </div>

    <nav class="assets-tab-nav">
      <button class="assets-tab-btn${activeTab === "inventory" ? " active" : ""}" data-assets-tab="inventory">Inventory</button>
      <button class="assets-tab-btn${activeTab === "infrastructure" ? " active" : ""}" data-assets-tab="infrastructure">Infrastructure</button>
    </nav>

    <div class="assets-panel-body">
      <div class="assets-panel${activeTab === "inventory" ? " active" : ""}" data-assets-panel="inventory">${inventoryPanel}</div>
      <div class="assets-panel${activeTab === "infrastructure" ? " active" : ""}" data-assets-panel="infrastructure">${infraPanel}</div>
    </div>
  `;

  // Bind tab switching
  contentEl.querySelectorAll(".assets-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.assetsTab;
      contentEl.dataset.activeTab = tab;
      contentEl.querySelectorAll(".assets-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.assetsTab === tab));
      contentEl.querySelectorAll(".assets-panel").forEach(p => p.classList.toggle("active", p.dataset.assetsPanel === tab));
    });
  });
}

// ─── Logistics ───────────────────────────────────────────────────────────────
// AB#717: the transfer rules, fee and history limit come from the module the server enforces them with.
import { MAX_TRANSFER_LINES, transferFee, feePerUnit, transitMinutes, stationHops, describeHops, describeLines } from "./logistics.js";

function renderLogistics(data) {
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

function renderMarket(data) {
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
  const filteredSellOrders = viewOrders(allSellOrders, view).slice(0, 30);
  const filteredNpcOrders = viewOrders(npcBuyOrders, view);
  const mySellOrders = viewOrders(allMySellOrders, view).slice(0, 50);

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
    ? entries.map(([name, qty]) => `<li>${escapeHtml(name)}: ${Number(qty).toLocaleString()}</li>`).join("")
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
  const typeLabel = { listed: "Listed", sold: "Sold", "sold-npc": "Sold (NPC)", bought: "Bought" };
  const typeClass = { listed: "trade-type-listed", sold: "trade-type-sold", "sold-npc": "trade-type-sold", bought: "trade-type-bought" };
  if (tradeHistoryTable) {
    tradeHistoryTable.innerHTML = tradeHistory
      .map(
        (t) => {
          const hasTax = typeof t.taxAmount === "number" && t.taxAmount > 0;
          const totalCell = hasTax
            ? `${toCurrency(t.proceeds)} <span class="trade-tax-note">(${toCurrency(t.taxAmount)} tax)</span>`
            : toCurrency(t.total || 0);
          return `
          <tr>
            <td class="trade-time">${t.at ? formatTime(t.at) : "-"}</td>
            <td><span class="trade-type-badge ${typeClass[t.type] || ""}">${typeLabel[t.type] || t.type}</span></td>
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

/**
 * Bug #1133: the one way a thread from a response enters the client's forums, once, by id (mergeThread). Both copies
 * are updated: updateAllViews copies serverData.forums over data.forums, so a thread added to data alone vanished.
 */
function putForumThread(thread) {
  if (!thread?.id || !appState.data) return;
  for (const holder of [appState.data, appState.serverData]) {
    if (!holder) continue;
    if (!holder.forums) holder.forums = { categories: [], threads: [] };
    holder.forums.threads = mergeThread(holder.forums.threads, thread);
  }
}

function renderForums(data) {
  const overviewView = document.getElementById("forum-overview-view");
  const threadView = document.getElementById("forum-thread-view");

  if (appState.forumsView === "thread") {
    if (overviewView) overviewView.hidden = true;
    if (threadView) threadView.hidden = false;

    const selected = (data.forums?.threads || []).find((t) => t.id === appState.selectedForumThreadId);
    const detailBody = document.getElementById("forum-thread-detail-body");
    if (detailBody && selected) {
      const author = selected.author || "Anonymous";
      const opLikes = Number(selected.likes) || 0;
      const replies = Array.isArray(selected.replies) ? selected.replies : [];
      const myAccountId = appState.accountId || null;
      const opLiked = Boolean(myAccountId && selected.likedByMe); // the server says only whether this account liked it (Bug #1134)
      const initials = (str) => String(str || "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase() || "?";
      const avatarHue = (str) => {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
        return h;
      };
      const opHue = avatarHue(author);
      const opBody = selected.body
        || selected.summary
        || `Filing this thread to consolidate strategy on predatory mineral leases. Recent ISA arbitration cases suggest a narrow window for procedural objections — particularly when the lessor has failed to publish quarterly extraction reports. Would appreciate input from any corporation that has successfully challenged a Tier-2 lease auction in the last 18 months. I am compiling a citation pack for the Sol jurisdiction sub-forum and will share the redacted draft with anyone willing to co-sign.`;

      const repliesHtml = replies.length
        ? replies.map((reply) => {
            const author = reply.author || "Anonymous";
            const hue = avatarHue(author);
            const replyLiked = Boolean(myAccountId && reply.likedByMe);
            return `
              <li class="thread-reply">
                <div class="thread-reply__connector" aria-hidden="true"></div>
                <article class="thread-card thread-card--reply">
                  <header class="thread-card__head">
                    <div class="thread-avatar" style="--avatar-hue:${hue};">${escapeHtml(initials(author))}</div>
                    <div class="thread-card__head-meta">
                      <span class="thread-card__author">${escapeHtml(author)}</span>
                      <span class="thread-card__timestamp">${formatTime(reply.createdAt)}</span>
                    </div>
                    <span class="thread-badge thread-badge--reply">Reply</span>
                  </header>
                  <div class="thread-card__body">
                    ${forumPostBodyHtml(reply.content || "")}
                  </div>
                  <footer class="thread-card__actions">
                    <button class="thread-action-btn" type="button" data-action="reply" data-reply-id="${escapeHtml(reply.id)}">↩ Reply</button>
                    <button class="thread-action-btn" type="button" data-action="quote" data-reply-id="${escapeHtml(reply.id)}">❝ Quote</button>
                    <button class="thread-action-btn thread-action-btn--like${replyLiked ? " is-liked" : ""}" type="button" data-action="like" data-target="reply" data-reply-id="${escapeHtml(reply.id)}" aria-pressed="${replyLiked}">▲ ${replyLiked ? "Liked" : "Like"} <span class="thread-action-count">${Number(reply.likes) || 0}</span></button>
                  </footer>
                </article>
              </li>`;
          }).join("")
        : `<li class="thread-reply thread-reply--empty"><p class="muted">No replies yet. Be the first to weigh in.</p></li>`;

      // Bug #1222: the reply box is part of this HTML, so a re-render (any forum update) emptied a half-written reply.
      // Keep what is in it, where the cursor is and whether it had focus, for the same thread, and put them back below.
      const oldBox = detailBody.querySelector("#forum-reply-content");
      const keptDraft = oldBox && oldBox.closest("form")?.dataset.threadId === selected.id
        ? { value: oldBox.value, start: oldBox.selectionStart, end: oldBox.selectionEnd, focused: document.activeElement === oldBox }
        : null;
      detailBody.innerHTML = `
        <div class="thread-detail">
          <div class="thread-detail__topbar">
            <button id="forum-back-btn-inline" class="thread-back-btn" type="button">← Back to Forums</button>
            <span class="thread-badge thread-badge--category">${escapeHtml((selected.category || "general").toUpperCase())}</span>
          </div>

          <header class="thread-detail__header">
            <h1 class="thread-detail__title">${escapeHtml(selected.title || "Untitled Thread")}</h1>
            <div class="thread-detail__meta">
              <span>Started ${formatTime(selected.createdAt)}</span>
              <span class="thread-meta-dot">•</span>
              <span>${replies.length} repl${replies.length === 1 ? "y" : "ies"}</span>
              <span class="thread-meta-dot">•</span>
              <span>${opLikes} like${opLikes === 1 ? "" : "s"}</span>
            </div>
          </header>

          <article class="thread-card thread-card--op">
            <div class="thread-card__op-tag">Original Post</div>
            <header class="thread-card__head">
              <div class="thread-avatar thread-avatar--op" style="--avatar-hue:${opHue};">${escapeHtml(initials(author))}</div>
              <div class="thread-card__head-meta">
                <span class="thread-card__author">${escapeHtml(author)}</span>
                <span class="thread-card__timestamp">${formatTime(selected.createdAt)}</span>
              </div>
              <span class="thread-badge thread-badge--op">OP</span>
            </header>
            <div class="thread-card__body thread-card__body--op">
              ${forumPostBodyHtml(opBody)}
            </div>
            <footer class="thread-card__actions">
              <button class="thread-action-btn thread-action-btn--primary" type="button" data-action="reply">↩ Reply</button>
              <button class="thread-action-btn" type="button" data-action="quote">❝ Quote</button>
              <button class="thread-action-btn thread-action-btn--like${opLiked ? " is-liked" : ""}" type="button" data-action="like" data-target="thread" aria-pressed="${opLiked}">▲ ${opLiked ? "Liked" : "Like"} <span class="thread-action-count">${opLikes}</span></button>
            </footer>
          </article>

          <section class="thread-replies">
            <h2 class="thread-replies__heading">${replies.length} Repl${replies.length === 1 ? "y" : "ies"}</h2>
            <ol class="thread-reply-list">${repliesHtml}</ol>
          </section>

          <!-- Reply composer at the bottom of the thread. -->
          <form id="forum-reply-form" class="form-card" data-thread-id="${escapeHtml(selected.id)}">
            <h3>Post a Reply</h3>
            <label>
              <span>Your Reply</span>
              <textarea id="forum-reply-content" rows="4" maxlength="4000" required placeholder="Write your reply..."></textarea>
            </label>
            <div class="form-actions">
              <button type="submit" class="btn btn-accent">Post Reply</button>
            </div>
            <p id="forum-reply-status" class="muted"></p>
          </form>
        </div>
      `;

      const newBox = detailBody.querySelector("#forum-reply-content");
      if (keptDraft && newBox && keptDraft.value) {
        newBox.value = keptDraft.value;
        if (keptDraft.focused) {
          newBox.focus({ preventScroll: true });
          newBox.setSelectionRange(keptDraft.start, keptDraft.end);
        }
      }

      const inlineBack = detailBody.querySelector("#forum-back-btn-inline");
      if (inlineBack) {
        inlineBack.addEventListener("click", () => {
          appState.forumsView = "overview";
          appState.selectedForumThreadId = null;
          renderForums(appState.data);
        });
      }

      // Like buttons (delegated). Toggles a like for the current account on
      // either the OP thread or a specific reply. Server enforces one-like-
      // per-account by tracking `likedBy`, which it keeps to itself (Bug #1134).
      // Bug #1131: detailBody outlives its innerHTML, so the listener is added once, not on every render, and reads the
      // open thread when clicked (forumActions.js).
      bindOnce(detailBody, "likeBound", "click", async (event) => {
        const likeBtn = event.target.closest('[data-action="like"]');
        if (!likeBtn || likeBtn.disabled) return;
        if (!appState.accountId) {
          pushFeedback("Sign in to like posts.", "warn");
          return;
        }
        const request = likeRequest(likeBtn, appState.selectedForumThreadId);
        if (!request) return;
        likeBtn.disabled = true;
        try {
          const response = await apiFetch(request.path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.body)
          });
          const payload = await parseJsonResponse(response);
          putForumThread(payload?.thread);
          renderForums(appState.data);
        } catch (err) {
          likeBtn.disabled = false;
          pushFeedback(`Like failed: ${err.message}`, "warn");
        }
      });

      // Bug #1132: Reply and Quote work on the reply box at the foot of the thread. Bound once, like Like (Bug #1131).
      bindOnce(detailBody, "composeBound", "click", (event) => {
        const btn = event.target.closest('[data-action="reply"], [data-action="quote"]');
        if (!btn) return;
        const box = detailBody.querySelector("#forum-reply-content");
        const thread = (appState.data?.forums?.threads || []).find((t) => t.id === appState.selectedForumThreadId);
        const post = postFor(btn, thread);
        if (!box || !post) return;
        box.value = btn.dataset.action === "quote" ? quoteDraft(box.value, post) : replyDraft(box.value, post);
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        box.focus({ preventScroll: true });
        box.setSelectionRange(box.value.length, box.value.length);
      });

      // Reply submission — POST to the server, then re-render with the
      // updated thread payload returned by the API.
      const replyForm = detailBody.querySelector("#forum-reply-form");
      if (replyForm) {
        replyForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const threadId = replyForm.dataset.threadId;
          const contentEl = replyForm.querySelector("#forum-reply-content");
          const statusEl = replyForm.querySelector("#forum-reply-status");
          const content = String(contentEl?.value || "").trim();
          if (!content) {
            if (statusEl) {
              statusEl.textContent = "Reply cannot be empty.";
              statusEl.style.color = "var(--color-warn)";
            }
            return;
          }
          const submitBtn = replyForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          try {
            const response = await apiFetch(`/api/forums/threads/${encodeURIComponent(threadId)}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content })
            });
            const payload = await parseJsonResponse(response);
            // Splice the updated thread into the local cache so re-render
            // shows the new reply immediately (the socket broadcast will
            // also fire, but we don't want to wait for it).
            putForumThread(payload?.thread);
            // Bug #1222: clear the box on the page now, not contentEl: if the socket update re-rendered the thread first,
            // contentEl is the old, detached box and the sent text would come back as a kept draft.
            const liveBox = document.getElementById("forum-reply-content");
            if (liveBox) liveBox.value = "";
            renderForums(appState.data);
          } catch (err) {
            if (statusEl) {
              statusEl.textContent = `Failed to post reply: ${err.message}`;
              statusEl.style.color = "var(--color-warn)";
            }
          } finally {
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }
    }
    return;
  }

  // Overview view
  if (overviewView) overviewView.hidden = false;
  if (threadView) threadView.hidden = true;

  const categoriesEl = document.getElementById("forum-categories");
  if (categoriesEl) {
    categoriesEl.innerHTML =
      `<button class="forum-category-btn${!appState.selectedForumCategory ? " active" : ""}" type="button" data-category="">All</button>` +
      (data.forums?.categories || [])
        .map(
          (cat) =>
            `<button class="forum-category-btn${appState.selectedForumCategory === cat ? " active" : ""}" type="button" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
        )
        .join("");
  }

  const filtered = appState.selectedForumCategory
    ? (data.forums?.threads || []).filter((t) => t.category === appState.selectedForumCategory)
    : (data.forums?.threads || []);

  const threadsEl = document.getElementById("forum-threads");
  if (threadsEl) {
    if (!filtered.length) {
      threadsEl.innerHTML = `<p class="muted">No threads in this category yet.</p>`;
    } else {
      threadsEl.innerHTML = filtered
        .map((thread) => {
          const replies = Array.isArray(thread.replies) ? thread.replies : [];
          const lastActivity = replies.length
            ? Math.max(...replies.map((r) => Number(r.createdAt) || 0), Number(thread.createdAt) || 0)
            : Number(thread.createdAt) || 0;
          const lastAuthor = replies.length ? replies[replies.length - 1]?.author : thread.author;
          const excerpt = String(thread.body || replies[0]?.body || "").slice(0, 240);
          return `
          <button class="forum-thread-card" type="button" data-thread-id="${escapeHtml(thread.id)}">
            <div class="forum-thread-card__head">
              <span class="forum-thread-card__category">${escapeHtml(thread.category)}</span>
              <span class="forum-thread-card__stat" title="Likes">▲ ${Number(thread.likes) || 0}</span>
            </div>
            <h3 class="forum-thread-card__title">${escapeHtml(thread.title)}</h3>
            ${excerpt ? `<p class="forum-thread-card__excerpt">${escapeHtml(excerpt)}</p>` : ""}
            <div class="forum-thread-card__meta">
              <span>Started by <strong>${escapeHtml(thread.author)}</strong></span>
              <span class="forum-thread-card__stat">💬 ${replies.length} ${replies.length === 1 ? "reply" : "replies"}</span>
              ${lastActivity ? `<span style="margin-left:auto">Last by <strong>${escapeHtml(lastAuthor || thread.author)}</strong> · ${formatTime(lastActivity)}</span>` : ""}
            </div>
          </button>`;
        })
        .join("");
    }
  }

  // Populate the new-thread category dropdown with the same allowlist used
  // server-side, then bind the form/button (idempotent — guarded via dataset
  // flag so re-renders don't stack listeners).
  const categories = data.forums?.categories || [];
  const categorySelect = document.getElementById("forum-new-thread-category");
  if (categorySelect) {
    const preselected = appState.selectedForumCategory || categories[0] || "";
    categorySelect.innerHTML = categories
      .map((c) => `<option value="${escapeHtml(c)}"${c === preselected ? " selected" : ""}>${escapeHtml(c)}</option>`)
      .join("");
  }

  const newThreadBtn = document.getElementById("forum-new-thread-btn");
  const newThreadForm = document.getElementById("forum-new-thread-form");
  const cancelBtn = document.getElementById("forum-new-thread-cancel");
  if (newThreadBtn && newThreadForm && !newThreadBtn.dataset.bound) {
    newThreadBtn.dataset.bound = "1";
    newThreadBtn.addEventListener("click", () => {
      newThreadForm.hidden = !newThreadForm.hidden;
      if (!newThreadForm.hidden) {
        newThreadForm.querySelector("#forum-new-thread-title")?.focus();
      }
    });
    cancelBtn?.addEventListener("click", () => {
      newThreadForm.hidden = true;
      newThreadForm.reset();
    });
    newThreadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const category = String(document.getElementById("forum-new-thread-category")?.value || "").trim();
      const title = String(document.getElementById("forum-new-thread-title")?.value || "").trim();
      const body = String(document.getElementById("forum-new-thread-body")?.value || "").trim();
      const statusEl = document.getElementById("forum-new-thread-status");
      if (!category || !title || !body) {
        if (statusEl) {
          statusEl.textContent = "Category, title, and body are all required.";
          statusEl.style.color = "var(--color-warn)";
        }
        return;
      }
      const submitBtn = newThreadForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const response = await apiFetch("/api/forums/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category, title, body })
        });
        const payload = await parseJsonResponse(response);
        // Bug #1133: the forums:updated broadcast usually lands first with this thread already in it.
        putForumThread(payload?.thread);
        newThreadForm.reset();
        newThreadForm.hidden = true;
        if (statusEl) statusEl.textContent = "";
        renderForums(appState.data);
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = `Failed to post thread: ${err.message}`;
          statusEl.style.color = "var(--color-warn)";
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

// AB#1051: the reputation tiers and the agent registry (bio, dialogue, station, availability) both come from
// GET /api/mission-agents now — data/missions.json is the one copy, the CEO Insight pattern (Bug #983). Empty
// until loadStationRegistry's boot fetch resolves, same lifecycle as insightPrograms/buildingRegistry.
// ─── Mission Reputation System ─────────────────────────────────────────────
let REPUTATION_THRESHOLDS = [0];
let REPUTATION_TITLES = ["Unknown"];

function getAgentRepLevel(agentId) {
  const rep = appState.data?.corp?.agentReputation?.[agentId];
  const count = rep?.completedCount || 0;
  let level = 0;
  for (let i = REPUTATION_THRESHOLDS.length - 1; i >= 0; i--) {
    if (count >= REPUTATION_THRESHOLDS[i]) { level = i; break; }
  }
  const maxLevel = REPUTATION_THRESHOLDS.length - 1;
  const nextThreshold = level < maxLevel ? REPUTATION_THRESHOLDS[level + 1] : REPUTATION_THRESHOLDS[maxLevel];
  return { level, count, title: REPUTATION_TITLES[level], nextThreshold, maxLevel };
}

// ─── Mission Agent Registry ────────────────────────────────────────────────
let MISSION_AGENTS = [];

/** Name, title and portrait come from the one record the welcome letter and intro dialogue use (AB#585);
 *  everything else (bio, dialogue, station, availability) comes from the server's own data (AB#1051). */
function applyMissionAgentsCatalog(agents, reputationTiers) {
  MISSION_AGENTS = (agents || []).map((a) =>
    a.id === ASSIGNED_COORDINATOR.id ? { ...ASSIGNED_COORDINATOR, ...a } : a);
  if (reputationTiers?.thresholds?.length && reputationTiers.thresholds.length === reputationTiers.titles?.length) {
    REPUTATION_THRESHOLDS = reputationTiers.thresholds;
    REPUTATION_TITLES = reputationTiers.titles;
  }
}

// Bug #1058: the next step under a short quota. Imported beside its use, away from the import block.
import { missionShortAdvice } from "./contractAdvice.js";

function openMissionModal(missionId, data) {
  const activeMissions = appState.activeMissions || [];
  const activeIds = new Set(activeMissions.map((m) => m.id));
  const offerings = data.corp?.contractOfferings?.missions || [];
  const allMissions = [...offerings, ...activeMissions];
  const mission = allMissions.find((m) => m.id === missionId);
  if (!mission) return;

  const isActive = activeIds.has(mission.id);
  const currentStationId = (data.corp || {}).currentStationId || "earth-station-prime";
  const agent = MISSION_AGENTS.find(a => a.id === mission.agentId);
  const agentStationId = agent ? agent.stationId : null;
  // ISP-298 (AB#1791): the Salvage Assignment is worked "at any ISA facility" — no station to be away from.
  const isSalvage = mission.kind === "time-served";
  const isAtAgentStation = isSalvage || !agentStationId || agentStationId === currentStationId;

  const modal = document.getElementById("mission-detail-modal");
  const typeEl = document.getElementById("mission-detail-type");
  const titleEl = document.getElementById("mission-detail-title");
  const textEl = document.getElementById("mission-detail-text");
  const riskEl = document.getElementById("mission-detail-risk");
  const riskBadge = document.getElementById("mission-detail-risk-badge");
  const rewardBadge = document.getElementById("mission-detail-reward-badge");
  const acceptBtn = document.getElementById("mission-accept-btn");
  const completeBtn = document.getElementById("mission-complete-btn");
  const quotaSection = document.getElementById("mission-quota-section");
  const quotaBar = document.getElementById("mission-quota-bar");
  const quotaText = document.getElementById("mission-quota-text");
  const locationSection = document.getElementById("mission-location-section");
  const locationWarning = document.getElementById("mission-location-warning");

  if (typeEl) typeEl.textContent = `${mission.type} Contract`;
  if (titleEl) titleEl.textContent = mission.title;
  if (textEl) textEl.textContent = mission.text;
  if (riskEl) {
    riskEl.textContent = mission.canShiftControl
      ? "Control Shift Potential: Yes \u2014 completing this mission may alter territorial influence."
      : "Control Shift Potential: None \u2014 this mission does not affect territorial control.";
  }
  if (riskBadge) {
    const riskClass = missionRiskClass(mission.risk);
    riskBadge.className = `mission-card-risk ${riskClass}`;
    riskBadge.textContent = `${mission.risk} Risk`;
  }
  if (rewardBadge) rewardBadge.textContent = mission.reward;

  // Accept button: only for non-active missions
  if (acceptBtn) {
    acceptBtn.hidden = isActive;
  }

  // Quota progress (only for active missions with a quota) — the Salvage Assignment has a clock instead (below).
  let canComplete = false;
  if (isActive && isSalvage && quotaSection) {
    // ISP-298 (AB#1791): the same section, repurposed as a countdown — hoursRequired/acceptedAt, not a station's
    // inventory, decide this contract, so the progress bar (which reads inventory) is hidden rather than reused.
    const remaining = salvageRemainingMs(mission);
    canComplete = remaining <= 0;
    quotaSection.hidden = false;
    if (quotaBar) quotaBar.style.display = "none";
    if (quotaText) {
      quotaText.innerHTML = canComplete
        ? "<strong>Time served.</strong> Report to collect payment."
        : `<strong>${escapeHtml(formatDurationHours(remaining))}</strong> remaining before this contract can be completed`;
    }
  } else if (isActive && mission.quota && quotaSection) {
    const inv = getInventory(); // current station inventory
    const resource = mission.quota.resource || "";
    const required = mission.quota.amount || 0;
    const have = inv[resource] || 0;
    const pct = required > 0 ? Math.min(100, Math.round((have / required) * 100)) : 100;
    const isFulfilled = have >= required;
    canComplete = isFulfilled && isAtAgentStation;

    quotaSection.hidden = false;
    if (quotaBar) {
      quotaBar.style.display = "";
      quotaBar.style.width = pct + "%";
      quotaBar.className = "mission-quota-bar" + (isFulfilled ? " quota-fulfilled" : "");
    }
    const currentStation = appState.stationRegistry.find(s => s.id === currentStationId);
    const stationLabel = currentStation ? currentStation.name : "this station";
    if (quotaText) {
      const displayResource = resource.charAt(0).toUpperCase() + resource.slice(1);
      quotaText.innerHTML = `<strong>${have.toLocaleString()}</strong> / ${required.toLocaleString()} ${escapeHtml(displayResource)} at ${escapeHtml(stationLabel)}`;
      // Bug #1058: Complete stays hidden until the quota is met, so say how to meet it. Away from the agent's station the
      // location warning below says where to go instead.
      if (!isFulfilled && isAtAgentStation) {
        const stationName = (id) => appState.stationRegistry.find((s) => s.id === id)?.name || id;
        const advice = missionShortAdvice({ resource, stationId: currentStationId, inventory: data?.corp?.inventory, stationName });
        quotaText.innerHTML += `<span class="mission-quota-hint">${escapeHtml(advice)}</span>`;
      }
    }
  } else if (quotaSection) {
    quotaSection.hidden = true;
  }

  // Location warning (active + remote) — never for the Salvage Assignment (isAtAgentStation is forced true).
  if (isActive && !isAtAgentStation && locationSection && locationWarning) {
    const agentStation = appState.stationRegistry.find(s => s.id === agentStationId);
    const agentStationLabel = agentStation ? agentStation.name : "another station";
    locationSection.hidden = false;
    locationWarning.innerHTML = `⚠ You must be docked at <strong>${escapeHtml(agentStationLabel)}</strong> to complete this contract.`;
  } else if (locationSection) {
    locationSection.hidden = true;
  }

  // Complete button: only for active missions at the agent's station with quota met
  if (completeBtn) {
    completeBtn.hidden = !canComplete;
  }

  appState.selectedMissionId = missionId;
  if (modal) modal.hidden = false;
}

function closeMissionModal() {
  const modal = document.getElementById("mission-detail-modal");
  if (modal) modal.hidden = true;
  appState.selectedMissionId = null;
}

/** creditedAmount: what was actually paid (Bug #1009), which Contract Law Essentials can make more than the listed reward. */
function showMissionCompleteOverlay(mission, rep, agentName, creditedAmount) {
  closeMissionModal();

  // Check if this completion crossed a reputation threshold
  const prevCount = rep.count - 1;
  let prevLevel = 0;
  for (let i = REPUTATION_THRESHOLDS.length - 1; i >= 0; i--) {
    if (prevCount >= REPUTATION_THRESHOLDS[i]) { prevLevel = i; break; }
  }
  const leveledUp = rep.level > prevLevel;

  const overlay = document.createElement("div");
  overlay.className = "mission-complete-overlay";
  overlay.innerHTML = `
    <div class="mission-complete-card">
      <div class="mission-complete-icon">\u2713</div>
      <h2 class="mission-complete-heading">Contract Fulfilled</h2>
      <p class="mission-complete-title">${escapeHtml(mission.title)}</p>
      <div class="mission-complete-reward">
        <span class="mission-complete-reward-label">Reward Credited</span>
        <span class="mission-complete-reward-value">${creditedAmount ? toCurrency(creditedAmount) : escapeHtml(mission.reward)}</span>
      </div>
      <div class="mission-complete-rep">
        <span class="mission-complete-rep-label">Standing with ${escapeHtml(agentName)}</span>
        <span class="mission-complete-rep-value">${escapeHtml(rep.title)} (Level ${rep.level})</span>
      </div>
      ${leveledUp ? `<div class="mission-complete-levelup">\u2B50 Reputation Level Up! You are now <strong>${escapeHtml(rep.title)}</strong> with ${escapeHtml(agentName)}.</div>` : ""}
      <button class="btn btn-accent btn-command mission-complete-dismiss" type="button">Dismiss</button>
    </div>
  `;

  // TODO(AB#738): Should visual effects be moved to their own file?
  // Spawn celebration particles
  const particleCount = leveledUp ? 40 : 16;
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement("span");
    particle.className = "mission-complete-particle";
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 120;
    particle.style.setProperty("--tx", `${Math.cos(angle) * dist}px`);
    particle.style.setProperty("--ty", `${Math.sin(angle) * dist}px`);
    particle.style.setProperty("--delay", `${Math.random() * 0.3}s`);
    particle.style.setProperty("--hue", `${Math.random() * 60 + 160}`);
    overlay.querySelector(".mission-complete-card").appendChild(particle);
  }

  document.body.appendChild(overlay);

  const dismiss = () => {
    overlay.classList.add("mission-complete-overlay--exit");
    setTimeout(() => overlay.remove(), 300);
  };
  overlay.querySelector(".mission-complete-dismiss").addEventListener("click", dismiss);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
}

function renderMissions(data) {
  const boardView = document.getElementById("missions-board-view");
  const agentView = document.getElementById("agent-office-view");

  const activeMissions = appState.activeMissions || [];
  const activeIds = new Set(activeMissions.map((m) => m.id));
  const offerings = data.corp?.contractOfferings || { missions: [], nextRefreshAt: 0 };
  const available = (offerings.missions || []).filter((m) => !activeIds.has(m.id));

  // ── Agent office view ──
  if (appState.missionsView === "agent") {
    if (boardView) boardView.hidden = true;
    if (agentView) agentView.hidden = false;

    const agent = MISSION_AGENTS.find((a) => a.id === appState.selectedAgentId);
    if (!agent) return;

    const portraitEl = document.getElementById("agent-portrait");
    const titleEl = document.getElementById("agent-title");
    const nameEl = document.getElementById("agent-name");
    const bioEl = document.getElementById("agent-bio");
    const dialogueEl = document.getElementById("agent-dialogue");
    const missionListEl = document.getElementById("agent-mission-list");
    const missionsEmptyEl = document.getElementById("agent-missions-empty");

    if (portraitEl) { portraitEl.src = agent.portrait; portraitEl.alt = agent.name; }
    if (titleEl) titleEl.textContent = `${agent.factionCode} // ${agent.title}`;
    if (nameEl) nameEl.textContent = agent.name;
    if (bioEl) bioEl.innerHTML = `<h3>Personnel Dossier</h3>` + agent.bio.split("\n\n").map(p => `<p>${escapeHtml(p)}</p>`).join("");

    // Reputation display
    const repEl = document.getElementById("agent-reputation");
    if (repEl) {
      const rep = getAgentRepLevel(agent.id);
      const pct = rep.level >= rep.maxLevel ? 100 : rep.nextThreshold > 0
        ? Math.round(((rep.count - REPUTATION_THRESHOLDS[rep.level]) / (rep.nextThreshold - REPUTATION_THRESHOLDS[rep.level])) * 100)
        : 0;
      const starsHtml = Array.from({ length: rep.maxLevel }, (_, i) =>
        `<span class="rep-star ${i < rep.level ? "rep-star--filled" : ""}">\u2726</span>`
      ).join("");
      repEl.innerHTML = `
        <h3>Standing</h3>
        <div class="agent-rep-header">
          <span class="agent-rep-title">${escapeHtml(rep.title)}</span>
        </div>
        <div class="agent-rep-stars">${starsHtml}</div>
        <div class="agent-rep-bar-container">
          <div class="agent-rep-bar" style="width: ${pct}%"></div>
        </div>
        <p class="muted agent-rep-detail">${rep.level < rep.maxLevel ? `${(rep.nextThreshold - rep.count).toLocaleString()} more to next level` : "Maximum standing"}</p>
      `;
    }

    // Completed mission history for this agent
    const historyEl = document.getElementById("agent-completed-missions");
    if (historyEl) {
      const completed = (data.corp?.completedMissions || []).filter(m => m.agentId === agent.id);
      
    }

    if (dialogueEl) {
      const randomLine = agent.dialogue[Math.floor(Math.random() * agent.dialogue.length)];
      dialogueEl.innerHTML = `
        <div class="agent-dialogue-bubble">
          <span class="agent-dialogue-speaker">${escapeHtml(agent.name)}</span>
          <p class="agent-dialogue-text">\u201C${escapeHtml(randomLine)}\u201D</p>
        </div>
      `;
    }

    // Render agent's available missions
    const agentMissions = available.filter((m) => m.agentId === agent.id || m.type === agent.missionType);
    if (missionListEl) {
      if (agentMissions.length) {
        if (missionsEmptyEl) missionsEmptyEl.hidden = true;
        missionListEl.innerHTML = agentMissions.map((mission) => {
          const riskClass = missionRiskClass(mission.risk);
          return `
          <section class="mission-card" data-mission-id="${mission.id}" role="button" tabindex="0">
            <div class="mission-card-header">
              <span class="mission-card-type">${escapeHtml(mission.type)}</span>
              <span class="mission-card-risk ${riskClass}">${escapeHtml(mission.risk)} Risk</span>
            </div>
            <h3 class="mission-card-title">${escapeHtml(mission.title)}</h3>
            <p class="mission-card-text">${escapeHtml(mission.text)}</p>
            <div class="mission-card-footer">
              <span class="mission-card-reward">${escapeHtml(mission.reward)}</span>
              <span class="mission-card-cta">View Briefing \u2192</span>
            </div>
          </section>`;
        }).join("");
      } else {
        if (missionsEmptyEl) missionsEmptyEl.hidden = false;
        missionListEl.innerHTML = "";
      }
    }

    // Contract refresh countdown timer
    const timerEl = document.getElementById("contract-refresh-timer");
    if (timerEl) {
      const nextRefresh = offerings.nextRefreshAt || 0;
      const remaining = nextRefresh - Date.now();
      if (remaining > 0) {
        const hrs = Math.floor(remaining / 3600000);
        const mins = Math.floor((remaining % 3600000) / 60000);
        timerEl.textContent = `New contracts in ${hrs}h ${mins}m`;
        timerEl.hidden = false;
      } else {
        timerEl.textContent = "New contracts available soon";
        timerEl.hidden = false;
      }
    }

    return;
  }

  // ── Bureau hub view (default) ──
  if (boardView) boardView.hidden = false;
  if (agentView) agentView.hidden = true;

  const currentStationId = (data.corp || {}).currentStationId || "earth-station-prime";

  const agentListEl = document.getElementById("agent-list");
  if (agentListEl) {
    const localAgents = MISSION_AGENTS.filter(a => a.available && a.stationId === currentStationId);
    agentListEl.innerHTML = localAgents.length
      ? localAgents.map((agent) => {
          const station = appState.stationRegistry.find(s => s.id === agent.stationId);
          const stationLabel = station ? station.name : agent.stationId;
          return `
      <section class="data-card agent-card" data-agent-id="${agent.id}" role="button" tabindex="0" style="cursor:pointer">
        <div class="agent-card-inner">
          <img class="agent-card-thumb" src="${escapeHtml(agent.portrait)}" alt="${escapeHtml(agent.name)}" />
          <div class="agent-card-info">
            <p class="overline">${escapeHtml(agent.factionCode)} // ${escapeHtml(agent.title)}</p>
            <h3>${escapeHtml(agent.name)}</h3>
            <p class="muted">${escapeHtml(agent.missionType)} Contracts &middot; ${escapeHtml(stationLabel)}</p>
            <p class="agent-card-standing muted">Standing: ${escapeHtml(getAgentRepLevel(agent.id).title)}</p>
          </div>
        </div>
      </section>`;
        }).join("")
      : `<p class="muted">No contracting agents are stationed here.</p>`;
  }

  // Render active contracts
  const activeMissionList = document.getElementById("active-mission-list");
  const activeEmpty = document.getElementById("active-missions-empty");
  if (activeMissions.length) {
    if (activeEmpty) activeEmpty.hidden = true;
    if (activeMissionList) {
      activeMissionList.innerHTML = activeMissions
        .map(
          (mission) => {
            const riskClass = missionRiskClass(mission.risk);
            // ISP-298 (AB#1791): the Salvage Assignment reports "at any ISA facility" (server/game/corporation.js) —
            // it has no home station to be remote from, so the location tag and its warning do not apply to it.
            const isSalvage = mission.kind === "time-served";
            const agent = MISSION_AGENTS.find(a => a.id === mission.agentId);
            const agentStation = agent ? agent.stationId : null;
            const isRemote = !isSalvage && agentStation && agentStation !== currentStationId;
            const stationObj = isRemote ? appState.stationRegistry.find(s => s.id === agentStation) : null;
            const locationTag = isSalvage
              ? ""
              : isRemote && stationObj
                ? `<span class="mission-location-tag mission-location-remote" title="Agent is at ${escapeHtml(stationObj.name)}">⚠ ${escapeHtml(stationObj.body || stationObj.name)}</span>`
                : isRemote
                  ? `<span class="mission-location-tag mission-location-remote">⚠ Remote</span>`
                  : `<span class="mission-location-tag mission-location-local">● Local</span>`;
            // The Assignment is paid in time served, not a delivered quota, so its footer is a countdown until it
            // can be completed, and then a Complete button — never Abandon (ECONOMY.md: accepting, waiting and
            // completing are the only three actions).
            const salvageFooter = isSalvage
              ? (salvageRemainingMs(mission) > 0
                  ? `<span class="mission-card-countdown" data-salvage-countdown="${mission.id}">${formatDurationHours(salvageRemainingMs(mission))} remaining</span>`
                  : `<button class="btn btn-accent btn-sm" type="button" data-complete-mission="${mission.id}">Complete</button>`)
              : `<button class="btn btn-outline btn-sm" type="button" data-abandon-mission="${mission.id}">Abandon</button>`;
            return `
          <section class="mission-card mission-card--active" data-mission-id="${mission.id}" role="button" tabindex="0" style="cursor:pointer">
            <div class="mission-card-header">
              <span class="mission-card-type">${escapeHtml(mission.type)}</span>
              <span class="mission-card-risk ${riskClass}">${escapeHtml(mission.risk)} Risk</span>
              ${locationTag}
            </div>
            <h3 class="mission-card-title">${escapeHtml(mission.title)}</h3>
            <div class="mission-card-footer">
              <span class="mission-card-reward">${escapeHtml(mission.reward)}</span>
              ${salvageFooter}
            </div>
          </section>`;
          }
        )
        .join("");
    }
  } else {
    if (activeEmpty) activeEmpty.hidden = false;
    if (activeMissionList) activeMissionList.innerHTML = "";
  }

  // Render completed mission log
  const completedSection = document.getElementById("completed-missions-section");
  const completedLog = document.getElementById("completed-mission-log");
  const completedMissions = data.corp?.completedMissions || [];
  const logCountEl = document.getElementById("mission-log-count");
  if (completedSection && completedLog) {
    if (completedMissions.length) {
      completedSection.hidden = false;
      if (logCountEl) logCountEl.textContent = `${completedMissions.length} completed`;
      completedLog.innerHTML = completedMissions.map(m => {
        const agent = MISSION_AGENTS.find(a => a.id === m.agentId);
        const agentLabel = agent ? agent.name : "Unknown Agent";
        return `
          <div class="completed-mission-entry">
            <div class="completed-mission-icon">✓</div>
            <span class="completed-mission-title"><span class="completed-mission-type">${escapeHtml(m.type || "Mission")}</span>${escapeHtml(m.title)}</span>
            <span class="completed-mission-reward">${escapeHtml(m.reward)}</span>
            <span class="completed-mission-meta">${escapeHtml(agentLabel)} &middot; ${formatTime(m.completedAt)}</span>
          </div>`;
      }).join("");
    } else {
      completedSection.hidden = true;
      completedLog.innerHTML = "";
    }
  }
}

function renderCombatReports() { /* removed: combat reports tab deprecated */ }

// The "local" comms tab is scoped to the player's current solar system, so
// every system has its own isolated chat history. The UI tab name stays
// "local", but it resolves to a per-system channel key like "local:sol".
function resolveChatChannel(tab, data = appState.data) {
  if (tab === "local") {
    const sys = data?.corp?.currentSystemId || "sol";
    return `local:${sys}`;
  }
  return tab || "global";
}

// AB#733: the chat line template lives in html.js, where it is tested; imported beside its one use.
import { chatLineHtml } from "./html.js";
import { chatScrollTop } from "./chatScroll.js";

function renderChatLog(data) {
  const channel = resolveChatChannel(appState.chatChannel, data);
  const messages = data?.chatLog?.[channel] || [];
  const chatLog = document.getElementById("chat-log");

  if (!chatLog) {
    return;
  }

  // Bug #1135: measure before the redraw, so a player at the newest line stays there and one reading history does not
  // lose their place; a channel switch or their own line goes to the newest.
  const before = { scrollHeight: chatLog.scrollHeight, scrollTop: chatLog.scrollTop, clientHeight: chatLog.clientHeight };
  const channelChanged = chatLog.dataset.channel !== channel;
  chatLog.dataset.channel = channel;

  chatLog.innerHTML = messages
    .slice(-120)
    .map((msg) => chatLineHtml(msg, formatTime))
    .join("");

  chatLog.scrollTop = chatScrollTop({ before, afterScrollHeight: chatLog.scrollHeight, channelChanged, ownLine: appState.chatOwnLinePending });
  appState.chatOwnLinePending = false;
}

function renderChatChannelTabs() {
  const tabs = Array.from(document.querySelectorAll("[data-chat-channel-tab]"));
  tabs.forEach((tab) => {
    const tabKey = tab.getAttribute("data-chat-channel-tab");
    const selected = tabKey === appState.chatChannel;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    // Decorate the Local tab with the player's current system name so it
    // is obvious that comms only reach corporations in that system.
    if (tabKey === "local") {
      const sysId = appState.data?.corp?.currentSystemId || "sol";
      const sysName = (appState.data?.world?.systems || []).find((s) => s.id === sysId)?.name
        || sysId.replace(/\b\w/g, (c) => c.toUpperCase());
      tab.textContent = `Local — ${sysName}`;
    }
  });
}

// TODO(AB#730): Can this be refactored to improve performance? Where is this function called? Do we always need to update every single view? 
// AB#730: every full re-render is timed as a performance measure, "isp:updateAllViews", which DevTools shows in its
// Timings track and scripts/bench-render.mjs reads. The cost is one performance.now() and one measure per render.
function updateAllViews() {
  const start = performance.now();
  renderAllViews();
  performance.measure("isp:updateAllViews", { start });
}

function renderAllViews() {
  if (appState.serverData) {
    applySharedState(appState.serverData);
  }
  const data = appState.data;
  if (!data || !appState.authenticated) {
    return;
  }

  updateCorpIdentity(data);
  updateOverview(data);
  updateReplayOnboardingVisibility(data);
  enforceTravelTabLockdown(data);
  renderTravelPage(data);
  renderStation(data);
  renderLevel2Progress(data);
  renderQueue("rnd-queue", data.queues.corporateRnD, "Permanent corporate unlock track");
  renderQueue("ceo-queue", data.queues.ceoInsight, "CEO-centric growth track");
  renderTechTree(data);
  renderInsightTree(data);
  renderRefinery(data);
  renderMarket(data);
  renderAssets(data);
  renderLogistics(data);
  renderForums(data);
  renderMissions(data);
  renderChatLog(data);
  renderChatChannelTabs();
  renderFinanceCharts(data.corp.finances);
  renderFinanceDashboard(data.corp.finances);
  renderFeedbackLog();
  if (data.world?.systems) starmap.setSystems(data.world.systems);
  starmap.setStations(appState.stationRegistry, data.corp?.currentStationId, data.corp?.currentSystemId || "sol");
  starmap.setUnlockedTech(new Set(data.corp?.unlockedTech || []));
  starmap.setAsteroidMining(starmapMiningState(data, appState.beltCompositions));
  renderExpeditionPanel(data);
  renderInboxMessageList();
}

// Render the overview Asteroid Belt Expeditions panel. The starmap belt-detail
// view is rendered separately via starmap.updateExpeditionProgress().
function renderExpeditionPanel(data) {
  const panel = document.getElementById("expedition-panel");
  if (!panel) return;
  const active = data?.corp?.asteroidMining?.activeExpeditions || [];
  if (!active.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const now = Date.now();
  const rows = active
    .map((exp) => {
      const total = Math.max(1, Number(exp.endsAt || 0) - Number(exp.startedAt || 0));
      const elapsed = Math.max(0, Math.min(total, now - Number(exp.startedAt || 0)));
      const progress = (elapsed / total) * 100;
      const remainingMs = Math.max(0, Number(exp.endsAt || 0) - now);
      const beltName = exp.beltName || exp.beltKey || "Unknown Belt";
      return `
        <article class="queue-item">
          <h4 style="margin:0 0 .25rem">${escapeHtml(beltName)}</h4>
          <p class="muted" style="margin:0 0 .35rem">Remaining: ${formatDurationHours(remainingMs)} (${progress.toFixed(1)}%)</p>
          <div class="progress-wrap"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
        </article>`;
    })
    .join("");
  panel.innerHTML = `<h3>Asteroid Belt Expeditions</h3>${rows}`;
}

function setTab(targetId) {
  // Block navigation to locked tabs during travel
  const traveling = isPlayerTraveling(appState.data || {});
  if (traveling && !TRAVEL_ALLOWED_TABS.has(targetId)) return;

  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === targetId);
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === targetId);
  });

  if (targetId === "starmap") {
    requestAnimationFrame(() => starmap.resize());
  }

  if (targetId === "finance") {
    loadStatements(); // AB#714: the closed days are fetched on their own, not carried in the account
  }

  if (targetId === "inbox") {
    onInboxTabActivated();
  }

  if (targetId === "chat") {
    requestAnimationFrame(() => {
      const chatLog = document.getElementById("chat-log");
      if (chatLog) {
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    });
  }

  noteWalkthroughEvent(`tab:${targetId}`);
}

/**
 * AB#1056: a panel the player chose is brought on screen. At phone width the panels sit below the sidebar and the tab
 * bar, so a tap used to change something nobody could see. Only for the player's own choices, not for automatic tab
 * changes, and only when the panel's top is not already in the upper part of the screen.
 */
function goToTab(targetId) {
  setTab(targetId);
  const panel = document.getElementById(targetId);
  if (panel?.classList.contains("active")) revealUnderHeader(panel);
}

/** Scroll `el` to just under the pinned header when it is not already in view below it (AB#1056). */
function revealUnderHeader(el) {
  if (!el) return;
  const headerBottom = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
  const delta = revealScroll(el.getBoundingClientRect().top, headerBottom, window.innerHeight);
  if (delta) window.scrollBy(0, delta);
}

function bindTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => goToTab(button.dataset.tab));
  });

  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => goToTab(button.dataset.jump));
  });

  // Delegated handler for dynamically-rendered requirement cards
  const requirementsWrap = document.getElementById("level2-requirements");
  if (requirementsWrap) {
    requirementsWrap.addEventListener("click", (e) => {
      const card = e.target.closest("[data-jump]");
      if (card) goToTab(card.dataset.jump);
    });
  }

  // ISP-298 (AB#1791): the Salvage Assignment's Overview card, rendered after bindTabs runs, so it needs its
  // own delegated listener rather than the once-only direct binding above.
  const overviewCardsWrap = document.getElementById("overview-cards");
  if (overviewCardsWrap) {
    overviewCardsWrap.addEventListener("click", (e) => {
      const card = e.target.closest("[data-jump]");
      if (card) goToTab(card.dataset.jump);
    });
  }
}


function showAuthScreen() {
  appState.authenticated = false;
  stopMiningUiTicker();
  authShell.hidden = false;
  gameShell.hidden = true;
}

function enterGame(mode, data, options = {}) {
  appState.profileMode = mode;
  appState.authenticated = true;
  appState.accountId = options.accountId || null;
  appState.accountEmail = options.accountEmail || appState.accountEmail || null;
  if (options.accessToken) {
    const changed = appState.accessToken !== options.accessToken;
    appState.accessToken = options.accessToken;
    if (changed) reauthenticateSocket(); // Bug #710: chat must run on the token this page now holds
  }
  if (options.refreshToken) {
    appState.refreshToken = options.refreshToken;
  }
  appState.walkthroughCompleted = Boolean(options.walkthroughCompleted);
  appState.data = deepClone(data);
  appState.activeMissions = appState.data.corp?.activeMissions || [];
  appState.beltCompositions = {}; // Bug #1264: never another account's; this account's are fetched below

  if (appState.serverData) {
    applySharedState(appState.serverData);
  }

  persistSession();
  if (appState.accountId) loadBeltCompositionsIntoStarmap(); // Bug #1264

  authShell.hidden = true;
  gameShell.hidden = false;

  updateAllViews();
  setTab("overview");
  loadMessages(); // Bug #1130: the Inbox tab's unread count is right from the start, before the Inbox is opened

  if (!appState.mapMounted) {
    starmap.mount(appState.data.world?.systems || []);
    appState.mapMounted = true;
  } else {
    starmap.rerender();
  }

  if (
    options.autoPromptWalkthrough !== false &&
    (mode === "new" || mode === "account") &&
    !appState.walkthroughCompleted &&
    !hasSeenWalkthroughOffer(appState.accountId)
  ) {
    promptWalkthroughOffer();
  }

  loadNotifications();
  startMiningUiTicker();
}

function applySharedState(serverState) {
  if (!appState.data) {
    return;
  }
  appState.data.world = deepClone(serverState.world);
  appState.data.market = deepClone(serverState.market);
  appState.data.forums = deepClone(serverState.forums);
  appState.data.chatLog = deepClone(serverState.chatLog);
  appState.data.combatReports = deepClone(serverState.combatReports);
  appState.data.conglomerates = deepClone(serverState.conglomerates);
}

async function loadBootstrap() {
  const response = await apiFetch("/api/bootstrap");
  if (!response.ok) {
    throw new Error("Failed to load bootstrap state.");
  }
  appState.serverData = await response.json();
  // ISP-86: the economy's constants are fixed for the life of the server, and `state:init` replaces serverData
  // wholesale with a payload that does not carry them. Kept here, they survive that.
  if (appState.serverData?.economy) appState.economy = appState.serverData.economy;

  const version = appState.serverData?.version;
  if (version) {
    const versionLine = document.getElementById("app-version-line");
    if (versionLine) {
      versionLine.textContent = `Interstellar Settlement Protocol v${version}, est. 2147`;
    }
  }

  return appState.serverData;
}

async function loadStationRegistry() {
  try {
    const [stationsRes, buildingsRes, insightRes, missionAgentsRes, researchRes] = await Promise.all([
      fetch("/api/stations"),
      fetch("/api/buildings"),
      fetch("/api/ceo-insight"),
      fetch("/api/mission-agents"),
      fetch("/api/research")
    ]);
    if (stationsRes.ok) {
      const data = await stationsRes.json();
      appState.stationRegistry = data.stations || [];
      // AB#718: the transfer rates the server charges by, so the Logistics tab quotes the same fee.
      appState.logisticsRates = data.logistics || null;
    }
    if (buildingsRes.ok) {
      const data = await buildingsRes.json();
      appState.buildingRegistry = data.buildings || [];
    }
    if (insightRes.ok) {
      const data = await insightRes.json();
      appState.insightPrograms = data.programs || [];
    }
    if (missionAgentsRes.ok) {
      const data = await missionAgentsRes.json();
      applyMissionAgentsCatalog(data.agents, data.reputationTiers);
    }
    if (researchRes.ok) {
      // AB#1049: mutate in place (see the comment on `const techTree = []`), never reassign the binding.
      const data = await researchRes.json();
      techTree.length = 0;
      techTree.push(...(data.nodes || []));
    }
  } catch {
    // Station registry is best-effort; game works without it.
  }
}

async function loadAuthenticatedAccount() {
  const response = await apiFetch("/api/auth/session");
  if (!response.ok) {
    const fallback = { error: "Session validation failed." };
    let payload = fallback;
    try {
      payload = await response.json();
    } catch {
      payload = fallback;
    }

    if ([401, 403, 404].includes(response.status)) {
      throw createInvalidSessionError(payload.error || "Session validation failed.");
    }

    throw new Error(payload.error || "Session validation failed.");
  }

  const payload = await response.json();
  return payload.account;
}

async function restoreAuthenticatedSession() {
  if (!appState.accountId) {
    return null;
  }

  if (!appState.accessToken && !appState.refreshToken) {
    handleSessionExpired("expired");
    return null;
  }

  const account = await loadAuthenticatedAccount();
  enterGame("account", account.state, {
    accountId: account.id,
    accountEmail: account.email,
    accessToken: appState.accessToken,
    refreshToken: appState.refreshToken,
    walkthroughCompleted: account.walkthroughCompleted,
    autoPromptWalkthrough: true
  });
  return account;
}

async function loginDummyAccount() {
  const response = await apiFetch("/api/auth/dummy-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  return parseJsonResponse(response);
}

async function refreshFromServer() {
  if (!appState.authenticated) {
    return;
  }

  if (appState.profileMode === "account" && appState.accountId) {
    const [account, serverState] = await Promise.all([loadAuthenticatedAccount(), loadBootstrap()]);
    appState.data = deepClone(account.state);
    appState.accountEmail = account.email || appState.accountEmail;
    applySharedState(serverState);
    appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
    appState.activeMissions = appState.data.corp?.activeMissions || [];
    loadBeltCompositionsIntoStarmap(); // Bug #1264
    updateAllViews();
    return;
  }

  const serverState = await loadBootstrap();

  if (appState.profileMode === "dummy") {
    appState.data = deepClone(serverState);
    appState.activeMissions = appState.data.corp?.activeMissions || [];
  } else {
    applySharedState(serverState);
  }

  updateAllViews();
}

function bindForms() {
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

  const rndForm = document.getElementById("rnd-form");
  const rndStatus = document.getElementById("rnd-status");
  const rndSelect = document.getElementById("rnd-select");

  rndSelect?.addEventListener("change", () => renderResearchSelectionDetails(appState.data));

  rndForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const techId = rndSelect.value;
    if (!techId) {
      return;
    }

    const node = getTechNode(techId);
    if (!node) {
      return;
    }

    try {
      if (appState.accountId) {
        const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/queue-rnd`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ techId })
        });

        const account = await parseJsonResponse(response);
        appState.data = deepClone(account.state);
        appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        updateAllViews();
      } else {
        const credits = Number(appState.data.corp.finances.credits || 0);
        if (credits < node.costCredits) {
          throw new Error(
            `${node.name} requires ${toCurrency(node.costCredits)} credits. Current reserves are ${toCurrency(credits)} credits.`
          );
        }

        appState.data.corp.finances.credits -= node.costCredits;
        appState.data.queues.corporateRnD.push({
          id: `rnd-${Date.now()}`,
          techId: node.id,
          name: node.name,
          effect: node.effect,
          durationHours: node.durationHours,
          startedAt: nextRndStart(appState.data.queues.corporateRnD, Date.now()), // Bug #1258
          costCredits: node.costCredits
        });
        updateAllViews();
      }

      if (rndStatus) {
        rndStatus.textContent = `${node.name} entered the queue. ${toCurrency(node.costCredits)} credits committed.`;
      }
      pushFeedback(
        `${node.name} added to the corporate R&D queue. Funding locked: ${toCurrency(node.costCredits)} credits.`,
        "success"
      );
      flashButtonSuccess(rndForm.querySelector(".btn-accent"));
      rndForm.reset();
      renderResearchSelectionDetails(appState.data);
    } catch (error) {
      if (rndStatus) {
        rndStatus.textContent = `R&D queue action failed: ${error.message}`;
      }
      pushFeedback(`R&D queue request rejected. ${error.message}`, "error");
    }
  });

  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatTabs = document.getElementById("chat-channel-tabs");

  chatTabs?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-chat-channel-tab]");
    if (!tab) {
      return;
    }
    const nextChannel = String(tab.getAttribute("data-chat-channel-tab") || "global");
    appState.chatChannel = nextChannel;
    renderChatChannelTabs();
    renderChatLog(appState.data);
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const content = chatInput.value.trim();
    if (!content) {
      return;
    }

    // Bug #1135: show the player their own line when it comes back, wherever they had scrolled to.
    appState.chatOwnLinePending = true;

    // The server names the author from the logged-in account (Bug #710); the client no longer sends one.
    socket?.emit("chat:send", {
      channel: resolveChatChannel(appState.chatChannel),
      content
    });

    chatInput.value = "";
  });

  // TODO(AB#739): Move all functionality for the forums to its own dedicated file
  const forumThreadListEl = document.getElementById("forum-threads");
  const forumCategoriesEl = document.getElementById("forum-categories");
  const forumRecentBtn = document.getElementById("forum-recent-btn");
  const forumBackBtn = document.getElementById("forum-back-btn");

  forumCategoriesEl?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-category]");
    if (!btn) return;
    appState.selectedForumCategory = btn.getAttribute("data-category") || null;
    renderForums(appState.data);
  });

  forumRecentBtn?.addEventListener("click", () => {
    appState.selectedForumCategory = null;
    renderForums(appState.data);
  });

  forumBackBtn?.addEventListener("click", () => {
    appState.forumsView = "overview";
    renderForums(appState.data);
  });

  forumThreadListEl?.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-thread-id]");
    if (!trigger) return;
    appState.selectedForumThreadId = trigger.getAttribute("data-thread-id");
    appState.forumsView = "thread";
    renderForums(appState.data);
  });

  // Assignments Bureau (mission agent hub) interactions
  const agentListEl = document.getElementById("agent-list");
  const agentBackBtn = document.getElementById("agent-back-btn");
  const agentMissionListEl = document.getElementById("agent-mission-list");
  const missionModalCloseBtn = document.getElementById("mission-modal-close");
  const missionModal = document.getElementById("mission-detail-modal");
  const missionAcceptBtn = document.getElementById("mission-accept-btn");
  const missionCompleteBtn = document.getElementById("mission-complete-btn");
  const activeMissionListEl = document.getElementById("active-mission-list");

  // Click agent card → open agent office
  agentListEl?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-agent-id]");
    if (!card) return;
    appState.selectedAgentId = card.getAttribute("data-agent-id");
    appState.missionsView = "agent";
    renderMissions(appState.data);
  });

  // Back from agent office → bureau hub
  agentBackBtn?.addEventListener("click", () => {
    appState.missionsView = "board";
    appState.selectedAgentId = null;
    renderMissions(appState.data);
  });

  // Click mission in agent office → open mission modal
  agentMissionListEl?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-mission-id]");
    if (!card) return;
    openMissionModal(card.getAttribute("data-mission-id"), appState.data);
  });

  // Close mission modal
  missionModalCloseBtn?.addEventListener("click", closeMissionModal);

  // Click backdrop to close
  missionModal?.addEventListener("click", (event) => {
    if (event.target === missionModal) closeMissionModal();
  });

  missionAcceptBtn?.addEventListener("click", async () => {
    const offerings = appState.data?.corp?.contractOfferings?.missions || [];
    const mission = offerings.find((m) => m.id === appState.selectedMissionId);
    if (!mission) return;
    const alreadyActive = appState.activeMissions.some((m) => m.id === mission.id);
    if (alreadyActive) return;

    if (appState.profileMode === "account" && appState.accountId) {
      const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/accept-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: mission.id })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to accept contract." }));
        pushFeedback(err.error || "Failed to accept contract.", "warn");
        return;
      }
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.activeMissions = appState.data.corp?.activeMissions || [];
    } else {
      appState.activeMissions.push(mission);
      if (appState.data?.corp) {
        appState.data.corp.activeMissions = appState.activeMissions;
      }
    }

    pushFeedback(`Contract accepted: "${mission.title}". Track it in Active Contracts.`, "success");
    const btn = document.getElementById("mission-accept-btn");
    if (btn) flashButtonSuccess(btn);
    closeMissionModal();
    renderMissions(appState.data);
  });

  activeMissionListEl?.addEventListener("click", async (event) => {
    // Abandon button
    const btn = event.target.closest("[data-abandon-mission]");
    if (btn) {
      const missionId = btn.getAttribute("data-abandon-mission");
      if (appState.profileMode === "account" && appState.accountId) {
        const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/abandon-mission`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ missionId })
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Failed to abandon contract." }));
          pushFeedback(err.error || "Failed to abandon contract.", "warn");
          return;
        }
        const account = await parseJsonResponse(response);
        appState.data = deepClone(account.state);
        appState.activeMissions = appState.data.corp?.activeMissions || [];
      } else {
        appState.activeMissions = appState.activeMissions.filter((m) => m.id !== missionId);
        if (appState.data?.corp) {
          appState.data.corp.activeMissions = appState.activeMissions;
        }
      }
      pushFeedback("Contract abandoned and removed from Active Contracts.", "info");
      renderMissions(appState.data);
      return;
    }
    // ISP-298 (AB#1791): the Salvage Assignment's inline Complete button, so a player does not have to open the
    // modal for a contract that has no quota to review — refused the same way as everything else, via pushFeedback.
    const completeInline = event.target.closest("[data-complete-mission]");
    if (completeInline) {
      await completeMission(completeInline.getAttribute("data-complete-mission"));
      return;
    }
    // Click card → open modal
    const card = event.target.closest("[data-mission-id]");
    if (card) {
      openMissionModal(card.getAttribute("data-mission-id"), appState.data);
    }
  });

  // Complete contract: deduct resources (or, for the Salvage Assignment, check the clock) and remove from active.
  // Shared by the mission detail modal's Complete button and the inline one on a ready Assignments card (ISP-298).
  async function completeMission(missionId) {
    const mission = (appState.activeMissions || []).find((m) => m.id === missionId);
    if (!mission || (!mission.quota && mission.kind !== "time-served")) return;
    // ISP-297/298 (AB#1789/1791): time-served pay is flat, never Contract Law Essentials' 8% bonus (T-018), so
    // the figure shown is the reward text itself, not missionRewardCredits' bonus-adjusted one.
    const rewardCredits = mission.kind === "time-served"
      ? parseInt(String(mission.reward ?? "").replace(/[^0-9]/g, ""), 10) || 0
      // Bug #1009: the same rule the server pays by, so the message says what actually arrived.
      : missionRewardCredits(mission.reward, appState.data?.corp?.completedInsights);

    if (appState.profileMode === "account" && appState.accountId) {
      const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/complete-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: mission.id })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to complete mission." }));
        pushFeedback(err.error || "Failed to complete mission.", "danger");
        return;
      }
      const account = await parseJsonResponse(response);
      appState.data = deepClone(account.state);
      appState.activeMissions = appState.data.corp?.activeMissions || [];
    } else {
      if (mission.kind === "time-served") {
        if (salvageRemainingMs(mission) > 0) return;
      } else {
        const inv = getInventory();
        const resource = mission.quota.resource || "";
        const required = mission.quota.amount || 0;
        const have = inv[resource] || 0;
        if (have < required) return;

        // Deduct resources
        inv[resource] = have - required;
        if (inv[resource] <= 0) delete inv[resource];
      }

      // Remove from active
      appState.activeMissions = appState.activeMissions.filter((m) => m.id !== mission.id);
      if (appState.data?.corp) {
        appState.data.corp.activeMissions = appState.activeMissions;

        if (appState.data.corp.contractOfferings && Array.isArray(appState.data.corp.contractOfferings.missions)) {
          appState.data.corp.contractOfferings.missions = appState.data.corp.contractOfferings.missions.filter((m) => m.id !== mission.id);
        }

        if (!Array.isArray(appState.data.corp.completedMissions)) {
          appState.data.corp.completedMissions = [];
        }
        appState.data.corp.completedMissions.unshift({
          id: mission.id,
          title: mission.title,
          type: mission.type,
          agentId: mission.agentId || null,
          reward: mission.reward,
          completedAt: Date.now()
        });
        appState.data.corp.completedMissions = appState.data.corp.completedMissions.slice(0, 200);

        if (!appState.data.corp.agentReputation || typeof appState.data.corp.agentReputation !== "object") {
          appState.data.corp.agentReputation = {};
        }
        const localAgentId = mission.agentId || "unknown";
        if (!appState.data.corp.agentReputation[localAgentId]) {
          appState.data.corp.agentReputation[localAgentId] = { completedCount: 0 };
        }
        appState.data.corp.agentReputation[localAgentId].completedCount += 1;
      }

      // Credit reward into the spendable balance (Bug #1009: it went to corp.credits, which nothing reads)
      if (rewardCredits && appState.data?.corp?.finances) {
        appState.data.corp.finances.credits = (appState.data.corp.finances.credits || 0) + rewardCredits;
      }
    }

    pushFeedback(`Contract completed: "${mission.title}". ${toCurrency(rewardCredits)} credited.`, "success");

    // Check for reputation level-up
    const agentId = mission.agentId || "unknown";
    const rep = getAgentRepLevel(agentId);
    const agent = MISSION_AGENTS.find(a => a.id === agentId);
    const agentName = agent ? agent.name : "Agent";

    // Show completion celebration overlay
    showMissionCompleteOverlay(mission, rep, agentName, rewardCredits);

    renderMissions(appState.data);
    // Bug #1043: renderInventoryPanel was called here and threw (its form is gone), so updateAllViews never ran.
    updateAllViews();
  }

  missionCompleteBtn?.addEventListener("click", () => completeMission(appState.selectedMissionId));

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
    } catch (error) {
      if (npcStatus) {
        npcStatus.textContent = `Sale failed: ${error.message}`;
      }
      pushFeedback(`NPC sell rejected. ${error.message}`, "error");
    }
  });
}

function bindRealtimeEvents() {
  if (!socket) {
    return;
  }

  
  socket.on("state:init", (serverState) => {
    appState.serverData = serverState;
    if (!appState.authenticated) {
      return;
    }

    if (appState.profileMode === "dummy") {
      appState.data = deepClone(serverState);
    } else {
      applySharedState(serverState);
    }
    updateAllViews();
  });

  // ISP-67: the server drops a socket whose token has expired back to anonymous and says so here, rather than
  // disconnecting it. Get a fresh access token and reconnect so per-account events resume without a page reload.
  socket.on("auth:expired", () => {
    if (appState.refreshToken) refreshSessionToken();
  });

  socket.on("chat:new", (msg) => {
    if (!appState.data) {
      return;
    }

    if (!appState.data.chatLog) appState.data.chatLog = {};
    if (!appState.data.chatLog[msg.channel]) {
      appState.data.chatLog[msg.channel] = [];
    }

    appState.data.chatLog[msg.channel].push(msg);
    if (msg.channel === resolveChatChannel(appState.chatChannel)) {
      renderChatLog(appState.data);
    }
  });

  socket.on("market:updated", (marketState) => {
    if (!appState.data) {
      return;
    }

    appState.data.market = marketState;
    renderMarket(appState.data);
  });

  socket.on("forums:updated", (forumsState) => {
    // Forums are global state; refresh the local copy and re-render whichever
    // forum view is currently visible so new threads/replies appear in real
    // time across all sessions without requiring a manual refresh.
    if (!appState.data) return;
    appState.data.forums = forumsState;
    if (appState.serverData) appState.serverData.forums = forumsState;
    const forumsPanel = document.getElementById("forums");
    if (forumsPanel?.classList.contains("active")) {
      renderForums(appState.data);
    }
  });

  // Bug #1021: this used to take whatever arrived, and the server sent every corporation's finances to every socket,
  // so it was limited to dummy mode and still showed the last corporation's numbers there. The server now sends only
  // this account's, with its id, and the check below matches the other per-account events.
  socket.on("finance:updated", (payload) => {
    if (!appState.data?.corp || !appState.accountId || payload?.accountId !== appState.accountId || !payload.finances) {
      return;
    }

    const financeState = payload.finances;
    appState.data.corp.finances = financeState;
    renderFinanceCharts(financeState);
    renderFinanceDashboard(financeState);
    updateCorpIdentity(appState.data);
    refreshStatementsIfDayClosed();
  });

  socket.on("finance:snapshot", () => {
    if (!appState.data?.corp?.finances) return;
    // Snapshot tick fires server-side every 30s. We don't ship the snapshot
    // payload over the wire (it's already in finances.snapshots on next
    // state refresh); just re-render whatever the client currently holds.
    renderFinanceCharts(appState.data.corp.finances);
    renderFinanceDashboard(appState.data.corp.finances);
  });

  socket.on("finance:snapshot", () => {
    if (!appState.data?.corp?.finances) return;
    // Snapshot tick fires server-side every 30s. We don't ship the snapshot
    // payload over the wire (it's already in finances.snapshots on next
    // state refresh); just re-render whatever the client currently holds.
    renderFinanceCharts(appState.data.corp.finances);
    renderFinanceDashboard(appState.data.corp.finances);
  });

  socket.on("notifications:new", (payload) => {
    if (!appState.accountId || payload?.accountId !== appState.accountId || !payload.notification) {
      return;
    }

    appState.notifications.unshift(payload.notification);
    appState.notifications = appState.notifications.slice(0, 120);
    appState.unreadNotifications += 1;
    renderNotifications();
  });

  // Bug #1130: mail for this account arrived (the server sends it to this account's room only, with no payload).
  socket.on("messages:new", () => {
    loadMessages();
  });

  socket.on("ceo:completed", (payload) => {
    if (!appState.accountId || payload?.accountId !== appState.accountId) {
      return;
    }
    refreshFromServer();
  });

  // Bug #1167: someone bought one of this account's listings. The notification comes on its own event; this redraws
  // the credits and Trade History from the account.
  socket.on("market:sold", (payload) => {
    if (!appState.accountId || payload?.accountId !== appState.accountId) {
      return;
    }
    refreshFromServer();
  });

  socket.on("rnd:completed", (payload) => {
    if (!appState.accountId || payload?.accountId !== appState.accountId) {
      return;
    }
    refreshFromServer();
  });

  socket.on("travel:arrived", (payload) => {
    if (!appState.accountId || payload?.accountId !== appState.accountId) {
      return;
    }
    clearTravelTimer();
    refreshFromServer().then(() => {
      // Switch to station tab on arrival
      const activeTab = document.querySelector(".tab-btn.active");
      if (activeTab?.dataset?.tab === "travel") {
        setTab("station");
      }
    });
  });

  // ISP-279 (AB#986): a shipment (AB#985) arrived or was held on this tick. The in-flight list and inventory both
  // moved server-side; refreshFromServer() re-renders the Logistics tab (renderAllViews() always calls
  // renderLogistics()) with no reload, the way travel:arrived already does for travel.
  socket.on("logistics:arrived", (payload) => {
    if (!appState.accountId || payload?.accountId !== appState.accountId) {
      return;
    }
    refreshFromServer();
  });

  socket.on("mining:updated", (payload) => {
    if (!appState.data || !appState.accountId || payload?.accountId !== appState.accountId) {
      return;
    }
    const corp = appState.data.corp;
    if (!corp) return;
    if (payload.extractors && corp.mining) {
      corp.mining.silicateExtractors = payload.extractors;
      corp.mining.silicateExtractor = payload.extractors[0] || corp.mining.silicateExtractor;
    }
    if (payload.inventory) {
      corp.inventory = payload.inventory;
    }
    if (typeof payload.credits === "number") {
      corp.finances.credits = payload.credits;
    }
    renderAssets(appState.data);
    updateCorpIdentity(appState.data);
    refreshOpenLeaseView(payload.extractors); // Bug #1091: the open lease view follows the cycle
  });

  socket.on("expedition:completed", (payload) => {
    if (!appState.data || !appState.accountId || payload?.accountId !== appState.accountId) return;
    refreshFromServer();
    loadMessages();
  });

  socket.on("fabrication:completed", async (payload) => {
    if (!appState.data || !appState.accountId || payload?.accountId !== appState.accountId) return;
    await refreshFromServer();
    pushFeedback(probeReadyText(appState.data?.corp?.asteroidMining?.probeCount), "ok"); // AB#1257: said once, when true
  });
}

// Empty states that name the next action (Bug #1060): the Inbox list's below, and ISA Claims' lines.
import { claimsAllTakenText, claimsNoLeasesText, inboxEmptyText } from "./emptyStates.js";

// ─── Inbox ────────────────────────────────────────────────────────────────────

async function loadMessages() {
  if (!appState.accountId) return;
  try {
    const res = await apiFetch(`/api/accounts/${appState.accountId}/messages`);
    const data = await res.json();
    if (data.messages) {
      appState.inbox.messages = data.messages;
      appState.inbox.loaded = true;
      // First load: if the user has unread player messages but no unread
      // official messages, default the inbox subtab to "players" so
      // self-sent and incoming player mail isn't hidden behind the default
      // official subtab.
      if (!appState.inbox.subtypeChosenByUser && appState.inbox.folder === "inbox") {
        const inboxMsgs = data.messages.filter((m) => m.folder === "inbox");
        const unreadPlayer = inboxMsgs.some((m) => m.fromType === "player" && !m.readAt);
        const unreadOfficial = inboxMsgs.some((m) => (m.fromType === "system" || m.fromType === "npc") && !m.readAt);
        if (unreadPlayer && !unreadOfficial) {
          appState.inbox.subtype = "players";
          document.querySelectorAll(".inbox-subtab-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.subtype === "players");
          });
        }
      }
      updateInboxSubtabBadges();
      renderInboxMessageList();
    }
  } catch (_) { /* silently ignore */ }
}

// Counts unread inbox messages per subtype and renders a small "(n)" badge in
// each subtab button so the user can see at a glance which tab has new mail.
function updateInboxSubtabBadges() {
  const msgs = (appState.inbox.messages || []).filter((m) => m.folder === "inbox");
  const counts = {
    official: msgs.filter((m) => (m.fromType === "system" || m.fromType === "npc") && !m.readAt).length,
    players: msgs.filter((m) => m.fromType === "player" && !m.readAt).length
  };
  document.querySelectorAll(".inbox-subtab-btn").forEach((btn) => {
    const subtype = btn.dataset.subtype;
    const baseLabel = btn.dataset.baseLabel || (() => {
      // Cache the original label text once so re-renders don't accumulate
      // badge counts in the button text.
      const stripped = btn.textContent.replace(/\s*\(\d+\)\s*$/, "").trim();
      btn.dataset.baseLabel = stripped;
      return stripped;
    })();
    const n = counts[subtype] || 0;
    btn.textContent = n > 0 ? `${baseLabel} (${n})` : baseLabel;
  });
  // Bug #1130: the Inbox tab carries the unread count too, so a player on any other tab is told that mail has arrived.
  const inboxTab = document.querySelector('.tab-btn[data-tab="inbox"]');
  if (inboxTab) {
    const unread = counts.official + counts.players;
    inboxTab.textContent = unread > 0 ? `Inbox (${unread})` : "Inbox";
  }
}

function inboxMsgsForView() {
  const { folder, subtype, messages } = appState.inbox;
  let filtered = messages.filter((m) => m.folder === folder);
  if (folder === "inbox") {
    if (subtype === "official") {
      filtered = filtered.filter((m) => m.fromType === "system" || m.fromType === "npc");
    } else {
      filtered = filtered.filter((m) => m.fromType === "player");
    }
  }
  return filtered.slice().sort((a, b) => b.sentAt - a.sentAt);
}


function renderInboxMessageList() {
  const panel = document.getElementById("inbox");
  if (!panel || !panel.classList.contains("active")) return;

  // Keep subtab badge counts in sync with the latest message state.
  updateInboxSubtabBadges();

  const list = document.getElementById("inbox-message-list");
  const emptyNotice = document.getElementById("inbox-empty-notice");
  if (!list || !emptyNotice) return;

  const msgs = inboxMsgsForView();
  if (!msgs.length) {
    list.innerHTML = "";
    emptyNotice.textContent = inboxEmptyText(appState.inbox.folder, appState.inbox.subtype); // Bug #1060
    emptyNotice.style.display = "";
    return;
  }
  emptyNotice.style.display = "none";

  // Bug #754: every field escaped (public/scripts/html.js, tested in tests/unit/inboxList.test.js).
  list.innerHTML = messageListItemsHtml(msgs, formatInboxDate);

  list.querySelectorAll(".inbox-msg-item").forEach((el) => {
    el.addEventListener("click", () => openMessage(el.dataset.msgId));
  });
}

function openMessage(messageId) {
  const msg = appState.inbox.messages.find((m) => m.id === messageId);
  if (!msg) return;

  appState.inbox.openMessageId = messageId;

  // If it's a draft, open the compose view pre-filled
  if (msg.folder === "draft") {
    showInboxView("compose");
    document.getElementById("compose-draft-id").value = msg.id;
    document.getElementById("compose-to").value = msg.toCorpName || "";
    document.getElementById("compose-to-id").value = msg.toCorpId || ""; // Bug #711: the corporation it was written for
    clearComposeCandidates();
    document.getElementById("compose-subject").value = msg.subject || "";
    document.getElementById("compose-body").value = msg.body || "";
    document.getElementById("compose-status").textContent = "";
    appState.inbox.composeDraftId = msg.id;
    syncComposeDraftControls();
    return;
  }

  showInboxView("detail");

  document.getElementById("inbox-detail-from").textContent =
    msg.fromType === "player" ? `From: ${msg.fromName}` : `From: ${msg.fromName}`;
  document.getElementById("inbox-detail-date").textContent = formatInboxDate(msg.sentAt);
  document.getElementById("inbox-detail-subject").textContent = msg.subject || "(no subject)";
  document.getElementById("inbox-detail-body").textContent = msg.body || "";

  const archiveBtn = document.getElementById("inbox-action-archive");
  const restoreBtn = document.getElementById("inbox-action-restore");
  const trashBtn = document.getElementById("inbox-action-trash");
  archiveBtn.style.display = "none";
  restoreBtn.style.display = "none";
  trashBtn.style.display = "none";

  if (msg.folder === "inbox") {
    archiveBtn.style.display = "";
    trashBtn.style.display = "";
  } else if (msg.folder === "archive") {
    restoreBtn.style.display = "";
    trashBtn.style.display = "";
  } else if (msg.folder === "trash") {
    restoreBtn.style.display = "";
  }

  // Mark read. Bug #1136: here and now, so the counts and the list are right the moment the player goes Back (it used
  // to wait for the request, and nothing redrew the list after it); put back if the server does not record it.
  if (!msg.readAt && msg.folder !== "sent" && msg.folder !== "draft") {
    msg.readAt = Date.now();
    updateInboxSubtabBadges(); // Bug #1130: the Inbox tab's count is on screen while the message is open
    const unmark = () => {
      const m = appState.inbox.messages.find((x) => x.id === messageId);
      if (m) m.readAt = null;
      renderInboxMessageList();
    };
    apiFetch(`/api/accounts/${appState.accountId}/messages/${messageId}/read`, { method: "POST" })
      .then((res) => { if (!res.ok) unmark(); })
      .catch(unmark);
  }
}

/** Bug #1137: Delete Draft shows in the compose view whenever a saved draft is open there (opened, or just saved). */
function syncComposeDraftControls() {
  const btn = document.getElementById("compose-delete-draft-btn");
  if (btn) btn.hidden = !appState.inbox.composeDraftId;
}

function showInboxView(view) {
  // view: "list" | "detail" | "compose"
  document.getElementById("inbox-list-view").style.display = view === "list" ? "" : "none";
  document.getElementById("inbox-detail-view").style.display = view === "detail" ? "" : "none";
  document.getElementById("inbox-compose-view").style.display = view === "compose" ? "" : "none";
  const subtabNav = document.getElementById("inbox-subtab-nav");
  // Subtabs (System & NPC / Players) only make sense on the inbox-folder list view.
  if (subtabNav) {
    subtabNav.style.display = (view === "list" && appState.inbox.folder === "inbox") ? "" : "none";
  }
}

function bindInboxControls() {
  // Folder tabs
  document.querySelectorAll(".inbox-folder-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".inbox-folder-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      appState.inbox.folder = btn.dataset.folder;
      appState.inbox.openMessageId = null;
      showInboxView("list");
      const subtabNav = document.getElementById("inbox-subtab-nav");
      if (subtabNav) subtabNav.style.display = appState.inbox.folder === "inbox" ? "" : "none";
      renderInboxMessageList();
    });
  });

  // Sub-tabs
  document.querySelectorAll(".inbox-subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".inbox-subtab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      appState.inbox.subtype = btn.dataset.subtype;
      // Once the user picks a subtab, stop auto-switching it on reload.
      appState.inbox.subtypeChosenByUser = true;
      renderInboxMessageList();
    });
  });

  // Back buttons
  document.getElementById("inbox-back-btn")?.addEventListener("click", () => {
    showInboxView("list");
    appState.inbox.openMessageId = null;
    renderInboxMessageList(); // Bug #1136: the message just read is no longer marked unread
  });
  document.getElementById("inbox-compose-back-btn")?.addEventListener("click", () => {
    appState.inbox.composeDraftId = null;
    syncComposeDraftControls();
    showInboxView("list");
    renderInboxMessageList();
  });

  // Compose trigger
  document.getElementById("inbox-compose-trigger")?.addEventListener("click", () => {
    appState.inbox.composeDraftId = null;
    document.getElementById("compose-draft-id").value = "";
    document.getElementById("compose-to").value = "";
    document.getElementById("compose-to-id").value = "";
    clearComposeCandidates();
    document.getElementById("compose-subject").value = "";
    document.getElementById("compose-body").value = "";
    document.getElementById("compose-status").textContent = "";
    syncComposeDraftControls();
    showInboxView("compose");
  });

  // Bug #711: typing a different name means the chosen corporation no longer applies.
  document.getElementById("compose-to")?.addEventListener("input", () => {
    document.getElementById("compose-to-id").value = "";
    clearComposeCandidates();
  });

  // Detail action buttons
  document.getElementById("inbox-action-archive")?.addEventListener("click", () => moveCurrentMessage("archive"));
  document.getElementById("inbox-action-restore")?.addEventListener("click", () => moveCurrentMessage("inbox"));
  document.getElementById("inbox-action-trash")?.addEventListener("click", () => moveCurrentMessage("trash"));
  // Bug #1137: delete the draft open in the compose view, then show Drafts without it.
  document.getElementById("compose-delete-draft-btn")?.addEventListener("click", async () => {
    const id = appState.inbox.composeDraftId;
    if (!id) return;
    const status = document.getElementById("compose-status");
    status.textContent = "Deleting…";
    try {
      const res = await apiFetch(`/api/accounts/${appState.accountId}/messages/draft/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "the server refused");
    } catch (err) {
      status.textContent = `The draft was not deleted: ${err.message}.`;
      return;
    }
    appState.inbox.messages = appState.inbox.messages.filter((m) => m.id !== id);
    appState.inbox.composeDraftId = null;
    appState.inbox.openMessageId = null;
    document.getElementById("compose-draft-id").value = "";
    status.textContent = "";
    syncComposeDraftControls();
    appState.inbox.folder = "draft";
    document.querySelectorAll(".inbox-folder-btn").forEach((b) => b.classList.toggle("active", b.dataset.folder === "draft"));
    showInboxView("list");
    renderInboxMessageList();
    pushFeedback("Draft deleted.", "success");
  });

  // Compose form
  const composeForm = document.getElementById("inbox-compose-form");
  composeForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("compose-status");
    status.textContent = "Sending…";
    const body = {
      toCorpId: document.getElementById("compose-to-id").value.trim() || undefined,
      toCorpName: document.getElementById("compose-to").value.trim(),
      subject: document.getElementById("compose-subject").value.trim(),
      body: document.getElementById("compose-body").value.trim()
    };
    const draftId = document.getElementById("compose-draft-id").value.trim();
    if (draftId) body.draftId = draftId;
    try {
      const res = await apiFetch(`/api/accounts/${appState.accountId}/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.error) {
        status.textContent = data.error;
        // Bug #711: several corporations share the name. Nothing was sent; the player picks which one they mean.
        if (Array.isArray(data.candidates)) showComposeCandidates(data.candidates);
        return;
      }
      appState.inbox.messages = data.messages;
      appState.inbox.folder = "sent";
      appState.inbox.composeDraftId = null;
      syncComposeDraftControls();
      document.querySelectorAll(".inbox-folder-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.folder === "sent");
      });
      status.textContent = `Sent to ${data.toName}.`;
      showInboxView("list");
      renderInboxMessageList();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  });

  // Save draft button
  document.getElementById("compose-save-draft-btn")?.addEventListener("click", async () => {
    const status = document.getElementById("compose-status");
    status.textContent = "Saving…";
    const body = {
      toCorpId: document.getElementById("compose-to-id").value.trim() || undefined,
      toCorpName: document.getElementById("compose-to").value.trim(),
      subject: document.getElementById("compose-subject").value.trim(),
      body: document.getElementById("compose-body").value.trim()
    };
    const existingDraftId = document.getElementById("compose-draft-id").value.trim();
    if (existingDraftId) body.draftId = existingDraftId;
    try {
      const res = await apiFetch(`/api/accounts/${appState.accountId}/messages/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.draft) {
        document.getElementById("compose-draft-id").value = data.draft.id;
        appState.inbox.composeDraftId = data.draft.id;
        syncComposeDraftControls();
        // Upsert in local list
        const idx = appState.inbox.messages.findIndex((m) => m.id === data.draft.id);
        if (idx >= 0) appState.inbox.messages[idx] = data.draft;
        else appState.inbox.messages.unshift(data.draft);
        status.textContent = "Draft saved.";
      } else {
        status.textContent = data.error || "Failed to save draft.";
      }
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  });
}

async function moveCurrentMessage(folder) {
  const id = appState.inbox.openMessageId;
  if (!id) return;
  try {
    const res = await apiFetch(`/api/accounts/${appState.accountId}/messages/${id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder })
    });
    const data = await res.json();
    if (data.message) {
      const idx = appState.inbox.messages.findIndex((m) => m.id === id);
      if (idx >= 0) appState.inbox.messages[idx] = data.message;
    }
    appState.inbox.openMessageId = null;
    showInboxView("list");
    renderInboxMessageList();
  } catch (_) { /* ignore */ }
}

// Called when the Inbox tab becomes active (via tab switching logic)
function onInboxTabActivated() {
  // Bug #1130: fetch every time the Inbox opens, not once per page load; show what is already held meanwhile.
  if (appState.inbox.loaded) renderInboxMessageList();
  loadMessages();
  const subtabNav = document.getElementById("inbox-subtab-nav");
  if (subtabNav) subtabNav.style.display = appState.inbox.folder === "inbox" ? "" : "none";
}

function bindGlobalControls() {
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (appState.accountId && appState.refreshToken) {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: appState.accountId, refreshToken: appState.refreshToken })
          });
        } catch {
          // best-effort — clear session regardless
        }
      }
      clearSession();
      appState.authenticated = false;
      appState.data = null;
      appState.profileMode = null;
      stopMiningUiTicker();
      showAuthScreen();
    });
  }

  if (replayOnboardingButton) {
    replayOnboardingButton.addEventListener("click", async () => {
      try {
        await resetWalkthroughForAccount();
        await runIntroDialogue();
        promptWalkthroughOffer();
      } catch {
        const status = document.getElementById("level2-status");
        if (status) {
          status.textContent = "Unable to reset onboarding state right now. Please try again.";
        }
      }
    });
  }

  document.getElementById("map-overlay").addEventListener("change", (event) => {
    starmap.setOverlay(event.target.value);
  });

  if (notificationToggleButton && notificationPanel) {
    notificationToggleButton.addEventListener("click", () => {
      const nextHidden = !notificationPanel.hidden;
      notificationPanel.hidden = nextHidden;
      notificationToggleButton.setAttribute("aria-expanded", String(!nextHidden));
      if (!nextHidden) {
        loadNotifications();
      }
    });
  }

  if (notificationReadAllButton) {
    notificationReadAllButton.addEventListener("click", async () => {
      if (!appState.accountId) {
        return;
      }

      const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/notifications/read-all`, {
        method: "POST"
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      appState.notifications = payload.notifications || [];
      appState.unreadNotifications = Number(payload.unreadCount || 0);
      renderNotifications();
    });
  }

  bindWalkthroughControls();
}

// AB#716: imported beside its one use, away from the import block that parallel pull requests edit.
import { bindPriceChart } from "./priceChart.js";

async function boot() {
  hydrateSession();
  showAuthScreen();
  bindCollapsibleSections();
  bindTabs();
  bindForms();
  bindRealtimeEvents();
  bindGlobalControls();
  bindRippleEffect();
  bindBuildingActions();
  bindInboxControls();
  bindChartDurationPickers();
  bindPriceChart({
    fetchHistory: async (item) => parseJsonResponse(await apiFetch(`/api/market/history/${encodeURIComponent(item)}`)),
    formatCredits: toCurrency
  });

  try {
    await Promise.all([loadBootstrap(), loadStationRegistry()]);

    const url = new URL(window.location.href);
    const accountId = url.searchParams.get("account") || appState.accountId;
    const shouldDummyLogin = url.searchParams.get("dummy") === "1";

    if (shouldDummyLogin) {
      if (!IS_DEV_ACCESS) {
        return;
      }

      const payload = await loginDummyAccount();
      url.searchParams.delete("dummy");
      url.searchParams.delete("account");
      const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", cleanUrl || "/");

      enterGame("account", payload.account.state, {
        accountId: payload.account.id,
        accountEmail: payload.account.email,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        walkthroughCompleted: payload.account.walkthroughCompleted,
        autoPromptWalkthrough: true
      });
      return;
    }

    if (accountId) {
      if (!appState.accountId) {
        appState.accountId = accountId;
      }

      try {
        await restoreAuthenticatedSession();
        url.searchParams.delete("account");
        const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, "", cleanUrl || "/");
        return;
      } catch (error) {
        if (error?.code === "AUTH_SESSION_INVALID") {
          clearSession();
          redirectToLoginPage("expired");
          return;
        }

        console.error("[boot/restoreAuthenticatedSession]", error);
        authShell.innerHTML = `<article class="auth-card"><p class="alert">Session restore failed: ${escapeHtml(error.message || "Unknown error")}</p></article>`;
        return;
      }
    }
  } catch (error) {
    authShell.innerHTML = `<article class="auth-card"><p class="alert">Bootstrap failed: ${error.message}</p></article>`;
  }
}

window.addEventListener("DOMContentLoaded", boot);

// ─── Mail recipients (Bug #711) ──────────────────────────────────────────────
// When several corporations share the name typed into To, the server sends nothing and returns them as candidates.
// The player picks one (told apart by CEO and location); the message is then addressed by that corporation's publicId.
function clearComposeCandidates() {
  const box = document.getElementById("compose-candidates");
  if (!box) return;
  box.hidden = true;
  box.innerHTML = "";
}

function showComposeCandidates(candidates) {
  const box = document.getElementById("compose-candidates");
  if (!box) return;
  box.innerHTML = `<p class="muted">Choose which corporation you mean, then press Send:</p>` + candidates
    .map((c) => `<button type="button" class="btn btn-outline compose-candidate" data-corp-id="${escapeHtml(c.publicId)}" data-corp-name="${escapeHtml(c.corporationName)}">`
      + `${escapeHtml(c.corporationName)} · CEO ${escapeHtml(c.ceo || "unknown")} · ${escapeHtml(c.location || "unknown")}</button>`)
    .join("");
  box.hidden = false;
  box.querySelectorAll(".compose-candidate").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("compose-to-id").value = btn.dataset.corpId;
      box.querySelectorAll(".compose-candidate").forEach((b) => b.classList.toggle("is-selected", b === btn));
      document.getElementById("compose-status").textContent = `Addressed to ${btn.textContent}. Press Send.`;
    });
  });
}
