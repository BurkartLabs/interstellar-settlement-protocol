// The screen around the tabs: the notification bell, the corporation's name and milestone, the replay button,
// collapsible sections and the ripple effect, and the header's own controls (log out, replay, notifications).
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, clearSession } from "../apiClient.js";
import { runIntroDialogue } from "../dialogue.js";
import { sidebarStartsCollapsed } from "../firstAction.js";
import { formatTime } from "../helpers.js";
import { escapeHtml, notificationItemsHtml } from "../html.js";
import { appState } from "../state.js";
import { bindWalkthroughControls, promptWalkthroughOffer, resetWalkthroughForAccount } from "../walkthroughUi.js";
import { stopMiningUiTicker } from "./miningTicker.js";
import { showAuthScreen } from "./shared.js";
import { starmap } from "./starmap.js";

export const replayOnboardingButton = document.getElementById("replay-onboarding-btn");

export const notificationToggleButton = document.getElementById("notification-toggle");

export const notificationCount = document.getElementById("notification-count");

export const notificationPanel = document.getElementById("notification-panel");

export const notificationList = document.getElementById("notification-list");

export const notificationReadAllButton = document.getElementById("notification-read-all");

export function bindRippleEffect() {
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

export function bindCollapsibleSections() {
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

export function renderNotifications() {
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

export async function loadNotifications() {
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

export function updateCorpIdentity(data) {
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

export function updateReplayOnboardingVisibility(data) {
  if (!replayOnboardingButton) return;
  const level = Number(data?.corp?.level || 0);
  replayOnboardingButton.hidden = level >= 5;
}

// TODO(AB#798): Remove. This is defined within gameState.js but should be fetched from the DB or from milestones.json
export const MILESTONE_ROADMAP = [
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

export function bindGlobalControls() {
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
