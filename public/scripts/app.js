import { renderFinanceCharts } from "./charts.js";
import { createStarmapController } from "./starmap.js";

const appState = {
  serverData: null,
  data: null,
  authenticated: false,
  accountId: null,
  accountEmail: null,
  accessToken: null,
  refreshToken: null,
  profileMode: null,
  walkthroughCompleted: false,
  textOnly: false,
  chatChannel: "global",
  chatAutoScrollOnNextRender: false,
  mapMounted: false,
  walkthroughIndex: 0,
  activeTypewriter: null,
  scoutedBodies: new Set(),
  feedbackLog: [],
  notifications: [],
  unreadNotifications: 0,
  selectedForumThreadId: null,
  completedRequirementIds: new Set(),
  requirementsInitialized: false,
  forumsView: "overview",
  selectedForumCategory: null,
  missionsView: "board",
  selectedMissionId: null,
  activeMissions: [],
  miningUiTicker: null,
  stationRegistry: [],
  buildingRegistry: [],
  inbox: {
    messages: [],
    folder: "inbox",          // active folder tab
    subtype: "official",      // active inbox sub-tab: "official" | "players"
    openMessageId: null,      // message being viewed in detail
    composeDraftId: null,     // draft being edited
    loaded: false
  }
};

const STORAGE_KEYS = {
  accountId: "isp.accountId",
  accessToken: "isp.accessToken",
  refreshToken: "isp.refreshToken",
  walkthroughOfferSeenPrefix: "isp.walkthrough-offer-seen:"
};

const IS_DEV_ACCESS =
  new URL(window.location.href).searchParams.get("dev") === "1" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const DIRECT_INVESTMENT_UNLOCK_LEVEL = 2;

const techTree = [
  {
    id: "tt-basic-extraction",
    name: "Basic Extraction Analytics",
    effect: "+10% raw extraction throughput",
    durationHours: 2,
    costCredits: 18000,
    prereqs: []
  },
  {
    id: "tt-industrial-safety",
    name: "Industrial Safety Protocols",
    effect: "-8% facility downtime risk",
    durationHours: 3,
    costCredits: 26000,
    prereqs: ["tt-basic-extraction"]
  },
  {
    id: "tt-supply-forecast",
    name: "Supply Forecast Engine",
    effect: "+6% logistics efficiency",
    durationHours: 4,
    costCredits: 32000,
    prereqs: ["tt-basic-extraction"]
  },
  {
    id: "tt-energy-routing",
    name: "High-Density Energy Routing",
    effect: "+1 advanced manufacturing lane",
    durationHours: 6,
    costCredits: 54000,
    prereqs: ["tt-industrial-safety", "tt-supply-forecast"]
  }
];

const walkthroughSteps = [
  {
    selector: '.tab-btn[data-tab="overview"]',
    title: "Overview",
    text: "This panel tracks your corporation status and long-term milestone path.",
    tab: "overview"
  },
  {
    selector: '.tab-btn[data-tab="finance"]',
    title: "Financial Core",
    text: "Use this to monitor liabilities and strategic investment activity.",
    tab: "finance"
  },
  {
    selector: '.tab-btn[data-tab="rnd"]',
    title: "Corporate R&D",
    text: "Queue permanent upgrades from your tech tree to scale extraction and infrastructure.",
    tab: "rnd"
  },
  {
    selector: '.tab-btn[data-tab="market"]',
    title: "Galactic Market",
    text: "Create listings from inventory and evaluate market pricing before expanding output.",
    tab: "market"
  },
  {
    selector: '.tab-btn[data-tab="rnd"]',
    title: "First Recommended Action",
    text: "Start by adding Basic Extraction Analytics to your Corporate R&D queue.",
    tab: "rnd"
  }
];

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

const loginPanel = document.getElementById("login-panel");
const registerPanel = document.getElementById("register-panel");
const showLoginButton = document.getElementById("show-login-btn");
const showRegisterButton = document.getElementById("show-register-btn");
const loginDummyButton = document.getElementById("login-dummy-btn");
const loginCancelButton = document.getElementById("login-cancel-btn");
const registerCancelButton = document.getElementById("register-cancel-btn");
const registerForm = document.getElementById("register-form");

const dialogueModal = document.getElementById("dialogue-modal");
const dialogueSpeaker = document.getElementById("dialogue-speaker");
const dialogueTitle = document.getElementById("dialogue-title");
const dialogueText = document.getElementById("dialogue-text");
const dialogueChoices = document.getElementById("dialogue-choices");
const dialogueContinue = document.getElementById("dialogue-continue");

const walkthroughModal = document.getElementById("walkthrough-modal");
const walkthroughTitle = document.getElementById("walkthrough-title");
const walkthroughText = document.getElementById("walkthrough-text");
const walkthroughPrev = document.getElementById("walkthrough-prev");
const walkthroughNext = document.getElementById("walkthrough-next");
const walkthroughEnd = document.getElementById("walkthrough-end");

const starmap = createStarmapController({
  canvas: document.getElementById("starmap-canvas"),
  fallbackEl: document.getElementById("starmap-fallback"),
  detailsEl: document.getElementById("map-details"),
  overlaySelect: document.getElementById("map-overlay"),
  resetButton: document.getElementById("map-reset"),
  onScoutBody(systemId, bodyId) {
    appState.scoutedBodies.add(`${systemId}:${bodyId}`);
  },
  isBodyScouted(systemId, bodyId) {
    return appState.scoutedBodies.has(`${systemId}:${bodyId}`);
  }
});

const socket = typeof io !== "undefined" ? io() : null;

function persistSession() {
  if (appState.accountId) {
    localStorage.setItem(STORAGE_KEYS.accountId, appState.accountId);
  }

  if (appState.accessToken) {
    localStorage.setItem(STORAGE_KEYS.accessToken, appState.accessToken);
  }

  if (appState.refreshToken) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, appState.refreshToken);
  }
}

function clearSession() {
  appState.accountId = null;
  appState.accountEmail = null;
  appState.accessToken = null;
  appState.refreshToken = null;
  appState.inbox = { messages: [], folder: "inbox", subtype: "official", openMessageId: null, composeDraftId: null, loaded: false };
  localStorage.removeItem(STORAGE_KEYS.accountId);
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
}

function walkthroughOfferKey(accountId) {
  if (!accountId) {
    return null;
  }
  return `${STORAGE_KEYS.walkthroughOfferSeenPrefix}${accountId}`;
}

function markWalkthroughOfferSeen(accountId) {
  const key = walkthroughOfferKey(accountId);
  if (!key) {
    return;
  }
  localStorage.setItem(key, "1");
}

function hasSeenWalkthroughOffer(accountId) {
  const key = walkthroughOfferKey(accountId);
  if (!key) {
    return false;
  }
  return localStorage.getItem(key) === "1";
}

function hydrateSession() {
  appState.accountId = localStorage.getItem(STORAGE_KEYS.accountId);
  appState.accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
  appState.refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
}

async function refreshSessionToken() {
  if (!appState.refreshToken) {
    return false;
  }

  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: appState.refreshToken })
  });

  if (!response.ok) {
    clearSession();
    return false;
  }

  const payload = await response.json();
  appState.accessToken = payload.accessToken;
  appState.refreshToken = payload.refreshToken;
  if (payload.account?.id) {
    appState.accountId = payload.account.id;
  }
  persistSession();
  return true;
}

async function apiFetch(url, options = {}, allowRetry = true) {
  const headers = new Headers(options.headers || {});
  if (appState.accessToken) {
    headers.set("Authorization", `Bearer ${appState.accessToken}`);
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && allowRetry && appState.refreshToken) {
    const refreshed = await refreshSessionToken();
    if (refreshed) {
      return apiFetch(url, options, false);
    }
  }

  return response;
}

function toCurrency(number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(number);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function deepClone(input) {
  if (typeof structuredClone === "function") {
    return structuredClone(input);
  }
  return JSON.parse(JSON.stringify(input));
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

function bindCollapsibleSections() {  document.querySelectorAll(".section-toggle").forEach((button) => {
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

  notificationList.innerHTML = appState.notifications
    .slice(0, 30)
    .map((item) => {
      const unreadClass = item.readAt ? "" : " unread";
      return `
        <li class="notification-item${unreadClass}" data-notification-id="${item.id}">
          <p><strong>${item.title}</strong></p>
          <p class="muted">${item.body}</p>
          <p class="notification-meta">${formatTime(item.createdAt)} | ${item.type}</p>
        </li>
      `;
    })
    .join("");
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

async function parseJsonResponse(response) {
  if (!response.ok) {
    const fallback = { error: "Request failed." };
    let payload = fallback;
    try {
      payload = await response.json();
    } catch {
      payload = fallback;
    }

    throw new Error(payload.error || "Request failed.");
  }

  return response.json();
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function clearTypewriter() {
  if (appState.activeTypewriter) {
    clearInterval(appState.activeTypewriter);
    appState.activeTypewriter = null;
  }
}

function typeDialogueText(text, onDone) {
  clearTypewriter();
  dialogueText.textContent = "";
  let index = 0;
  appState.activeTypewriter = setInterval(() => {
    dialogueText.textContent += text[index] || "";
    index += 1;
    if (index >= text.length) {
      clearTypewriter();
      if (onDone) {
        onDone();
      }
    }
  }, 14);
}

function showDialogue({ speaker, title, text, choices = [], continueText = "", onContinue }) {
  dialogueSpeaker.textContent = speaker;
  dialogueTitle.textContent = title;
  dialogueChoices.innerHTML = "";
  dialogueContinue.hidden = true;
  dialogueModal.hidden = false;

  typeDialogueText(text, () => {
    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.className = `btn ${choice.accent ? "btn-accent" : "btn-outline"}`;
      button.textContent = choice.label;
      button.addEventListener("click", choice.onClick);
      dialogueChoices.append(button);
    });

    if (continueText) {
      dialogueContinue.hidden = false;
      dialogueContinue.textContent = continueText;
      dialogueContinue.onclick = onContinue;
    }
  });
}

function closeDialogue() {
  clearTypewriter();
  dialogueModal.hidden = true;
  dialogueChoices.innerHTML = "";
  dialogueContinue.hidden = true;
}

function runIntroDialogue() {
  return new Promise((resolve) => {
    showDialogue({
      speaker: "Assembly Liaison Aria Voss",
      title: "Corporate Confirmation",
      text: "Registration complete. Your corporation is officially chartered under the Interstellar Settlement Protocol. Command authority has been transferred to you as Founder and CEO.",
      choices: [
        {
          label: "Any advice for me?",
          accent: true,
          onClick: () => {
            showDialogue({
              speaker: "Assembly Liaison Aria Voss",
              title: "Starting Advice",
              text: "Hire your initial employees, queue your first Corporate R&D project, and establish your first mining operation before overcommitting to military spend. Use market contracts to smooth bottlenecks.",
              continueText: "Proceed To Command Interface",
              onContinue: () => {
                closeDialogue();
                resolve();
              }
            });
          }
        },
        {
          label: "Proceed. I understand the basics.",
          onClick: () => {
            closeDialogue();
            resolve();
          }
        }
      ]
    });
  });
}

function createNewPlayerState(baseState, ceoName, corpName) {
  const next = deepClone(baseState);
  next.corp = {
    ...next.corp,
    ceo: ceoName,
    corporationName: corpName,
    level: 0,
    milestonesCompleted: [],
    employeeCap: 8,
    employeeCount: 0,
    buildingSlots: 2,
    buildings: [{ name: "Headquarters", tier: 1, status: "Operational" }],
    military: {
      lightFighters: 0,
      destroyers: 0,
      siegeEngines: 0,
      attackValue: 0,
      defenseValue: 0,
      modifiers: {
        rdBonusPct: 0,
        ceoLeadershipPct: 0
      }
    },
    finances: {
      ...next.corp.finances,
      credits: 150000,
      liabilities: 0,
      assets: 150000,
      dailyRevenue: 0,
      dailyCosts: 0,
      taxRatePct: 14,
      bondYieldPct: 0
    },
    inventory: {},
    mining: {
      silicateExtractors: []
    },
    unlocks: {
      marketSectors: [],
      maxUpgradeTier: 1,
      maxFleetSize: 0,
      maxBasicExtractorYards: 1
    },
    investments: [],
    unlockedTech: []
  };

  next.queues = {
    corporateRnD: [],
    ceoInsight: []
  };

  next.playerProfile = {
    isNewPlayer: true,
    registeredAt: Date.now()
  };

  return next;
}

function getInventory() {
  if (!appState.data?.corp?.inventory) {
    appState.data.corp.inventory = {};
  }
  return appState.data.corp.inventory;
}

function renderInventoryPanel() {
  const inventory = getInventory();
  const inventoryList = document.getElementById("inventory-list");
  const listingItem = document.getElementById("listing-item");
  const listingQuantity = document.getElementById("listing-quantity");
  const listingSubmit = document.getElementById("listing-submit");
  const status = document.getElementById("listing-status");

  const entries = Object.entries(inventory).filter(([, qty]) => Number(qty) > 0);

  if (!entries.length) {
    inventoryList.innerHTML = "<li>No inventory available yet. Begin mining and refining to generate tradable stock.</li>";
    listingItem.innerHTML = '<option value="">No inventory</option>';
    listingSubmit.disabled = true;
    listingQuantity.value = "1";
    listingQuantity.max = "1";
    status.textContent = "No listing can be created until inventory exists.";
    return;
  }

  inventoryList.innerHTML = entries
    .map(([name, qty]) => `<li>${name}: ${qty}</li>`)
    .join("");

  listingItem.innerHTML = entries
    .map(([name, qty]) => `<option value="${name}">${name} (${qty} available)</option>`)
    .join("");

  const selectedQty = entries.find(([name]) => name === listingItem.value)?.[1] || entries[0][1];
  listingQuantity.max = String(selectedQty);
  listingSubmit.disabled = false;
  status.textContent = "";
}

function availableTechNodes(data) {
  const done = new Set(data.corp.unlockedTech || []);
  const inQueue = new Set((data.queues.corporateRnD || []).map((item) => item.techId).filter(Boolean));

  return techTree.filter((node) => {
    if (done.has(node.id) || inQueue.has(node.id)) {
      return false;
    }
    return node.prereqs.every((req) => done.has(req));
  });
}

function renderTechTree(data) {
  const treeWrap = document.getElementById("rnd-tech-tree");
  const done = new Set(data.corp.unlockedTech || []);
  const inQueue = new Set((data.queues.corporateRnD || []).map((item) => item.techId).filter(Boolean));

  treeWrap.innerHTML = techTree
    .map((node) => {
      const prereqLabel = node.prereqs.length ? node.prereqs.map((id) => techTree.find((it) => it.id === id)?.name).join(", ") : "None";
      const lockedByReq = !node.prereqs.every((req) => done.has(req));
      const status = done.has(node.id) ? "Unlocked" : inQueue.has(node.id) ? "Queued" : lockedByReq ? "Locked" : "Available";
      return `
      <article class="data-card">
        <h3>${node.name}</h3>
        <p>${node.effect}</p>
        <p class="muted">Duration: ${node.durationHours}h</p>
        <p class="muted">Funding: ${toCurrency(node.costCredits)} credits</p>
        <p class="muted">Prerequisites: ${prereqLabel}</p>
        <p class="muted">Status: ${status}</p>
      </article>
    `;
    })
    .join("");

  const select = document.getElementById("rnd-select");
  const options = availableTechNodes(data);
  if (!options.length) {
    select.innerHTML = '<option value="">No available research nodes</option>';
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = options.map((node) => `<option value="${node.id}">${node.name} (${node.durationHours}h)</option>`).join("");
  }

  renderResearchSelectionDetails(data);
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
    <dt>Fleet Cap</dt><dd>${corp.unlocks.maxFleetSize}</dd>
  `;

  const milestones = document.getElementById("milestone-list");
  if (milestones) {
    milestones.innerHTML = corp.milestoneRoadmap
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
  if (overviewEl) overviewEl.hidden = false;
  if (detailEl) detailEl.hidden = true;
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
  renderBuildingDetail(building, appState.data);
  setTab("station");
}

function renderBuildingDetail(building, data) {
  const contentEl = document.getElementById("station-building-content");
  if (!contentEl) return;

  if (building.id === "orbital-executive-suites") {
    contentEl.innerHTML = renderOrbitalExecutiveSuites(building, data);
    bindOfficeActions(building, data);
  } else {
    contentEl.innerHTML = `
      <div class="building-detail-header">
        <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
        <h2>${escapeHtml(building.name)}</h2>
      </div>
      <p class="muted lede">${escapeHtml(building.description)}</p>
      <p class="building-flavor">${escapeHtml(building.flavor)}</p>
      <p class="muted" style="margin-top:1.5rem;">This office is not yet operational. Check back in a future update.</p>
    `;
  }
}

function renderOrbitalExecutiveSuites(building, data) {
  const corp = data.corp;
  const currentBody = corp?.location || "Earth";
  const station = appState.stationRegistry.find((s) => s.body === currentBody) || appState.stationRegistry[0];
  const stationId = station?.id || "earth-station-prime";
  const officeCost = station?.officeCost || 20000;

  const existingOffice = (corp.offices || []).find((o) => o.stationId === stationId);

  const headerHtml = `
    <div class="building-detail-header">
      <span class="faction-code-badge">${escapeHtml(building.factionCode)}</span>
      <h2>${escapeHtml(building.name)}</h2>
    </div>
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
          <dt>Lease Cost</dt><dd>${toCurrency(officeCost)} credits (one-time)</dd>
          <dt>Station</dt><dd>${escapeHtml(station?.name || stationId)}</dd>
          <dt>Location</dt><dd>${escapeHtml(currentBody)}, ${escapeHtml(station?.systemId?.toUpperCase() || "SOL")}</dd>
        </dl>
        <button id="rent-office-btn" class="btn btn-accent" type="button">Execute Lease Agreement</button>
        <p id="rent-office-status" class="muted action-hint"></p>
      </section>
    `;
  }

  const rentedDate = new Date(existingOffice.rentedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });
  const availableStaffCapacity = Math.max(1, corp.employeeCap - corp.employeeCount);

  return `
    ${headerHtml}

    <section class="form-card" style="margin-top:1.5rem;max-width:750px;">
      <h3>Office Status</h3>
      <dl class="kv-list kv-list--compact">
        <dt>Status</dt><dd><span class="building-status-badge operational">Active Lease</span></dd>
        <dt>Station</dt><dd>${escapeHtml(existingOffice.name)}</dd>
        <dt>Location</dt><dd>${escapeHtml(existingOffice.body)}, ${escapeHtml(existingOffice.systemId?.toUpperCase() || "SOL")}</dd>
        <dt>Lease Commenced</dt><dd>${rentedDate}</dd>
      </dl>
    </section>

    <section class="form-card action-surface" style="margin-top:1rem;">
      <h3>Workforce — Hire Personnel</h3>
      <p class="muted">Recruit employees through your registered office. Each hire costs ${toCurrency(1200)} credits and adds ${toCurrency(36)}/day to operational payroll.</p>
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

    <section class="form-card" style="margin-top:1rem;">
      <h3>ISA Claims &amp; Leases Division</h3>
      <p class="muted">Purchase mining extraction rights for registered bodies within the Sol system. Leases are issued by the ISA and required before beginning off-world extraction operations.</p>
      <p class="muted" style="margin-top:0.6rem;"><em>ISA lease applications are not yet operational. This service will be available in a future update.</em></p>
    </section>
  `;
}

function bindOfficeActions(building, data) {
  const rentBtn = document.getElementById("rent-office-btn");
  if (rentBtn) {
    rentBtn.addEventListener("click", async () => {
      const statusEl = document.getElementById("rent-office-status");
      const corp = appState.data?.corp;
      const currentBody = corp?.location || "Earth";
      const station = appState.stationRegistry.find((s) => s.body === currentBody) || appState.stationRegistry[0];

      rentBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Processing lease agreement...";

      try {
        if (appState.accountId) {
          const response = await apiFetch(
            `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/rent-office`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stationId: station?.id || "earth-station-prime" }) }
          );
          const account = await parseJsonResponse(response);
          appState.data = deepClone(account.state);
          appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
          updateAllViews();
          showStationBuilding(building.id);
        } else {
          const cost = station?.officeCost || 20000;
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
            rentedAt: Date.now()
          });
          appState.data.corp.officeRented = true;
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
          const cost = hired * 1200;
          if (hired <= 0) throw new Error("No available headroom to hire additional personnel.");
          if (corp.finances.credits < cost) throw new Error(`Hiring requires ${toCurrency(cost)} credits.`);
          corp.employeeCount += hired;
          corp.finances.credits -= cost;
          corp.finances.dailyCosts += hired * 36;
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

function renderStation(data) {
  const header = document.getElementById("station-location-header");
  const npcGrid = document.getElementById("station-npc-buildings");
  const playerGrid = document.getElementById("station-player-buildings");
  if (!header || !npcGrid || !playerGrid) {
    return;
  }

  const currentBody = data.corp?.location || "Earth";
  const station = appState.stationRegistry.find((s) => s.body === currentBody) || appState.stationRegistry[0];

  if (!station) {
    header.innerHTML = `<h2>Station</h2><p class="muted">No station data available for your current location.</p>`;
    return;
  }

  header.innerHTML = `
    <p class="overline">${escapeHtml(station.designation)} &#47;&#47; ${escapeHtml(station.systemId.toUpperCase())}</p>
    <h2>${escapeHtml(station.name)}</h2>
    <p class="muted lede">${escapeHtml(station.description)}</p>
  `;

  const stationBuildings = station.buildingIds
    .map((id) => appState.buildingRegistry.find((b) => b.id === id))
    .filter(Boolean);

  const npcBuildings = stationBuildings.filter((b) => b.owner === "npc");

  npcGrid.innerHTML = npcBuildings
    .map((b) => {
      const actionBtn = b.available
        ? `<button class="btn btn-outline" data-building-action="${escapeHtml(b.action)}">Enter</button>`
        : `<span class="building-status-badge">Coming Soon</span>`;
      return `
        <article class="building-card data-card">
          <header class="building-card-header">
            <span class="faction-code-badge">${escapeHtml(b.factionCode)}</span>
            <h3>${escapeHtml(b.name)}</h3>
          </header>
          <p class="muted building-description">${escapeHtml(b.description)}</p>
          <p class="building-flavor">${escapeHtml(b.flavor)}</p>
          <footer class="building-card-footer">${actionBtn}</footer>
        </article>
      `;
    })
    .join("");

  const corpBuildings = (data.corp?.buildings || []).filter((b) => b.status === "Operational");
  if (!corpBuildings.length) {
    playerGrid.innerHTML = `<p class="muted">No corporate holdings registered at this station. Buildings constructed through your Corporation Overview will appear here once commissioned.</p>`;
  } else {
    playerGrid.innerHTML = corpBuildings
      .map(
        (b) => `
        <article class="building-card data-card">
          <header class="building-card-header">
            <span class="faction-code-badge corp-badge">CORP</span>
            <h3>${escapeHtml(b.name)}</h3>
          </header>
          <p class="muted">Tier ${b.tier || 1} &mdash; ${escapeHtml(b.status)}</p>
          <footer class="building-card-footer"><span class="building-status-badge operational">Operational</span></footer>
        </article>
      `
      )
      .join("");
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
}

function updateInvestmentPanel(data) {
  const form = document.getElementById("investment-form");
  const status = document.getElementById("investment-lock-message");
  if (!form || !status) {
    return;
  }

  const unlocked = Number(data.corp.level || 0) >= DIRECT_INVESTMENT_UNLOCK_LEVEL;
  Array.from(form.elements).forEach((field) => {
    field.disabled = !unlocked;
  });
  status.textContent = unlocked
    ? "Direct investment channels are available. Use them carefully; capital committed here is illiquid."
    : `Direct corporation investments unlock at Corporation Level ${DIRECT_INVESTMENT_UNLOCK_LEVEL}.`;
}

function updateOverview(data) {
  const cards = [
    {
      title: "Cash Reserves",
      value: toCurrency(data.corp.finances.credits),
      body: "Total corporate credits on hand."
    },
    {
      title: "Net Daily Flow",
      value: toCurrency(data.corp.finances.dailyRevenue - data.corp.finances.dailyCosts),
      body: "Daily revenue minus operational burn. This drives long-horizon compounding over years."
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
  ];

  const wrap = document.getElementById("overview-cards");
  wrap.innerHTML = cards
    .map(
      (card) => `
      <section class="data-card">
        <h3>${card.title}</h3>
        <p><strong>${card.value}</strong></p>
        <p class="muted">${card.body}</p>
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

  const level = Number(data?.corp?.level || 0);
  const nextLevel = level + 1;
  const nextKey = `level${nextLevel}`;
  const nextProgress = data?.corp?.levelProgress?.[nextKey];

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
      return `
      <section class="data-card requirement-card${doneClass}${justCompletedClass}">
        <h3 class="requirement-title">${req.title}</h3>
        <p><strong>${req.progress} / ${req.target}</strong></p>
        <p class="muted requirement-state">${req.complete ? "Completed" : "In Progress"}</p>
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

function formatDurationHours(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0h";
  }
  const totalMinutes = Math.max(0, Math.floor(ms / (1000 * 60)));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
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
    renderActionHints(appState.data);
    renderQueue("rnd-queue", appState.data.queues?.corporateRnD || [], "Permanent corporate unlock track");
    renderQueue("ceo-queue", appState.data.queues?.ceoInsight || [], "CEO-centric growth track");

    // Refresh from server every 60 seconds if any extractor is active
    tickCount += 1;
    if (tickCount % 60 === 0) {
      const hasActiveCycle = (appState.data?.corp?.mining?.silicateExtractors || []).some((ex) => ex.active);
      if (hasActiveCycle) {
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

function renderActionHints(data) {
  const hireInput = document.getElementById("level2-hire-count");
  const hireHint = document.getElementById("hire-action-hint");
  const buildHint = document.getElementById("build-action-hint");
  const mineExtractorId = document.getElementById("mine-extractor-id");
  const mineInput = document.getElementById("mine-amount");
  const mineHoursInput = document.getElementById("mine-hours");
  const mineHint = document.getElementById("mine-action-hint");
  const mineBtn = document.getElementById("mine-btn");

  if (!hireInput || !hireHint || !buildHint || !mineExtractorId || !mineInput || !mineHoursInput || !mineHint || !mineBtn) {
    return;
  }

  const corp = data.corp;
  const availableStaffCapacity = Math.max(1, corp.employeeCap - corp.employeeCount);
  const hireCount = Math.max(1, Number(hireInput.value || 1));
  const adjustedHireCount = Math.min(hireCount, availableStaffCapacity);
  const hireCost = adjustedHireCount * 1200;

  hireInput.max = String(availableStaffCapacity);
  if (Number(hireInput.value || 1) !== adjustedHireCount) {
    hireInput.value = String(adjustedHireCount);
  }

  hireHint.textContent = `Immediate funding: ${toCurrency(hireCost)} credits. Ongoing payroll impact: ${toCurrency(adjustedHireCount * 36)}/day. Available headroom: ${corp.employeeCap - corp.employeeCount} employee(s).`;

  const extractorCount = (corp.buildings || []).filter((b) => b.name === "Basic Extractor Yard").length;
  const extractorCap = Number(corp.unlocks?.maxBasicExtractorYards || 1);
  buildHint.textContent = `Requires 1 free building slot and ${toCurrency(65000)} credits. Current slots: ${corp.buildings.length}/${corp.buildingSlots}. Extractor cap: ${extractorCount}/${extractorCap}.`;

  const throughputPerHour = Math.max(10, Math.min(250, Number(mineInput.value || 80)));
  if (Number(mineInput.value || 80) !== throughputPerHour) {
    mineInput.value = String(throughputPerHour);
  }

  const cycleHours = Math.max(1, Math.min(72, Number(mineHoursInput.value || 24)));
  if (Number(mineHoursInput.value || 24) !== cycleHours) {
    mineHoursInput.value = String(cycleHours);
  }

  const operationCostPerHour = Math.max(600, Math.round(throughputPerHour * 16));
  const startupCost = Math.max(500, Math.round(operationCostPerHour * 0.35));
  const extractors = corp.mining?.silicateExtractors || [];

  if (!mineExtractorId.options.length || mineExtractorId.options.length !== extractors.length) {
    mineExtractorId.innerHTML = extractors
      .map((ex) => `<option value="${escapeHtml(ex.id)}">${escapeHtml(ex.name || ex.id)}</option>`)
      .join("");
  }

  if (!extractors.some((ex) => ex.id === mineExtractorId.value) && extractors.length) {
    mineExtractorId.value = extractors[0].id;
  }

  const selectedExtractor = extractors.find((ex) => ex.id === mineExtractorId.value) || extractors[0];
  const hasExtractor = extractorCount > 0;
  const cycleActive = isExtractorCycleActive(selectedExtractor);

  mineBtn.disabled = cycleActive;
  mineBtn.textContent = cycleActive ? "Mining Cycle Active" : "Start Mining Cycle";
  mineHint.textContent = !hasExtractor
    ? "Mining cycles unlock after Basic Extractor Yard is operational."
    : cycleActive
      ? `${selectedExtractor?.name || "Selected extractor"} already has an active cycle. Choose another yard or wait for completion.`
      : `Cycle profile: ${throughputPerHour}/hour for ${cycleHours}h. Startup cost: ${toCurrency(startupCost)}. Operating spend: ${toCurrency(operationCostPerHour)}/hour.`;

  renderMiningCyclePanel(data);
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
    el.innerHTML = `<article class="queue-item"><p>No queued items yet.</p><p class="muted">${subtitle}</p></article>`;
    return;
  }

  el.innerHTML = queue
    .map((item) => {
      const progress = queueProgress(item);
      return `
      <article class="queue-item">
        <h3>${item.name}</h3>
        <p class="muted">${subtitle}</p>
        <p>${item.effect}</p>
        <p class="muted">Duration: ${item.durationHours}h | ${item.startedAt ? "In progress" : "Queued"}</p>
        ${item.costCredits ? `<p class="muted">Committed funding: ${toCurrency(item.costCredits)} credits</p>` : ""}
        <div class="progress-wrap"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
      </article>
      `;
    })
    .join("");
}

function renderRefinery(data) {
  const catalog = document.getElementById("resource-catalog");
  catalog.innerHTML = data.world.resourceCatalog.map((res) => `<span class="pill">${res}</span>`).join("");

  const chains = document.getElementById("refinery-chains");
  chains.innerHTML = data.world.refineryChains
    .map(
      (chain) => `
      <section class="data-card">
        <h3>${chain.input}</h3>
        <p class="muted">Outputs: ${chain.outputs.join(" -> ")}</p>
        <p class="muted">R&D Gate: ${chain.requiresResearch.join(", ")}</p>
      </section>
    `
    )
    .join("");
}

function renderMarket(data) {
  const buyTable = document.getElementById("exchange-buy-table");
  const buyEmpty = document.getElementById("exchange-buy-empty");
  const sellGrid = document.getElementById("market-sell-grid");
  const sellEmpty = document.getElementById("market-sell-empty");
  const mySellOrdersTable = document.getElementById("my-sell-orders-table");
  const mySellOrdersEmpty = document.getElementById("my-sell-orders-empty");
  const myCorpName = String(data?.corp?.corporationName || "").trim().toLowerCase();
  const myEmail = String(appState.accountEmail || "").trim().toLowerCase();
  const isOwnSellOrder = (order) => {
    if (order?.sellerAccountId && appState.accountId && order.sellerAccountId === appState.accountId) {
      return true;
    }
    const seller = String(order?.seller || "").trim().toLowerCase();
    if (!seller) {
      return false;
    }
    return Boolean((myCorpName && seller === myCorpName) || (myEmail && seller === myEmail));
  };

  const sellOrders = (data.market.orderBook || []).filter((order) => order.type === "sell" && !isOwnSellOrder(order)).slice(0, 30);
  const mySellOrders = (data.market.orderBook || [])
    .filter((order) => order.type === "sell" && isOwnSellOrder(order))
    .slice(0, 50);

  if (buyTable) {
    buyTable.innerHTML = sellOrders
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

  if (buyEmpty) {
    buyEmpty.hidden = sellOrders.length > 0;
  }

  const mercBook = document.getElementById("mercenary-book");
  mercBook.innerHTML = data.market.mercenaryContracts
    .map(
      (item) =>
        `<li><strong>${item.provider}</strong> renting ${item.unitType} (Power ${item.strength}) for ${toCurrency(item.ratePerHour)}/hour over ${item.durationHours}h.</li>`
    )
    .join("");

  const inventory = getInventory();
  const entries = Object.entries(inventory).filter(([, qty]) => Number(qty) > 0);
  const inventoryList = document.getElementById("inventory-list");
  inventoryList.innerHTML = entries.length
    ? entries.map(([name, qty]) => `<li>${escapeHtml(name)}: ${Number(qty).toLocaleString()}</li>`).join("")
    : "<li>No inventory available yet. Begin mining and refining to generate tradable stock.</li>";

  if (sellGrid) {
    sellGrid.innerHTML = entries
      .map(
        ([name, qty]) => `
          <tr>
            <td>${escapeHtml(name)}</td>
            <td>${Number(qty).toLocaleString()}</td>
            <td><input class="sell-input" type="number" min="1" max="${Number(qty)}" value="1" data-sell-qty="${escapeHtml(name)}" /></td>
            <td><input class="sell-input" type="number" min="1" value="50" data-sell-price="${escapeHtml(name)}" /></td>
            <td><button class="btn btn-accent" type="button" data-sell-item="${escapeHtml(name)}">Create Listing</button></td>
          </tr>
        `
      )
      .join("");
  }

  if (sellEmpty) {
    sellEmpty.hidden = entries.length > 0;
  }

  if (mySellOrdersTable) {
    mySellOrdersTable.innerHTML = mySellOrders
      .map(
        (order) => `
          <tr>
            <td>${escapeHtml(order.item)}</td>
            <td>${Number(order.quantity).toLocaleString()}</td>
            <td>${toCurrency(order.unitPrice)}</td>
            <td>${order.createdAt ? formatTime(order.createdAt) : "-"}</td>
          </tr>
        `
      )
      .join("");
  }

  if (mySellOrdersEmpty) {
    mySellOrdersEmpty.hidden = mySellOrders.length > 0;
  }
}

function renderForums(data) {
  const overviewView = document.getElementById("forum-overview-view");
  const threadView = document.getElementById("forum-thread-view");

  if (appState.forumsView === "thread") {
    if (overviewView) overviewView.hidden = true;
    if (threadView) threadView.hidden = false;

    const selected = (data.forums.threads || []).find((t) => t.id === appState.selectedForumThreadId);
    const detailBody = document.getElementById("forum-thread-detail-body");
    if (detailBody && selected) {
      const repliesHtml = selected.replies.length
        ? `<ul class="thread-reply-list">
            ${selected.replies
              .map(
                (reply) => `
                <li class="thread-reply">
                  <p><strong>${escapeHtml(reply.author)}</strong></p>
                  <p>${escapeHtml(reply.content)}</p>
                  <p class="notification-meta">${formatTime(reply.createdAt)} | ${Number(reply.likes)} likes</p>
                </li>`
              )
              .join("")}
          </ul>`
        : `<p class="muted">No replies yet.</p>`;

      detailBody.innerHTML = `
        <article class="form-card">
          <p class="overline">${escapeHtml(selected.category)}</p>
          <h2>${escapeHtml(selected.title)}</h2>
          <p class="muted">Started by <strong>${escapeHtml(selected.author)}</strong> &mdash; ${Number(selected.likes)} likes &mdash; ${selected.replies.length} repl${selected.replies.length === 1 ? "y" : "ies"}</p>
          <section class="thread-op-block">
            <p class="overline">Thread Summary</p>
            <p class="muted">Discussion entry point by ${escapeHtml(selected.author)}. Reply log begins below.</p>
          </section>
          <p class="overline" style="margin-top:1rem">Replies</p>
          ${repliesHtml}
        </article>
      `;
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
      (data.forums.categories || [])
        .map(
          (cat) =>
            `<button class="forum-category-btn${appState.selectedForumCategory === cat ? " active" : ""}" type="button" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
        )
        .join("");
  }

  const filtered = appState.selectedForumCategory
    ? (data.forums.threads || []).filter((t) => t.category === appState.selectedForumCategory)
    : (data.forums.threads || []);

  const threadsEl = document.getElementById("forum-threads");
  if (threadsEl) {
    if (!filtered.length) {
      threadsEl.innerHTML = `<p class="muted">No threads in this category yet.</p>`;
    } else {
      threadsEl.innerHTML = filtered
        .map(
          (thread) => `
          <button class="forum-thread-card" type="button" data-thread-id="${thread.id}">
            <p class="overline" style="margin-bottom:0.3rem">${escapeHtml(thread.category)}</p>
            <h3>${escapeHtml(thread.title)}</h3>
            <p class="muted">by ${escapeHtml(thread.author)} &mdash; ${Number(thread.likes)} likes &mdash; ${thread.replies.length} repl${thread.replies.length === 1 ? "y" : "ies"}</p>
          </button>`
        )
        .join("");
    }
  }
}

function renderMissions(data) {
  const boardView = document.getElementById("missions-board-view");
  const detailView = document.getElementById("mission-detail-view");

  const activeMissions = appState.activeMissions || [];
  const activeIds = new Set(activeMissions.map((m) => m.id));
  const available = (data.missions || []).filter((m) => !activeIds.has(m.id));

  if (appState.missionsView === "detail") {
    if (boardView) boardView.hidden = true;
    if (detailView) detailView.hidden = false;

    const mission = (data.missions || []).find((m) => m.id === appState.selectedMissionId);
    if (mission) {
      const typeEl = document.getElementById("mission-detail-type");
      const titleEl = document.getElementById("mission-detail-title");
      const rewardEl = document.getElementById("mission-detail-reward");
      const textEl = document.getElementById("mission-detail-text");
      const riskEl = document.getElementById("mission-detail-risk");
      const acceptBtn = document.getElementById("mission-accept-btn");

      if (typeEl) typeEl.textContent = `${mission.type} \u2014 Risk Level: ${mission.risk}`;
      if (titleEl) titleEl.textContent = mission.title;
      if (rewardEl) rewardEl.textContent = `Reward: ${mission.reward}`;
      if (textEl) textEl.textContent = mission.text;
      if (riskEl) {
        riskEl.textContent = mission.canShiftControl
          ? "Control Shift Potential: Yes \u2014 completing this mission may alter territorial influence."
          : "Control Shift Potential: None \u2014 this mission does not affect territorial control.";
      }
      if (acceptBtn) {
        acceptBtn.hidden = activeIds.has(mission.id);
        acceptBtn.textContent = "Accept Mission";
      }
    }
    return;
  }

  if (boardView) boardView.hidden = false;
  if (detailView) detailView.hidden = true;

  const missionList = document.getElementById("mission-list");
  if (missionList) {
    missionList.innerHTML = available.length
      ? available
          .map(
            (mission) => `
          <section class="data-card mission-card" data-mission-id="${mission.id}" role="button" tabindex="0" style="cursor:pointer">
            <h3>${escapeHtml(mission.title)}</h3>
            <p class="muted">${escapeHtml(mission.type)} | Risk: ${escapeHtml(mission.risk)}</p>
            <p>${escapeHtml(mission.text)}</p>
            <p class="muted">Reward: ${escapeHtml(mission.reward)}</p>
            <p class="muted" style="margin-top:0.55rem;font-size:0.82rem">View briefing \u2192</p>
          </section>`
          )
          .join("")
      : `<section class="data-card"><p class="muted">No missions currently available. Check back for new field operations.</p></section>`;
  }

  const activeMissionList = document.getElementById("active-mission-list");
  const activeEmpty = document.getElementById("active-missions-empty");
  if (activeMissions.length) {
    if (activeEmpty) activeEmpty.hidden = true;
    if (activeMissionList) {
      activeMissionList.innerHTML = activeMissions
        .map(
          (mission) => `
          <section class="data-card">
            <h3>${escapeHtml(mission.title)}</h3>
            <p class="muted">${escapeHtml(mission.type)} | Risk: ${escapeHtml(mission.risk)}</p>
            <p class="muted">Reward: ${escapeHtml(mission.reward)}</p>
            <div style="margin-top:0.7rem">
              <button class="btn btn-outline" type="button" data-abandon-mission="${mission.id}">Abandon Mission</button>
            </div>
          </section>`
        )
        .join("");
    }
  } else {
    if (activeEmpty) activeEmpty.hidden = false;
    if (activeMissionList) activeMissionList.innerHTML = "";
  }
}

function renderCombatReports(data) {
  const reports = document.getElementById("combat-reports");
  reports.innerHTML = data.combatReports
    .map(
      (report) =>
        `<li><strong>${report.winner}</strong> won. ${report.summary} <span class="muted">${formatTime(report.createdAt)}</span></li>`
    )
    .join("");

  if (!data.combatReports.length) {
    reports.innerHTML = "<li>No combat reports yet. Simulate a battle to generate one.</li>";
  }
}

function renderChatLog(data) {
  const channel = appState.chatChannel;
  const messages = data?.chatLog?.[channel] || [];
  const chatLog = document.getElementById("chat-log");

  if (!chatLog) {
    return;
  }

  chatLog.innerHTML = messages
    .slice(-120)
    .map(
      (msg) => `
      <li class="chat-msg">
        <div class="chat-meta">${escapeHtml(msg.author)} | ${formatTime(msg.createdAt)}</div>
        <div>${escapeHtml(msg.content)}</div>
      </li>
      `
    )
    .join("");

  if (appState.chatAutoScrollOnNextRender) {
    chatLog.scrollTop = chatLog.scrollHeight;
    appState.chatAutoScrollOnNextRender = false;
  }
}

function renderChatChannelTabs() {
  const tabs = Array.from(document.querySelectorAll("[data-chat-channel-tab]"));
  tabs.forEach((tab) => {
    const selected = tab.getAttribute("data-chat-channel-tab") === appState.chatChannel;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
}

function updateAllViews() {
  const data = appState.data;
  if (!data || !appState.authenticated) {
    return;
  }

  updateCorpIdentity(data);
  updateOverview(data);
  updateReplayOnboardingVisibility(data);
  renderStation(data);
  renderLevel2Progress(data);
  renderActionHints(data);
  renderQueue("rnd-queue", data.queues.corporateRnD, "Permanent corporate unlock track");
  renderQueue("ceo-queue", data.queues.ceoInsight, "CEO-centric growth track");
  renderTechTree(data);
  renderRefinery(data);
  renderMarket(data);
  renderForums(data);
  renderMissions(data);
  renderCombatReports(data);
  renderChatLog(data);
  renderChatChannelTabs();
  renderFinanceCharts(data.corp.finances);
  renderFeedbackLog();
  updateInvestmentPanel(data);
  starmap.setSystems(data.world.systems);
  renderInboxMessageList();
}

async function runLevel2Action(endpoint, payload = null) {
  if (!appState.accountId) {
    const status = document.getElementById("level2-status");
    if (status) {
      status.textContent = "Level progression actions require an authenticated account profile.";
    }
    return;
  }

  const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined
  });

  const account = await parseJsonResponse(response);
  appState.data = deepClone(account.state);
  appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
  updateAllViews();
  return account;
}

function bindLevel2Controls() {
  const hireForm = document.getElementById("level2-hire-form");
  const hireCount = document.getElementById("level2-hire-count");
  const buildBtn = document.getElementById("level2-build-btn");
  const mineForm = document.getElementById("mine-form");
  const mineExtractorId = document.getElementById("mine-extractor-id");
  const mineAmount = document.getElementById("mine-amount");
  const mineHours = document.getElementById("mine-hours");
  const mineBtn = document.getElementById("mine-btn");
  const status = document.getElementById("level2-status");

  if (!hireForm || !hireCount || !buildBtn || !mineForm || !mineExtractorId || !mineAmount || !mineHours || !mineBtn) {
    return;
  }

  hireForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const count = Math.max(1, Number(hireCount.value || 1));
    try {
      const account = await runLevel2Action("/gameplay/hire", { count });
      pushFeedback(
        `Hiring order confirmed. ${count} employee(s) onboarded for ${toCurrency(count * 1200)}. Payroll burn increased by ${toCurrency(count * 36)}/day.`,
        "success"
      );
      flashButtonSuccess(hireForm.querySelector(".btn-accent"));
      if (status) {
        status.textContent = `Staffing expansion approved. Corporation headcount is now ${account.state.corp.employeeCount}/${account.state.corp.employeeCap}.`;
      }
    } catch (error) {
      if (status) {
        status.textContent = `Hire action failed: ${error.message}`;
      }
      pushFeedback(`Hiring order rejected. ${error.message}`, "error");
    }
  });

  buildBtn.addEventListener("click", async () => {
    try {
      await runLevel2Action("/gameplay/build-extractor");
      pushFeedback(
        `Basic Extractor Yard commissioned. ${toCurrency(65000)} capital deployed and your first persistent mining line is now available.`,
        "success"
      );
      flashButtonSuccess(buildBtn);
      if (status) {
        status.textContent = "Basic Extractor Yard construction completed. You can now launch silicate extraction cycles.";
      }
    } catch (error) {
      if (status) {
        status.textContent = `Build action failed: ${error.message}`;
      }
      pushFeedback(`Extractor construction blocked. ${error.message}`, "error");
    }
  });

  hireCount.addEventListener("input", () => renderActionHints(appState.data));
  mineExtractorId.addEventListener("change", () => renderActionHints(appState.data));
  mineAmount.addEventListener("input", () => renderActionHints(appState.data));
  mineHours.addEventListener("input", () => renderActionHints(appState.data));

  mineForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const extractorId = String(mineExtractorId.value || "");
    const amount = Math.max(10, Math.min(250, Number(mineAmount.value || 80)));
    const hours = Math.max(1, Math.min(72, Number(mineHours.value || 24)));
    const hasExtractor = Boolean(appState.data?.corp?.buildings?.some((b) => b.name === "Basic Extractor Yard"));

    if (!hasExtractor) {
      const message = "Build the Basic Extractor Yard first, then start a mining cycle.";
      if (status) {
        status.textContent = message;
      }
      pushFeedback(message, "info");
      return;
    }

    try {
      await runLevel2Action("/gameplay/mine", { extractorId, amount, hours });
      pushFeedback(
        `Mining cycle started on ${extractorId || "selected extractor"} at ${amount}/hour throughput for ${hours}h. Outputs and costs will accrue over time.`,
        "success"
      );
      flashButtonSuccess(mineBtn);
      if (status) {
        status.textContent = `Silicate extraction cycle launched. Expected runtime: ${hours} hour(s).`;
      }
    } catch (error) {
      if (status) {
        status.textContent = `Mining cycle launch failed: ${error.message}`;
      }
      pushFeedback(`Mining cycle launch rejected. ${error.message}`, "error");
    }
  });
}

function setTab(targetId) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === targetId);
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === targetId);
  });

  if (targetId === "starmap") {
    requestAnimationFrame(() => starmap.resize());
  }

  if (targetId === "inbox") {
    onInboxTabActivated();
  }
}

function bindTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.jump));
  });
}

function clearWalkthroughFocus() {
  document.querySelectorAll(".walkthrough-focus").forEach((el) => {
    el.classList.remove("walkthrough-focus");
  });
}

function stopWalkthrough() {
  walkthroughModal.hidden = true;
  clearWalkthroughFocus();
}

async function completeWalkthroughForAccount() {
  if (!appState.accountId || appState.walkthroughCompleted) {
    return;
  }

  try {
    const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/walkthrough-complete`, {
      method: "POST"
    });
    const account = await parseJsonResponse(response);
    appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
    appState.data = deepClone(account.state);
    updateAllViews();
  } catch {
    // Walkthrough completion persistence is best-effort.
  }
}

async function resetWalkthroughForAccount() {
  if (!appState.accountId) {
    appState.walkthroughCompleted = false;
    if (appState.data?.playerProfile) {
      appState.data.playerProfile.walkthroughCompleted = false;
    }
    return;
  }

  const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/walkthrough-reset`, {
    method: "POST"
  });
  const account = await parseJsonResponse(response);
  appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
  appState.data = deepClone(account.state);
  updateAllViews();
}

function renderWalkthroughStep() {
  const step = walkthroughSteps[appState.walkthroughIndex];
  if (!step) {
    stopWalkthrough();
    return;
  }

  if (step.tab) {
    setTab(step.tab);
  }

  clearWalkthroughFocus();
  const target = document.querySelector(step.selector);
  if (target) {
    target.classList.add("walkthrough-focus");
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  walkthroughTitle.textContent = `Step ${appState.walkthroughIndex + 1}/${walkthroughSteps.length}: ${step.title}`;
  walkthroughText.textContent = step.text;
  walkthroughPrev.disabled = appState.walkthroughIndex === 0;
  walkthroughNext.textContent = appState.walkthroughIndex === walkthroughSteps.length - 1 ? "Finish" : "Next";
}

function startWalkthrough() {
  appState.walkthroughIndex = 0;
  walkthroughModal.hidden = false;
  renderWalkthroughStep();
}

function promptWalkthroughOffer() {
  markWalkthroughOfferSeen(appState.accountId);
  showDialogue({
    speaker: "Operations AI",
    title: "Optional Walkthrough",
    text: "Would you like a quick guided tour and first-action recommendation?",
    choices: [
      {
        label: "Start Walkthrough",
        accent: true,
        onClick: () => {
          closeDialogue();
          startWalkthrough();
        }
      },
      {
        label: "Skip For Now",
        onClick: () => {
          closeDialogue();
        }
      }
    ]
  });
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
    appState.accessToken = options.accessToken;
  }
  if (options.refreshToken) {
    appState.refreshToken = options.refreshToken;
  }
  appState.walkthroughCompleted = Boolean(options.walkthroughCompleted);
  appState.data = deepClone(data);

  if (appState.serverData) {
    applySharedState(appState.serverData);
  }

  persistSession();

  authShell.hidden = true;
  gameShell.hidden = false;

  updateAllViews();
  setTab("overview");

  if (!appState.mapMounted) {
    starmap.mount(appState.data.world.systems);
    appState.mapMounted = true;
  } else {
    starmap.rerender();
  }

  const investmentLog = document.getElementById("investment-log");
  investmentLog.innerHTML =
    (appState.data.corp.investments || [])
      .map((inv) => `<li>${inv.instrument} in ${inv.targetCorp} (${toCurrency(inv.amount)})</li>`)
      .join("") || "<li>No active investments yet.</li>";

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
  appState.data.missions = deepClone(serverState.missions);
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
  return appState.serverData;
}

async function loadStationRegistry() {
  try {
    const [stationsRes, buildingsRes] = await Promise.all([
      fetch("/api/stations"),
      fetch("/api/buildings")
    ]);
    if (stationsRes.ok) {
      const data = await stationsRes.json();
      appState.stationRegistry = data.stations || [];
    }
    if (buildingsRes.ok) {
      const data = await buildingsRes.json();
      appState.buildingRegistry = data.buildings || [];
    }
  } catch {
    // Station registry is best-effort; game works without it.
  }
}

async function loadAccountById(accountId) {
  const response = await apiFetch(`/api/accounts/${encodeURIComponent(accountId)}`);
  return parseJsonResponse(response);
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
    const [account, serverState] = await Promise.all([loadAccountById(appState.accountId), loadBootstrap()]);
    appState.data = deepClone(account.state);
    appState.accountEmail = account.email || appState.accountEmail;
    applySharedState(serverState);
    appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
    updateAllViews();
    return;
  }

  const serverState = await loadBootstrap();

  if (appState.profileMode === "dummy") {
    appState.data = deepClone(serverState);
  } else {
    applySharedState(serverState);
  }

  updateAllViews();
}

function bindForms() {
  const investmentForm = document.getElementById("investment-form");
  investmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if ((appState.data?.corp?.level || 0) < DIRECT_INVESTMENT_UNLOCK_LEVEL) {
      const investmentStatus = document.getElementById("investment-status");
      if (investmentStatus) {
        investmentStatus.textContent = `Direct investments unlock at Corporation Level ${DIRECT_INVESTMENT_UNLOCK_LEVEL}.`;
      }
      return;
    }

    const form = new FormData(investmentForm);
    const payload = {
      targetCorp: String(form.get("targetCorp")),
      instrument: String(form.get("instrument")),
      amount: Number(form.get("amount"))
    };

    const response = await apiFetch("/api/investments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const investmentStatus = document.getElementById("investment-status");
      if (investmentStatus) {
        const payload = await response.json().catch(() => ({ error: "Investment request rejected." }));
        investmentStatus.textContent = payload.error || "Investment request rejected.";
      }
      return;
    }

    const result = await response.json();
    appState.data = deepClone(result.account.state);
    if (!appState.data.corp.investments) {
      appState.data.corp.investments = [];
    }

    appState.data.corp.investments.unshift(result.investment);
    const log = document.getElementById("investment-log");
    const line = document.createElement("li");
    line.textContent = `${payload.instrument} in ${payload.targetCorp} for ${toCurrency(payload.amount)} submitted.`;
    log.prepend(line);

    await refreshFromServer();
    investmentForm.reset();
  });

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
    const quantity = Math.max(1, Number(qtyInput?.value || 1));
    const unitPrice = Math.max(1, Number(priceInput?.value || 1));
    const inventory = getInventory();
    const available = Number(inventory[item] || 0);

    if (!item || available <= 0) {
      listingStatus.textContent = "No stock available for this item.";
      return;
    }

    if (quantity > available) {
      listingStatus.textContent = "Quantity exceeds available inventory.";
      return;
    }

    try {
      const response = await apiFetch("/api/market/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "sell",
          item,
          quantity,
          unitPrice
        })
      });

      const payload = await parseJsonResponse(response);
      const previousMarket = deepClone(appState.data?.market || { orderBook: [], mercenaryContracts: [] });

      appState.data = deepClone(payload.account.state);
      appState.data.market = previousMarket;

      if (payload.order) {
        appState.data.market.orderBook = [
          payload.order,
          ...(appState.data.market.orderBook || []).filter((order) => order.id !== payload.order.id)
        ];
      }

      renderMarket(appState.data);
      listingStatus.textContent = `Listing created: ${quantity} ${item} @ ${toCurrency(unitPrice)}.`;
      await refreshFromServer();
    } catch (error) {
      listingStatus.textContent = `Sell listing failed: ${error.message}`;
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
          startedAt: Date.now(),
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

  const combatForm = document.getElementById("combat-form");
  combatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(combatForm);
    const payload = Object.fromEntries(form.entries());

    await apiFetch("/api/combat/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await refreshFromServer();
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

    const chatLogEl = document.getElementById("chat-log");
    if (chatLogEl) {
      const distanceFromBottom = chatLogEl.scrollHeight - (chatLogEl.scrollTop + chatLogEl.clientHeight);
      appState.chatAutoScrollOnNextRender = distanceFromBottom <= 12;
    } else {
      appState.chatAutoScrollOnNextRender = false;
    }

    socket?.emit("chat:send", {
      channel: appState.chatChannel,
      author: appState.data?.corp?.corporationName || "Anonymous",
      content
    });

    chatInput.value = "";
  });

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

  // Mission board interactions
  const missionListEl = document.getElementById("mission-list");
  const missionBackBtn = document.getElementById("mission-back-btn");
  const missionAcceptBtn = document.getElementById("mission-accept-btn");
  const activeMissionListEl = document.getElementById("active-mission-list");

  missionListEl?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-mission-id]");
    if (!card) return;
    appState.selectedMissionId = card.getAttribute("data-mission-id");
    appState.missionsView = "detail";
    renderMissions(appState.data);
  });

  missionBackBtn?.addEventListener("click", () => {
    appState.missionsView = "board";
    renderMissions(appState.data);
  });

  missionAcceptBtn?.addEventListener("click", () => {
    const mission = (appState.data?.missions || []).find((m) => m.id === appState.selectedMissionId);
    if (!mission) return;
    const alreadyActive = appState.activeMissions.some((m) => m.id === mission.id);
    if (!alreadyActive) {
      appState.activeMissions.push(mission);
      pushFeedback(`Mission accepted: "${mission.title}". Track it in Active Operations.`, "success");
      const btn = document.getElementById("mission-accept-btn");
      if (btn) flashButtonSuccess(btn);
    }
    appState.missionsView = "board";
    renderMissions(appState.data);
  });

  activeMissionListEl?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-abandon-mission]");
    if (!btn) return;
    const missionId = btn.getAttribute("data-abandon-mission");
    appState.activeMissions = appState.activeMissions.filter((m) => m.id !== missionId);
    pushFeedback("Mission abandoned and removed from Active Operations.", "info");
    renderMissions(appState.data);
  });

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
    const qty = Math.max(1, Math.min(maxQty, Number(qtyInput?.value || 1)));
    const listingStatus = document.getElementById("listing-status");
    const buyStatus = document.getElementById("buy-status");

    try {
      const response = await apiFetch(`/api/market/orders/${encodeURIComponent(orderId)}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: qty })
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

  socket.on("chat:new", (msg) => {
    if (!appState.data) {
      return;
    }

    if (!appState.data.chatLog[msg.channel]) {
      appState.data.chatLog[msg.channel] = [];
    }

    appState.data.chatLog[msg.channel].push(msg);
    if (msg.channel === appState.chatChannel) {
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

  socket.on("finance:updated", (financeState) => {
    if (!appState.data || appState.profileMode !== "dummy") {
      return;
    }

    appState.data.corp.finances = financeState;
    renderFinanceCharts(financeState);
    updateCorpIdentity(appState.data);
  });

  socket.on("combat:newReport", (report) => {
    if (!appState.data) {
      return;
    }

    appState.data.combatReports.unshift(report);
    renderCombatReports(appState.data);
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
}

function bindAuthControls() {
  if (showLoginButton && loginPanel && registerPanel) {
    showLoginButton.addEventListener("click", () => {
      loginPanel.hidden = false;
      registerPanel.hidden = true;
    });
  }

  if (showRegisterButton && registerPanel) {
    showRegisterButton.addEventListener("click", () => {
      registerPanel.hidden = false;
      if (loginPanel) {
        loginPanel.hidden = true;
      }
    });
  }

  if (loginCancelButton && loginPanel) {
    loginCancelButton.addEventListener("click", () => {
      loginPanel.hidden = true;
    });
  }

  if (registerCancelButton && registerPanel) {
    registerCancelButton.addEventListener("click", () => {
      registerPanel.hidden = true;
    });
  }

  if (loginDummyButton) {
    loginDummyButton.hidden = !IS_DEV_ACCESS;
    loginDummyButton.addEventListener("click", async () => {
      if (!IS_DEV_ACCESS) {
        return;
      }

      const payload = await loginDummyAccount();
      enterGame("account", payload.account.state, {
        accountId: payload.account.id,
        accountEmail: payload.account.email,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        walkthroughCompleted: payload.account.walkthroughCompleted,
        autoPromptWalkthrough: false
      });
    });
  }

  if (!registerForm) {
    return;
  }

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(registerForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const ceoName = String(formData.get("ceoName") || "New CEO").trim();
    const corpName = String(formData.get("corpName") || "Frontier Protocol Ventures").trim();
    const registerStatus = document.getElementById("register-status");

    if (!email || !password || password.length < 8) {
      if (registerStatus) {
        registerStatus.textContent = "Registration requires a valid email and a password with at least 8 characters.";
      }
      return;
    }

    if (registerStatus) {
      registerStatus.textContent = "Registering corporation credentials...";
    }

    try {
      const response = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ceoName, corpName })
      });

      const payload = await parseJsonResponse(response);
      if (registerPanel) {
        registerPanel.hidden = true;
      }

      await runIntroDialogue();
      enterGame("account", payload.account.state, {
        accountId: payload.account.id,
        accountEmail: payload.account.email,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        walkthroughCompleted: payload.account.walkthroughCompleted,
        autoPromptWalkthrough: true
      });
    } catch (error) {
      if (registerStatus) {
        registerStatus.textContent = `Registration failed: ${error.message}`;
      }
    }
  });
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

async function loadMessages() {
  if (!appState.accountId) return;
  try {
    const res = await apiFetch(`/api/accounts/${appState.accountId}/messages`);
    const data = await res.json();
    if (data.messages) {
      appState.inbox.messages = data.messages;
      appState.inbox.loaded = true;
      renderInboxMessageList();
    }
  } catch (_) { /* silently ignore */ }
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

function formatInboxDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function renderInboxMessageList() {
  const panel = document.getElementById("inbox");
  if (!panel || !panel.classList.contains("active")) return;

  const list = document.getElementById("inbox-message-list");
  const emptyNotice = document.getElementById("inbox-empty-notice");
  if (!list || !emptyNotice) return;

  const msgs = inboxMsgsForView();
  if (!msgs.length) {
    list.innerHTML = "";
    emptyNotice.style.display = "";
    return;
  }
  emptyNotice.style.display = "none";

  list.innerHTML = msgs.map((m) => {
    const unread = !m.readAt && m.folder !== "sent" && m.folder !== "draft";
    const isDraft = m.folder === "draft";
    const toLine = isDraft
      ? `<span class="inbox-msg-to">To: ${m.toCorpName || "(no recipient)"}</span>`
      : `<span class="inbox-msg-from">${escapeHtml(m.fromName || "Unknown")}</span>`;
    return `<li class="inbox-msg-item${unread ? " unread" : ""}" data-msg-id="${m.id}">
      <div class="inbox-msg-top">
        ${toLine}
        <span class="inbox-msg-date">${formatInboxDate(m.sentAt)}</span>
      </div>
      <div class="inbox-msg-subject">${escapeHtml(m.subject || "(no subject)")}${unread ? ' <span class="inbox-unread-dot"></span>' : ""}</div>
    </li>`;
  }).join("");

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
    document.getElementById("compose-subject").value = msg.subject || "";
    document.getElementById("compose-body").value = msg.body || "";
    appState.inbox.composeDraftId = msg.id;
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
  const deleteDraftBtn = document.getElementById("inbox-action-delete-draft");
  const editDraftBtn = document.getElementById("inbox-action-edit-draft");
  archiveBtn.style.display = "none";
  restoreBtn.style.display = "none";
  trashBtn.style.display = "none";
  deleteDraftBtn.style.display = "none";
  editDraftBtn.style.display = "none";

  if (msg.folder === "inbox") {
    archiveBtn.style.display = "";
    trashBtn.style.display = "";
  } else if (msg.folder === "archive") {
    restoreBtn.style.display = "";
    trashBtn.style.display = "";
  } else if (msg.folder === "trash") {
    restoreBtn.style.display = "";
  } else if (msg.folder === "draft") {
    editDraftBtn.style.display = "";
    deleteDraftBtn.style.display = "";
  }

  // Mark read
  if (!msg.readAt && msg.folder !== "sent" && msg.folder !== "draft") {
    apiFetch(`/api/accounts/${appState.accountId}/messages/${messageId}/read`, { method: "POST" })
      .then(() => {
        const m = appState.inbox.messages.find((x) => x.id === messageId);
        if (m) m.readAt = Date.now();
      })
      .catch(() => {});
  }
}

function showInboxView(view) {
  // view: "list" | "detail" | "compose"
  document.getElementById("inbox-list-view").style.display = view === "list" ? "" : "none";
  document.getElementById("inbox-detail-view").style.display = view === "detail" ? "" : "none";
  document.getElementById("inbox-compose-view").style.display = view === "compose" ? "" : "none";
  const subtabNav = document.getElementById("inbox-subtab-nav");
  if (subtabNav) subtabNav.style.display = view === "compose" ? "none" : (appState.inbox.folder === "inbox" ? "" : "none");
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
      renderInboxMessageList();
    });
  });

  // Back buttons
  document.getElementById("inbox-back-btn")?.addEventListener("click", () => {
    showInboxView("list");
    appState.inbox.openMessageId = null;
  });
  document.getElementById("inbox-compose-back-btn")?.addEventListener("click", () => {
    appState.inbox.composeDraftId = null;
    showInboxView("list");
    renderInboxMessageList();
  });

  // Compose trigger
  document.getElementById("inbox-compose-trigger")?.addEventListener("click", () => {
    appState.inbox.composeDraftId = null;
    document.getElementById("compose-draft-id").value = "";
    document.getElementById("compose-to").value = "";
    document.getElementById("compose-subject").value = "";
    document.getElementById("compose-body").value = "";
    document.getElementById("compose-status").textContent = "";
    showInboxView("compose");
  });

  // Detail action buttons
  document.getElementById("inbox-action-archive")?.addEventListener("click", () => moveCurrentMessage("archive"));
  document.getElementById("inbox-action-restore")?.addEventListener("click", () => moveCurrentMessage("inbox"));
  document.getElementById("inbox-action-trash")?.addEventListener("click", () => moveCurrentMessage("trash"));
  document.getElementById("inbox-action-delete-draft")?.addEventListener("click", async () => {
    const id = appState.inbox.openMessageId;
    if (!id) return;
    await apiFetch(`/api/accounts/${appState.accountId}/messages/draft/${id}`, { method: "DELETE" });
    appState.inbox.messages = appState.inbox.messages.filter((m) => m.id !== id);
    appState.inbox.openMessageId = null;
    showInboxView("list");
    renderInboxMessageList();
  });
  document.getElementById("inbox-action-edit-draft")?.addEventListener("click", () => {
    const id = appState.inbox.openMessageId;
    if (!id) return;
    openMessage(id);
  });

  // Compose form
  const composeForm = document.getElementById("inbox-compose-form");
  composeForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("compose-status");
    status.textContent = "Sending…";
    const body = {
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
        return;
      }
      appState.inbox.messages = data.messages;
      appState.inbox.folder = "sent";
      appState.inbox.composeDraftId = null;
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
  if (!appState.inbox.loaded) {
    loadMessages();
  } else {
    renderInboxMessageList();
  }
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

  walkthroughPrev.addEventListener("click", () => {
    appState.walkthroughIndex = Math.max(0, appState.walkthroughIndex - 1);
    renderWalkthroughStep();
  });

  walkthroughNext.addEventListener("click", () => {
    if (appState.walkthroughIndex >= walkthroughSteps.length - 1) {
      stopWalkthrough();
      completeWalkthroughForAccount();
      setTab("rnd");
      return;
    }
    appState.walkthroughIndex += 1;
    renderWalkthroughStep();
  });

  walkthroughEnd.addEventListener("click", () => {
    stopWalkthrough();
    completeWalkthroughForAccount();
    setTab("rnd");
  });
}

async function boot() {
  hydrateSession();
  showAuthScreen();
  bindCollapsibleSections();
  bindTabs();
  bindAuthControls();
  bindForms();
  bindLevel2Controls();
  bindRealtimeEvents();
  bindGlobalControls();
  bindRippleEffect();
  bindBuildingActions();
  bindInboxControls();

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
      try {
        const account = await loadAccountById(accountId);
        url.searchParams.delete("account");
        const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, "", cleanUrl || "/");

        enterGame("account", account.state, {
          accountId: account.id,
          accountEmail: account.email,
          walkthroughCompleted: account.walkthroughCompleted,
          autoPromptWalkthrough: true
        });
        return;
      } catch (error) {
        clearSession();
        // Session was stale/invalid — just stay on the landing page
        return;
      }
    }
  } catch (error) {
    authShell.innerHTML = `<article class="auth-card"><p class="alert">Bootstrap failed: ${error.message}</p></article>`;
  }
}

window.addEventListener("DOMContentLoaded", boot);
