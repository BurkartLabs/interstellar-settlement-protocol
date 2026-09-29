// The screen around the tabs: the notification bell, the corporation's name and milestone, the replay button,
// collapsible sections and the ripple effect, and the header's own controls (log out, replay, notifications).
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, clearSession } from "../apiClient.js";
import { runIntroDialogue } from "../dialogue.js";
import { NARROW_MAX_WIDTH, sidebarStartsCollapsed } from "../firstAction.js";
import { formatTime } from "../helpers.js";
import { escapeHtml, notificationItemsHtml } from "../html.js";
import { protocolLineHtml } from "../protocol.js"; // ISP-254 (AB#950)
import { appState } from "../state.js";
import { bindWalkthroughControls, promptWalkthroughOffer, resetWalkthroughForAccount } from "../walkthroughUi.js";
import { stopMiningUiTicker } from "./miningTicker.js";
import { showAuthScreen } from "./shared.js";
import { starmap } from "./starmap.js";
import { applyNavGroups, applySidebarBlocks, toggleSidebarBlock } from "../sidebarState.js";

export const replayOnboardingButton = document.getElementById("replay-onboarding-btn");

export const notificationToggleButton = document.getElementById("notification-toggle");

export const notificationCount = document.getElementById("notification-count");

export const notificationPanel = document.getElementById("notification-panel");

export const notificationList = document.getElementById("notification-list");

export const notificationReadAllButton = document.getElementById("notification-read-all");

export function bindCollapsibleSections() {
  // AB#1056: at phone width the sidebar filled the first screen, so it starts collapsed there; its toggles still open it.
  // AB#2481: every section of the left column collapses, Milestones and Quick Actions start collapsed on a desktop, and each choice
  // lasts the session (public/scripts/sidebarState.js).
  const narrow = () => sidebarStartsCollapsed(window.innerWidth);
  applySidebarBlocks(narrow());
  applyNavGroups(narrow());
  document.querySelectorAll(".side-panel__toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const controlsId = button.getAttribute("aria-controls");
      if (controlsId && document.getElementById(controlsId)) toggleSidebarBlock(controlsId, narrow());
    });
  });
  // Crossing to a phone's width and back: the bar never has a collapsed group, the column has them again.
  window.matchMedia?.(`(max-width: ${NARROW_MAX_WIDTH}px)`).addEventListener?.("change", () => applyNavGroups(narrow()));
}

export function renderNotifications() {
  if (!notificationList || !notificationCount) {
    return;
  }

  notificationCount.textContent = String(appState.unreadNotifications || 0);

  if (!appState.notifications.length) {
    notificationList.innerHTML = "<li class=\"ui-panel__meta\">No notifications yet.</li>";
    return;
  }

  // Bug #691: every field escaped (public/scripts/html.js, tested in tests/unit/html.test.js).
  notificationList.innerHTML = notificationItemsHtml(appState.notifications.slice(0, 30), formatTime, protocolLineHtml);
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

import { numberMarkup } from "../numberChange.js"; // AB#745: marks a number that is acknowledged when it changes
import { refHtml } from "../html.js"; // ISP-249 (AB#945)
import { bindAccountData } from "./accountData.js"; // ISP-264 (AB#960)
export function updateCorpIdentity(data) {
  const identity = document.getElementById("corp-identity");
  const corp = data.corp;
  identity.innerHTML = `
    <dt>Corporation</dt><dd>${escapeHtml(corp.corporationName)}</dd>
    ${corp.licenceRef ? `<dt>ISA Licence</dt><dd>${refHtml(corp.licenceRef)}</dd>` : ""}
    <dt>CEO</dt><dd>${escapeHtml(corp.ceo)}</dd>
    <dt>Location</dt><dd>${escapeHtml(corp.location || "Earth")}</dd>
    <dt>Level</dt><dd>${corp.level} / ${corp.levelCap}</dd>
    <dt>Employees</dt><dd>${numberMarkup("sidebar:employees", corp.employeeCount)} / ${corp.employeeCap}</dd>
    <dt>Building Slots</dt><dd>${numberMarkup("sidebar:building-slots", corp.buildingSlots)}</dd>
    <dt>Fleet Cap</dt><dd>${numberMarkup("sidebar:fleet-cap", corp.fleet?.cap ?? corp.unlocks.maxFleetSize)}</dd>
  `;

  const milestones = document.getElementById("milestone-list");
  if (milestones) {
    // AB#798: the roadmap is the server's, derived from the levels; this file kept its own copy, which drifted.
    milestones.innerHTML = (appState.milestoneRoadmap || [])
      .map((item) => {
        const done = corp.milestonesCompleted.includes(item);
        return `
          <li class="side-panel__milestone${done ? " is-done" : ""}">
            <span class="ui-badge ${done ? "ui-badge--accent" : "ui-badge--warn"}">${done ? "Done" : "Open"}</span>
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

export function bindGlobalControls() {
  // ISP-264 (AB#960): the Account dialog; once the account is deleted the page signs out as Log Out does (the server
  // has already revoked every session, so there is nothing to tell it)
  bindAccountData({
    onDeleted: () => {
      clearSession();
      appState.authenticated = false;
      appState.data = null;
      appState.profileMode = null;
      stopMiningUiTicker();
      showAuthScreen();
    }
  });
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (appState.accountId) {
        try {
          // AB#757: the server revokes the refresh token in this browser's HttpOnly cookie and clears the cookie.
          await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
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
