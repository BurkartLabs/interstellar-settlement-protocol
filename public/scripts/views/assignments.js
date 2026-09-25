// The Assignments tab: the agents, their contracts, the mission modal and completing a contract.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { showActionReceipt } from "./receiptModal.js"; // AB#744
import { missionRewardCredits } from "../ceoEffects.js";
import { missionShortAdvice } from "../contractAdvice.js";
import { deepClone, formatDurationHours, formatTime, toCurrency } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { ASSIGNED_COORDINATOR } from "../liaison.js";
import { appState } from "../state.js";
import { flashButtonSuccess, getInventory, pushFeedback, salvageRemainingMs, updateAllViews } from "./shared.js";

// ISP-297 (AB#1789) gave the Salvage Assignment risk: "None" — a real fourth value this ternary did not have a
// class for, which fell through to risk-high and painted a riskless contract red. Named so a future risk value
// fails the same way loudly (a blank badge) rather than quietly inheriting "high".
export function missionRiskClass(risk) {
  if (risk === "Low") return "risk-low";
  if (risk === "Medium") return "risk-med";
  if (risk === "High") return "risk-high";
  if (risk === "None") return "risk-none";
  return "risk-high";
}

// AB#1051: the reputation tiers and the agent registry (bio, dialogue, station, availability) both come from
// GET /api/mission-agents now — data/missions.json is the one copy, the CEO Insight pattern (Bug #983). Empty
// until loadStationRegistry's boot fetch resolves, same lifecycle as insightPrograms/buildingRegistry.
// ─── Mission Reputation System ─────────────────────────────────────────────
export let REPUTATION_THRESHOLDS = [0];

export let REPUTATION_TITLES = ["Unknown"];

export function getAgentRepLevel(agentId) {
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
export let MISSION_AGENTS = [];

/** Name, title and portrait come from the one record the welcome letter and intro dialogue use (AB#585);
 *  everything else (bio, dialogue, station, availability) comes from the server's own data (AB#1051). */
export function applyMissionAgentsCatalog(agents, reputationTiers) {
  MISSION_AGENTS = (agents || []).map((a) =>
    a.id === ASSIGNED_COORDINATOR.id ? { ...ASSIGNED_COORDINATOR, ...a } : a);
  if (reputationTiers?.thresholds?.length && reputationTiers.thresholds.length === reputationTiers.titles?.length) {
    REPUTATION_THRESHOLDS = reputationTiers.thresholds;
    REPUTATION_TITLES = reputationTiers.titles;
  }
}

export function openMissionModal(missionId, data) {
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

export function closeMissionModal() {
  const modal = document.getElementById("mission-detail-modal");
  if (modal) modal.hidden = true;
  appState.selectedMissionId = null;
}

/** creditedAmount: what was actually paid (Bug #1009), which Contract Law Essentials can make more than the listed reward. */
export function showMissionCompleteOverlay(mission, rep, agentName, creditedAmount) {
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

export function renderMissions(data) {
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

export function renderCombatReports() { /* removed: combat reports tab deprecated */ }

/** Assignments: agents, the mission modal, accepting and completing contracts. */
export function bindAssignmentForms() {
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

    let receiptAnswer = null; // AB#744: the server's answer; none offline, so no receipt
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
      receiptAnswer = account;
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
    // AB#744: after the contract dialog has closed, so the receipt is the one thing on screen.
    showActionReceipt(receiptAnswer, { returnFocusTo: () => document.querySelector("[data-complete-mission], .tab-btn[data-tab='missions']") });
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

    let receiptAnswer = null; // AB#744: the server's answer; offline there is none and the old overlay stays
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
      receiptAnswer = account;
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

    // AB#744: signed in, the ISA's receipt from the server's own figures (reward and standing) replaces the page's
    // overlay, which recomputed the reward; offline, with no server answer, the overlay is still what confirms it.
    if (receiptAnswer) showActionReceipt(receiptAnswer, { returnFocusTo: () => document.querySelector(".tab-btn[data-tab='missions']") });
    else showMissionCompleteOverlay(mission, rep, agentName, rewardCredits);

    renderMissions(appState.data);
    // Bug #1043: renderInventoryPanel was called here and threw (its form is gone), so updateAllViews never ran.
    updateAllViews();
  }

  missionCompleteBtn?.addEventListener("click", () => completeMission(appState.selectedMissionId));
}
