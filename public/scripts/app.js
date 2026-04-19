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
  selectedAgentId: null,
  activeMissions: [],
  miningUiTicker: null,
  stationRegistry: [],
  buildingRegistry: [],
  stationActiveLease: null,
  _travelTimer: null,
  exchangeFilter: "",
  beltCompositions: {},
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
    costCredits: 2000,
    prereqs: [],
    tier: 1
  },
  {
    id: "tt-industrial-safety",
    name: "Industrial Safety Protocols",
    effect: "-8% facility downtime risk",
    durationHours: 3,
    costCredits: 2000,
    prereqs: ["tt-basic-extraction"],
    tier: 1
  },
  {
    id: "tt-supply-forecast",
    name: "Supply Forecast Engine",
    effect: "-6% extractor build cost, +6% mining yield",
    durationHours: 4,
    costCredits: 3000,
    prereqs: ["tt-basic-extraction"],
    tier: 1
  },
  {
    id: "tt-energy-routing",
    name: "High-Density Energy Routing",
    effect: "+1 advanced manufacturing lane",
    durationHours: 6,
    costCredits: 4000,
    prereqs: ["tt-industrial-safety", "tt-supply-forecast"],
    tier: 2
  },
  {
    id: "tt-material-compression",
    name: "Material Compression I",
    effect: "+8% refining throughput",
    durationHours: 9,
    costCredits: 6000,
    prereqs: ["tt-energy-routing"],
    tier: 2
  },
  {
    id: "tt-containment-physics",
    name: "Containment Physics I",
    effect: "Unlocks Helium-3 refinery chain",
    durationHours: 10,
    costCredits: 8000,
    prereqs: ["tt-energy-routing"],
    tier: 2
  },
  {
    id: "tt-fleet-coordination",
    name: "Fleet Coordination Matrix",
    effect: "+12 fleet cap",
    durationHours: 16,
    costCredits: 12000,
    prereqs: ["tt-energy-routing"],
    tier: 2
  },
  {
    id: "tt-nano-lattice",
    name: "Nano-Lattice Weaving",
    effect: "Unlocks Aerogel & Quantum Insulator refinery chains",
    durationHours: 12,
    costCredits: 8000,
    prereqs: ["tt-material-compression"],
    tier: 3
  },
  {
    id: "tt-exotic-energy-routing",
    name: "Exotic Energy Routing",
    effect: "Unlocks Dark-Matter Capacitor synthesis",
    durationHours: 16,
    costCredits: 12000,
    prereqs: ["tt-containment-physics"],
    tier: 3
  },
  {
    id: "tt-proxima-navigation",
    name: "Near-Star Navigation Array",
    effect: "Enables travel to Alpha Centauri and Barnard's Star",
    durationHours: 8,
    costCredits: 10000,
    prereqs: ["tt-fleet-coordination"],
    tier: 2,
    requiresCorpLevel: 5
  },
  {
    id: "tt-deep-star-navigation",
    name: "Deep-Star Cartography Suite",
    effect: "Enables travel to all charted star systems",
    durationHours: 14,
    costCredits: 20000,
    prereqs: ["tt-proxima-navigation"],
    tier: 3,
    requiresCorpLevel: 10
  },
  {
    id: "tt-assembly-fabrication",
    name: "Assembly & Fabrication Systems",
    effect: "Unlocks Assembly Facility construction",
    durationHours: 6,
    costCredits: 5000,
    prereqs: ["tt-energy-routing"],
    tier: 2
  },
  {
    id: "tt-asteroid-prospecting",
    name: "Asteroid Prospecting Arrays",
    effect: "Unlocks Mining Probe fabrication",
    durationHours: 8,
    costCredits: 8000,
    prereqs: ["tt-assembly-fabrication", "tt-supply-forecast"],
    tier: 2
  }
];

const insightPrograms = [
  { id: "ceo-negotiation-fundamentals", name: "Negotiation Fundamentals", effect: "-2% GEX sales tax", description: "Reduces sales tax on Galactic Exchange sales by 2% (max reduction 6%).", durationHours: 4, costCredits: 10000, prereqs: [], tier: 1, maxLevels: 3, category: "Trade" },
  { id: "ceo-employee-motivation", name: "Employee Motivation Techniques", effect: "-10% morale decay", description: "Reduces global employee morale decay rate by 10%.", durationHours: 6, costCredits: 14000, prereqs: [], tier: 1, maxLevels: 1, category: "Operations" },
  { id: "ceo-basic-market-analysis", name: "Basic Market Analysis", effect: "Daily price trend hint", description: "Once per day, reveals a short-term silicate price trend hint.", durationHours: 5, costCredits: 12000, prereqs: [], tier: 1, maxLevels: 1, category: "Trade" },
  { id: "ceo-isa-regulatory-navigation", name: "ISA Regulatory Navigation", effect: "-5% lease renewal cost", description: "Reduces office lease renewal cost by 5%.", durationHours: 6, costCredits: 15000, prereqs: [], tier: 1, maxLevels: 1, category: "Finance" },
  { id: "ceo-crisis-management", name: "Crisis Management Protocols", effect: "-25% extractor repair time", description: "Reduces extractor repair time by 25% when downtime occurs.", durationHours: 8, costCredits: 18000, prereqs: ["ceo-employee-motivation"], tier: 2, maxLevels: 1, category: "Operations" },
  { id: "ceo-team-efficiency", name: "Team Efficiency Protocols", effect: "+3% productivity per employee", description: "+3% productivity per employee (global).", durationHours: 10, costCredits: 22000, prereqs: ["ceo-employee-motivation"], tier: 2, maxLevels: 1, category: "Operations" },
  { id: "ceo-contract-law", name: "Contract Law Essentials", effect: "+8% mission reward bonus", description: "+8% reward bonus on Logistics Agent missions.", durationHours: 8, costCredits: 20000, prereqs: ["ceo-negotiation-fundamentals"], tier: 2, maxLevels: 1, category: "Trade" },
  { id: "ceo-risk-assessment", name: "Risk Assessment Framework", effect: "-12% extractor downtime chance", description: "Reduces extractor downtime chance by 12%.", durationHours: 10, costCredits: 25000, prereqs: ["ceo-crisis-management"], tier: 2, maxLevels: 1, category: "Operations" },
  { id: "ceo-strategic-delegation", name: "Strategic Delegation", effect: "Unlock: Middle Manager", description: "Unlocks ability to hire your first Middle Manager.", durationHours: 14, costCredits: 35000, prereqs: ["ceo-team-efficiency"], tier: 3, maxLevels: 1, category: "Management" },
  { id: "ceo-bureaucratic-persuasion", name: "Bureaucratic Persuasion", effect: "+15% ISA reputation gains", description: "Increases ISA reputation gains by 15%.", durationHours: 12, costCredits: 30000, prereqs: ["ceo-isa-regulatory-navigation"], tier: 3, maxLevels: 1, category: "Diplomacy" },
  { id: "ceo-decision-fatigue-reduction", name: "Executive Decision Fatigue Reduction", effect: "+1 max Focus", description: "Increases maximum Focus by +1.", durationHours: 16, costCredits: 40000, prereqs: ["ceo-contract-law", "ceo-risk-assessment"], tier: 3, maxLevels: 1, category: "Leadership" },
  { id: "ceo-leadership-presence", name: "Leadership Presence", effect: "Focus → morale boost", description: "Focus reports grant a small temporary morale boost to all employees.", durationHours: 18, costCredits: 50000, prereqs: ["ceo-strategic-delegation", "ceo-decision-fatigue-reduction"], tier: 3, maxLevels: 1, category: "Leadership" }
];

const walkthroughSteps = [
  {
    selector: '.tab-btn[data-tab="inbox"]',
    title: "Welcome, Agent",
    text: "You\u2019ve just received your ISA settlement license. Check your mailbox for the official charter from the Interstellar Settlement Authority.",
    tab: "inbox"
  },
  {
    selector: '.tab-btn[data-tab="starmap"]',
    title: "Explore the Starmap",
    text: "The starmap shows every system, planet, moon, and station. You\u2019ll manage operations across multiple locations. Let\u2019s find a station where you can establish your first office.",
    tab: "starmap"
  },
  {
    selector: '.tab-btn[data-tab="station"]',
    title: "Station Overview",
    text: "Stations are your base of operations. Here you\u2019ll rent offices, hire personnel, file mining leases, and manage extraction. Your corporation needs a registered office to operate.",
    tab: "station"
  },
  {
    selector: '[data-building-action="building:orbital-executive-suites"]',
    title: "Rent Your First Office",
    text: "Enter the Orbital Executive Suites and lease an office. It costs $1,000/day with a 30-day minimum ($30,000 upfront). This establishes your corporate presence at the station.",
    tab: "station"
  },
  {
    selector: '.tab-btn[data-tab="ceo"]',
    title: "Hire Employees",
    text: "With an office established, hire personnel. Each employee costs $2,000 to recruit and $150/day in payroll. Hire at least 5 employees \u2014 you\u2019ll need them for your first mining lease.",
    tab: "ceo"
  },
  {
    selector: '[data-building-action="building:isa-claims-leases"]',
    title: "File a Mining Lease",
    text: "Visit the ISA Claims & Leases Division to file an extraction rights application. Mars is recommended for your first lease. Each lease requires 5 employees on payroll.",
    tab: "station"
  },
  {
    selector: '.tab-btn[data-tab="station"]',
    title: "Commission an Extractor Yard",
    text: "Open your new Mars mining lease and commission a Basic Extractor Yard for $50,000. This gives you the equipment needed to mine silicates from the surface.",
    tab: "station"
  },
  {
    selector: '.tab-btn[data-tab="station"]',
    title: "Start Your First Mining Cycle",
    text: "Set your extraction parameters \u2014 throughput (tons/hour) and duration (hours) \u2014 then launch the cycle. Your extractor will begin mining silicates automatically.",
    tab: "station"
  },
  {
    selector: '.tab-btn[data-tab="rnd"]',
    title: "Research Basic Extraction",
    text: "Queue \u2018Basic Extraction Analytics\u2019 in your Corporate R&D lab. This 2-hour research project gives a permanent 10% boost to all extraction throughput.",
    tab: "rnd"
  },
  {
    selector: '.tab-btn[data-tab="market"]',
    title: "Sell on the Galactic Market",
    text: "Once your mining cycle completes, head to the Galactic Market. Sell your mined silicates by creating a listing or filling an existing NPC buy order for immediate credits.",
    tab: "market"
  },
  {
    selector: '.tab-btn[data-tab="missions"]',
    title: "Visit the Assignments Bureau",
    text: "The ISA Contracting & Assignments Bureau is where mission agents post field contracts. Visit Coordinator Voss in her office to review available logistics assignments.",
    tab: "missions"
  },
  {
    selector: '.tab-btn[data-tab="overview"]',
    title: "You\u2019re Ready!",
    text: "You now know the core loop: mine resources, research upgrades, trade on the market, and climb the corporate ladder. Keep expanding, keep researching, and check your milestones. Good luck, Agent.",
    tab: "overview"
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
  },
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
      pushFeedback(`Asteroid belt scouted: ${beltKey}`, "ok");
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

  bodyEl.innerHTML = `<table class="trade-confirm-table"><tbody>${rows
    .map((r) => {
      const cls = r.highlight ? ` class="trade-confirm-highlight"` : r.muted ? ` class="trade-confirm-muted"` : "";
      return `<tr${cls}><td>${r.label}</td><td class="trade-confirm-value">${r.value}</td></tr>`;
    })
    .join("")}</tbody></table>`;

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
      credits: 250000,
      liabilities: 0,
      assets: 0,
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

  const rows = insightPrograms
    .map((prog) => {
      const completionCount = completed.filter((id) => id === prog.id).length;
      const queuedCount = queuedIds.filter((id) => id === prog.id).length;
      const maxLevels = prog.maxLevels || 1;
      const isDone = completionCount >= maxLevels;
      const isQueued = queuedCount > 0 && (completionCount + queuedCount >= maxLevels);
      const isLocked = !prog.prereqs.every((req) => completed.includes(req));
      const anyQueued = queue.length > 0;
      const canEnqueue = !isDone && !isQueued && !isLocked && !anyQueued && (completionCount + queuedCount < maxLevels);
      const prereqLabel = prog.prereqs.length
        ? prog.prereqs.map((id) => insightPrograms.find((p) => p.id === id)?.name || id).join(", ")
        : "None";

      const levelLabel = maxLevels > 1 ? ` (${completionCount}/${maxLevels})` : "";

      if (isDone) {
        return `<div class="rnd-row rnd-row--done">
          <div class="rnd-row__info">
            <span class="rnd-row__name">${escapeHtml(prog.name)}${levelLabel}</span>
            <span class="rnd-row__effect">${escapeHtml(prog.effect)}</span>
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
          </div>
          <span class="rnd-row__badge rnd-row__badge--queued">IN QUEUE</span>
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
    <dt>Fleet Cap</dt><dd>${corp.unlocks.maxFleetSize}</dd>
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

function renderOrbitalExecutiveSuites(building, data) {
  const corp = data.corp;
  const station = getCurrentStationInfo(data);
  const currentStationId = station?.id || "earth-station-prime";
  const currentBody = station?.body || corp?.location || "Earth";
  const stationId = station?.id || "earth-station-prime";
  const officeCost = station?.officeCost || 20000;

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
            <option value="7">7 days — ${toCurrency(7000)}</option>
            <option value="14">14 days — ${toCurrency(14000)}</option>
            <option value="21">21 days — ${toCurrency(21000)}</option>
            <option value="28" selected>28 days — ${toCurrency(28000)}</option>
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
      <p class="muted">Visit the ISA Claims &amp; Leases Division to file extraction rights applications for registered bodies in the Sol system.</p>
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
          const renewalCost = durationDays * 1000;
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
    leasesHtml = `<p class="muted" style="margin-top:0.4rem;">No active extraction claims on file. Submit a lease application below to begin.</p>`;
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
  const LEASE_BODIES = [
    { body: "Earth", cost: 20000, description: "Grants two (2) on-surface building slots for Basic Extractor Yard construction. Abundant mineral and silicate deposits across diverse terrain." },
    { body: "Mars", cost: 25000, description: "Grants two (2) on-surface building slots for Basic Extractor Yard construction. Primary source of silicate deposits." },
    { body: "Luna", cost: 30000, description: "Grants two (2) on-surface building slots. Lunar regolith operations with access to Helium-3 deposits." }
  ];

  const ownedBodies = new Set(leases.map((l) => l.body));
  const availableBodies = LEASE_BODIES.filter((b) => b.body === stationBody && !ownedBodies.has(b.body));

  let purchaseHtml = "";
  const hasLocalBodies = LEASE_BODIES.some((b) => b.body === stationBody);

  if (!hasOffice) {
    purchaseHtml = `<p class="muted">A registered corporate office is required before the ISA will process lease applications. Visit the Orbital Executive Suites first.</p>`;
  } else if (!hasLocalBodies) {
    purchaseHtml = `<p class="muted">No extraction zones are available at ${escapeHtml(station?.name || "this station")}. Travel to a station orbiting a resource-bearing body to file new lease applications.</p>`;
  } else if (availableBodies.length === 0) {
    purchaseHtml = `<p class="muted">All extraction zones available from this station have been claimed by your corporation.</p>`;
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
            <span class="extractor-stat"><span class="extractor-stat-label">Mined before halt</span><span class="extractor-stat-value">${(ex.totalMined || 0).toLocaleString()}</span></span>
          </div>
        </div>
      `;
    } else if (ex.active && ex.endsAt && ex.startedAt) {
      const now = Date.now();
      const remaining = Math.max(0, ex.endsAt - now);
      const cycleDuration = ex.endsAt - ex.startedAt;
      const elapsed = Math.min(now - ex.startedAt, cycleDuration);
      const pct = cycleDuration > 0 ? Math.min(100, Math.round((elapsed / cycleDuration) * 100)) : 0;
      const hrs = Math.floor(remaining / 3_600_000);
      const mins = Math.floor((remaining % 3_600_000) / 60_000);
      const elapsedHours = elapsed / 3_600_000;
      const estimatedFees = Math.round(elapsedHours * (ex.operationCostPerHour || 0));

      cycleInfo = `<span class="extractor-cycle-status">${ex.throughputPerHour} t/h &mdash; ${hrs}h ${mins}m remaining</span>`;
      progressBarHtml = `
        <div class="extractor-progress-wrap">
          <div class="extractor-progress-header">
            <span class="extractor-progress-pct">${pct}%</span>
            <span class="extractor-progress-time">${hrs}h ${mins}m left</span>
          </div>
          <div class="extractor-progress-track">
            <div class="extractor-progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="extractor-stat-row">
            <span class="extractor-stat"><span class="extractor-stat-label">Mined this cycle</span><span class="extractor-stat-value">${(ex.totalMined || 0).toLocaleString()}</span></span>
            <span class="extractor-stat"><span class="extractor-stat-label">Fees incurred</span><span class="extractor-stat-value">${toCurrency(estimatedFees)}</span></span>
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
        <p class="muted action-hint lease-mine-status" data-for="${escapeHtml(ex.id)}"></p>`
      : "";

    const mineFormVisible = !ex.active && !ex.downtimeActive;
    extractorRows += `
      <div class="extractor-row ${statusClass}">
        <div class="extractor-row-header">
          <strong>${escapeHtml(ex.name)}</strong>
          <span class="building-status-badge ${statusClass}">${ex.downtimeActive ? "Downtime" : (ex.active ? "Active" : "Idle")}</span>
        </div>
        ${ex.downtimeActive ? cycleInfo : (ex.active ? "" : cycleInfo)}
        ${progressBarHtml}
        ${mineFormVisible ? mineFormHtml : ""}
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
    : `<p class="muted" style="margin-top:0.6rem;">This lease's building slots are fully allocated (${usedSlots}/${totalSlots}).</p>`;

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

  // Mining cycle forms
  document.querySelectorAll(".lease-mine-form").forEach((form) => {
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
          const operationCostPerHour = Math.max(600, Math.round(throughputPerHour * 16));
          const startupCost = Math.max(500, Math.round(operationCostPerHour * 0.35));
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
}

// ─── Tabs allowed during travel ──────────────────────────────────────────────
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

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

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
    <p class="muted lede">${escapeHtml(station.description)}</p>
  `;

  // ── Station buildings ──
  const stationBuildings = station.buildingIds
    .map((id) => appState.buildingRegistry.find((b) => b.id === id))
    .filter(Boolean);

  const npcBuildings = stationBuildings.filter((b) => b.owner === "npc" && b.available);

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
  const hasAssemblyTech = (data.corp?.unlockedTech || []).includes("tt-assembly-fabrication");
  const hasAssembly = corpBuildings.some((b) => b.name === "Assembly Facility");
  const buildAssemblyHtml = (hasAssemblyTech && !hasAssembly)
    ? `<article class="building-card data-card" style="border:1px dashed rgba(0,247,255,0.3);">
         <header class="building-card-header"><span class="faction-code-badge corp-badge">NEW</span><h3>Assembly Facility</h3></header>
         <p class="muted">Modular manufacturing bay for fabricating deployable units.</p>
         <footer class="building-card-footer"><button id="build-assembly-btn" class="btn btn-accent">Construct (¤60,000)</button></footer>
       </article>`
    : "";

  if (!corpBuildings.length) {
    playerGrid.innerHTML = `<p class="muted">No corporate holdings registered at this station. Buildings constructed through your Corporation Overview will appear here once commissioned.</p>${buildAssemblyHtml}`;
  } else {
    playerGrid.innerHTML = corpBuildings
      .map(
        (b) => {
          const isAssembly = b.name === "Assembly Facility";
          const actionBtn = isAssembly
            ? `<button class="btn btn-outline" data-corp-building="${escapeHtml(b.name)}">Enter</button>`
            : `<span class="building-status-badge operational">Operational</span>`;
          return `
            <article class="building-card data-card">
              <header class="building-card-header">
                <span class="faction-code-badge corp-badge">CORP</span>
                <h3>${escapeHtml(b.name)}</h3>
              </header>
              <p class="muted">Tier ${b.tier || 1} &mdash; ${escapeHtml(b.status)}</p>
              <footer class="building-card-footer">${actionBtn}</footer>
            </article>
          `;
        }
      )
      .join("") + buildAssemblyHtml;

    // Bind Assembly Facility enter button
    playerGrid.querySelectorAll("[data-corp-building]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-corp-building");
        if (name === "Assembly Facility") {
          renderAssemblyFacility(data);
        }
      });
    });
  }

  // Bind build Assembly Facility button
  const buildAssemblyBtn = playerGrid.querySelector("#build-assembly-btn");
  if (buildAssemblyBtn) {
    buildAssemblyBtn.addEventListener("click", async () => {
      if (!appState.accountId) return;
      try {
        const res = await apiFetch(
          `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/build-assembly-facility`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        const account = await parseJsonResponse(res);
        appState.data = deepClone(account.state);
        updateAllViews();
        pushFeedback("Assembly Facility constructed!", "ok");
      } catch (err) {
        pushFeedback(err.message || "Construction failed.", "warn");
      }
    });
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
  const maxProbes = am.maxProbes || 2;
  const hasProspecting = (data.corp?.unlockedTech || []).includes("tt-asteroid-prospecting");
  const station = getCurrentStationInfo(data);

  let probeSection = "";
  if (!hasProspecting) {
    probeSection = `<p class="muted">Research <em>Asteroid Prospecting Arrays</em> to unlock Mining Probe fabrication.</p>`;
  } else {
    const canBuild = probeCount < maxProbes;
    probeSection = `
      <div class="assembly-probe-status">
        <img src="/images/mining_probe.png" alt="Mining Probe" class="assembly-probe-img" />
        <div>
          <p>Mining Probes: <strong>${probeCount} / ${maxProbes}</strong></p>
          ${canBuild
            ? `<button id="build-probe-btn" class="btn btn-accent">Fabricate Mining Probe (¤8,000)</button>`
            : `<p class="muted">Probe hangar full. Research upgrades to increase capacity.</p>`
          }
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
        pushFeedback("Mining Probe fabricated.", "ok");
      } catch (err) {
        pushFeedback(err.message || "Probe fabrication failed.", "warn");
      }
    });
  }
}

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

  // Map requirement IDs to the tab they should navigate to
  const REQ_TAB = {
    officeRented:               "station",
    hire5:                      "ceo",
    hire10:                     "ceo",
    hire15:                     "ceo",
    hire25:                     "ceo",
    marsLease:                  "station",
    secondLease:                "station",
    lunaLease:                  "station",
    asteroidBeltLease:          "station",
    extractor:                  "station",
    extractor2:                 "station",
    extractor3:                 "station",
    ferricMiningComplex:        "station",
    refineryComplex:            "station",
    cryoExtractorArray:         "station",
    mine300:                    "station",
    beltMiningOp:               "station",
    researchBasicExtraction:    "rnd",
    researchIndustrialSafety:   "rnd",
    researchEnergyRouting:      "rnd",
    researchFerricCore:         "rnd",
    researchMultiStageRefinery: "rnd",
    researchCryoVapor:          "rnd",
    researchCarbonSlurry:       "rnd",
    researchBeltMining:         "rnd",
    researchExtrasolar:         "rnd",
    sell300Silicate:            "market",
    sell50000Silicate:          "market",
    sell500CryoFoam:            "market",
    sell500HydratedFerric:      "market",
    sell500CarbonSilicate:      "market",
    sell500CarboIron:           "market",
    sell500HydroCarbon:         "market",
    manufacture5000Alloys:      "refinery",
    missions25:                 "missions"
  };

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
      const targetTab = REQ_TAB[req.id];
      const jumpAttr = targetTab ? ` data-jump="${targetTab}"` : "";
      const clickable = targetTab && !req.complete ? " requirement-clickable" : "";
      return `
      <section class="data-card requirement-card${doneClass}${justCompletedClass}${clickable}"${jumpAttr}>
        <h3 class="requirement-title">${req.title}</h3>
        <p><strong>${req.progress} / ${req.target}</strong></p>
        <p class="muted requirement-state">${req.complete ? "Completed" : targetTab ? `Go to ${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)} →` : "In Progress"}</p>
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

    // Re-render refinery active runs for live progress
    renderRefinery(appState.data);

    // Live-update expedition progress bars
    renderExpeditions(appState.data);

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
  const hireCost = adjustedHireCount * 2000;

  hireInput.max = String(availableStaffCapacity);
  if (Number(hireInput.value || 1) !== adjustedHireCount) {
    hireInput.value = String(adjustedHireCount);
  }

  hireHint.textContent = `Immediate funding: ${toCurrency(hireCost)} credits. Ongoing payroll impact: ${toCurrency(adjustedHireCount * 150)}/day. Available headroom: ${corp.employeeCap - corp.employeeCount} employee(s).`;

  const extractorCount = (corp.buildings || []).filter((b) => b.name === "Basic Extractor Yard").length;
  const extractorCap = Number(corp.unlocks?.maxBasicExtractorYards || 1);
  buildHint.textContent = `Requires 1 free building slot and ${toCurrency(50000)} credits. Current slots: ${corp.buildings.length}/${corp.buildingSlots}. Extractor cap: ${extractorCount}/${extractorCap}.`;

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
      let progressMeta = "";
      if (item.startedAt) {
        const remainingMs = Math.max(0, (item.startedAt + item.durationHours * 3_600_000) - Date.now());
        const rHrs = Math.floor(remainingMs / 3_600_000);
        const rMins = Math.floor((remainingMs % 3_600_000) / 60_000);
        const timeStr = remainingMs > 0 ? `${rHrs}h ${rMins}m remaining` : "Completing...";
        progressMeta = `<div class="queue-progress-meta"><span>${progress.toFixed(1)}%</span><span>${timeStr}</span></div>`;
      }
      return `
      <article class="queue-item">
        <h3>${item.name}</h3>
        <p class="muted">${subtitle}</p>
        <p>${item.effect}</p>
        <p class="muted">Duration: ${item.durationHours}h | ${item.startedAt ? "In progress" : "Queued"}</p>
        ${item.costCredits ? `<p class="muted">Committed funding: ${toCurrency(item.costCredits)} credits</p>` : ""}
        ${progressMeta}
        <div class="progress-wrap"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
      </article>
      `;
    })
    .join("");
}

const RESOURCE_CATALOG = [
  "Silicates", "Helium-3", "Nickel", "Titanium", "Carbon",
  "Water Ice", "Rare Earths", "Thorium", "Hydrogen", "Lithium",
  "Cobalt", "Uranium", "Exotic Matter"
];

const MILESTONE_ROADMAP = [
  "Rent an Office", "Hire 5 Employees", "Reached Corporation Level 1",
  "Purchase a Mining Lease on Mars", "Build a Basic Extractor Yard", "Mine 300 Silicate",
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

function renderRefinery(data) {
  const catalog = document.getElementById("resource-catalog");
  catalog.innerHTML = RESOURCE_CATALOG.map((res) => `<span class="pill">${escapeHtml(res)}</span>`).join("");

  const refineries = data.corp?.refineries || [];
  const unlockedTech = new Set(data.corp?.unlockedTech || []);
  const inventory = data.corp?.inventory || {};
  const hasRefinery = refineries.length > 0;
  const canBuildRefinery = unlockedTech.has("tt-material-compression") && unlockedTech.has("tt-nano-lattice");

  // ── Active Runs ──
  const activeEl = document.getElementById("refinery-active-runs");
  const activeRefineries = refineries.filter((r) => r.active);
  if (!activeRefineries.length) {
    activeEl.innerHTML = `<article class="queue-item"><p class="muted">${hasRefinery ? "No active refinery cycles. Start a production run below." : "Build a Refinery to begin processing raw materials."}</p></article>`;
  } else {
    activeEl.innerHTML = activeRefineries.map((ref) => {
      const chain = data.world.refineryChains.find((c) => c.id === ref.chainId);
      const progress = cycleProgressPercent(ref);
      const remainingMs = Math.max(0, Number(ref.endsAt || 0) - Date.now());
      const outputLabel = chain ? chain.outputs.map((o) => `${o.quantityPerCycle} ${o.item}`).join(", ") : "Unknown";
      return `
        <article class="queue-item">
          <h3>${escapeHtml(ref.name)}</h3>
          <p class="muted">Processing: ${chain ? escapeHtml(chain.input) : "Unknown"} → ${escapeHtml(outputLabel)}</p>
          <p class="muted">Remaining: ${formatDurationHours(remainingMs)} (${progress.toFixed(1)}%)</p>
          <div class="progress-wrap"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
        </article>
      `;
    }).join("");
  }

  // ── Available Chains ──
  const chainsEl = document.getElementById("refinery-chains");
  chainsEl.innerHTML = data.world.refineryChains
    .map((chain) => {
      const techGated = Array.isArray(chain.requiresTechIds) && !chain.requiresTechIds.every((t) => unlockedTech.has(t));
      const outputLabel = Array.isArray(chain.outputs)
        ? chain.outputs.map((o) => typeof o === "string" ? o : `${o.quantityPerCycle} ${o.item}`).join(", ")
        : String(chain.outputs);
      const inputAvailable = Number(inventory[chain.input] || 0);
      const inputNeeded = chain.inputQuantityPerCycle || 0;
      const hasInput = inputAvailable >= inputNeeded;
      const idleRefinery = refineries.find((r) => !r.active);
      const canStart = hasRefinery && !techGated && hasInput && idleRefinery;

      return `
        <section class="data-card">
          <h3>${escapeHtml(chain.input)} Refining</h3>
          <p class="muted">${inputNeeded} ${escapeHtml(chain.input)} → ${escapeHtml(outputLabel)}</p>
          <p class="muted">Cycle: ${chain.cycleDurationHours || "?"}h</p>
          ${techGated
            ? `<p class="muted" style="color:var(--color-warn)">Requires: ${escapeHtml((chain.requiresResearch || []).join(", "))}</p>`
            : `<p class="muted" style="color:var(--color-accent)">Research: ✓ Unlocked</p>`
          }
          <p class="muted">Inventory: ${inputAvailable.toLocaleString()} ${escapeHtml(chain.input)}${!hasInput && !techGated ? ` (need ${inputNeeded})` : ""}</p>
          ${canStart
            ? `<button class="btn btn-accent refinery-start-btn" data-chain-id="${chain.id}" data-refinery-id="${idleRefinery.id}">Start Run</button>`
            : !hasRefinery && canBuildRefinery
              ? `<button class="btn btn-outline refinery-build-btn">Build Refinery</button>`
              : !hasRefinery && !canBuildRefinery
                ? `<p class="muted" style="color:var(--color-warn)">Refinery construction requires: Material Compression I and Nano-Lattice Weaving research.</p>`
                : ""
          }
        </section>
      `;
    })
    .join("");

  // ── Event delegation for start/build ──
  chainsEl.onclick = async (e) => {
    const startBtn = e.target.closest(".refinery-start-btn");
    if (startBtn && appState.accountId) {
      const chainId = startBtn.getAttribute("data-chain-id");
      const refineryId = startBtn.getAttribute("data-refinery-id");
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      try {
        const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/start-refinery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chainId, refineryId })
        });
        const account = await parseJsonResponse(response);
        appState.data = deepClone(account.state);
        appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        updateAllViews();
      } catch (error) {
        startBtn.disabled = false;
        startBtn.textContent = "Start Run";
        pushFeedback(`Refinery error: ${error.message}`, "warn");
      }
      return;
    }

    const buildBtn = e.target.closest(".refinery-build-btn");
    if (buildBtn && appState.accountId) {
      buildBtn.disabled = true;
      buildBtn.textContent = "Building…";
      try {
        const response = await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/build-refinery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        const account = await parseJsonResponse(response);
        appState.data = deepClone(account.state);
        appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        updateAllViews();
      } catch (error) {
        buildBtn.disabled = false;
        buildBtn.textContent = "Build Refinery";
        pushFeedback(`Build error: ${error.message}`, "warn");
      }
    }
  };
}

// ─── Expeditions (Asteroid Mining) ───────────────────────────────────────────
function renderExpeditions(data) {
  const container = document.getElementById("expedition-panel");
  if (!container) return;

  const am = data?.corp?.asteroidMining || {};
  const active = am.activeExpeditions || [];
  const completed = (am.completedExpeditions || []).slice(-5).reverse();
  const hasProspecting = (data?.corp?.unlockedTech || []).includes("tt-asteroid-prospecting");

  if (!hasProspecting) {
    container.innerHTML = `<p class="muted">Research <em>Asteroid Prospecting Arrays</em> to unlock mining expeditions.</p>`;
    container.hidden = false;
    return;
  }

  const probeCount = am.probeCount || 0;
  const maxProbes = am.maxProbes || 2;
  const maxDeploy = am.maxDeployments || 1;

  let html = `<div class="expedition-summary">
    <span>Probes: <strong>${probeCount}/${maxProbes}</strong></span>
    <span style="margin-left:1rem;">Deployments: <strong>${active.length}/${maxDeploy}</strong></span>
  </div>`;

  if (active.length > 0) {
    html += `<h4 style="margin-top:0.75rem;">Active Expeditions</h4>`;
    for (const exp of active) {
      const elapsed = Date.now() - exp.deployedAt;
      const total = exp.completesAt - exp.deployedAt;
      const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
      const remainMs = Math.max(0, exp.completesAt - Date.now());
      const mins = Math.floor(remainMs / 60000);
      const secs = Math.floor((remainMs % 60000) / 1000);
      const yieldEntries = Object.entries(exp.yields || {});
      const yieldText = yieldEntries.length ? yieldEntries.map(([r, q]) => `${q} ${r}`).join(", ") : "Scanning...";
      const beltLabel = exp.beltKey || "Unknown Belt";
      html += `<div class="expedition-card">
        <div class="expedition-card-header">
          <span class="expedition-belt-label">${escapeHtml(beltLabel)}</span>
          <span class="muted" style="font-size:0.78rem;">${exp.duration} — ${mins}m ${String(secs).padStart(2, "0")}s</span>
        </div>
        <div class="progress-wrap"><div class="progress-bar expedition-bar" style="width:${pct.toFixed(1)}%"></div></div>
        <p class="muted expedition-yields">Yields: ${escapeHtml(yieldText)}</p>
      </div>`;
    }
  }

  if (completed.length > 0) {
    html += `<h4 style="margin-top:0.75rem;">Recent Returns</h4>`;
    for (const exp of completed) {
      const yieldEntries = Object.entries(exp.yields || {});
      const yieldText = yieldEntries.length ? yieldEntries.map(([r, q]) => `${q} ${r}`).join(", ") : "None";
      html += `<div class="expedition-card completed">
        <span class="expedition-belt-label">${escapeHtml(exp.beltKey || "")}</span>
        <span class="muted" style="font-size:0.78rem;">${exp.duration} — Completed</span>
        <p class="muted expedition-yields">Total yield: ${escapeHtml(yieldText)}</p>
      </div>`;
    }
  }

  if (active.length === 0 && completed.length === 0) {
    html += `<p class="muted">No expeditions yet. Launch probes from the Starmap asteroid belt view.</p>`;
  }

  container.innerHTML = html;
  container.hidden = false;
}

// ─── Assets ──────────────────────────────────────────────────────────────────
function renderAssets(data) {
  const bannerEl = document.getElementById("assets-station-banner");
  if (bannerEl) bannerEl.innerHTML = "";

  const contentEl = document.getElementById("assets-content");
  if (!contentEl) return;

  const allInventory = getAllInventory();
  const stationRegistry = appState.stationRegistry || [];
  const corp = data.corp || {};

  // ── Inventory: group by resource, then by station ──
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
  let inventoryHtml;
  if (resourceNames.length === 0) {
    inventoryHtml = `<p class="muted">No resources in inventory.</p>`;
  } else {
    inventoryHtml = "";
    for (const resource of resourceNames) {
      const stations = resourceMap[resource];
      const total = Object.values(stations).reduce((s, q) => s + q, 0);
      inventoryHtml += `<div class="assets-resource-group">
        <h4>${escapeHtml(resource)} <span class="muted" style="font-weight:400;font-size:0.78rem;">— ${total.toLocaleString()} total</span></h4>
        <table class="data-table data-table--compact"><thead><tr><th>Station</th><th>Quantity</th></tr></thead><tbody>`;
      for (const st of stationRegistry) {
        const qty = stations[st.id];
        if (!qty) continue;
        inventoryHtml += `<tr><td>${escapeHtml(st.name)}</td><td>${qty.toLocaleString()}</td></tr>`;
      }
      inventoryHtml += `</tbody></table></div>`;
    }
  }

  // ── Offices ──
  const offices = corp.offices || [];
  // Deduplicate by stationId
  const seenStations = new Set();
  let officesHtml;
  if (offices.length === 0) {
    officesHtml = `<p class="muted">No office leases on record.</p>`;
  } else {
    officesHtml = offices
      .filter((o) => {
        if (seenStations.has(o.stationId)) return false;
        seenStations.add(o.stationId);
        return true;
      })
      .map((o) => {
        const st = stationRegistry.find((s) => s.id === o.stationId);
        const expired = o.rentedUntil && o.rentedUntil <= Date.now();
        const badge = expired
          ? `<span class="building-status-badge downtime">Expired</span>`
          : `<span class="building-status-badge operational">Active</span>`;
        return `<div class="assets-office-row">${badge} ${escapeHtml(st?.name || o.stationId)} — ${escapeHtml(o.body || "")}</div>`;
      })
      .join("");
  }

  // ── Mining Leases ──
  const leases = corp.miningLeases || [];
  const extractors = corp.mining?.silicateExtractors || [];
  let leasesHtml;
  if (leases.length === 0) {
    leasesHtml = `<p class="muted">No mining leases on record.</p>`;
  } else {
    leasesHtml = `<table class="data-table data-table--compact"><thead><tr><th>Body</th><th>Type</th><th>Extractors</th><th>Total Mined</th></tr></thead><tbody>`;
    for (const l of leases) {
      const exCount = (l.extractorIds || []).length;
      // Sum totalMined for all extractors assigned to this lease
      const leaseExtractors = extractors.filter((ex) => ex.leaseId === l.id);
      const totalMined = leaseExtractors.reduce((sum, ex) => sum + Number(ex.totalMined || 0), 0);
      leasesHtml += `<tr><td>${escapeHtml(l.body)}</td><td>${escapeHtml(l.leaseType || "Silicate Extraction")}</td><td>${exCount} / ${l.buildingSlots || 2}</td><td>${totalMined.toLocaleString()}</td></tr>`;
    }
    leasesHtml += `</tbody></table>`;
  }

  // ── Extractors ──
  let extractorHtml;
  if (extractors.length === 0) {
    extractorHtml = `<p class="muted">No extractors commissioned.</p>`;
  } else {
    extractorHtml = `<table class="data-table data-table--compact"><thead><tr><th>Name</th><th>Status</th><th>Lease</th><th>Total Mined</th></tr></thead><tbody>`;
    for (const ex of extractors) {
      const status = ex.downtimeActive ? "Downtime" : ex.active ? "Active" : "Idle";
      const statusClass = ex.downtimeActive ? "downtime" : ex.active ? "active" : "idle";
      // Find lease for this extractor
      const lease = leases.find((l) => l.id === ex.leaseId);
      extractorHtml += `<tr><td>${escapeHtml(ex.name || ex.id)}</td><td><span class="building-status-badge ${statusClass}">${status}</span></td><td>${lease ? escapeHtml(lease.body) : "-"}</td><td>${Number(ex.totalMined || 0).toLocaleString()}</td></tr>`;
    }
    extractorHtml += `</tbody></table>`;
  }

  contentEl.innerHTML = `
    <section class="form-card">
      <h3>Inventory</h3>
      ${inventoryHtml}
    </section>

    <section class="form-card">
      <h3>Offices</h3>
      ${officesHtml}
    </section>

    <section class="form-card">
      <h3>Mining Leases</h3>
      ${leasesHtml}
    </section>

    <section class="form-card">
      <h3>Extractors</h3>
      ${extractorHtml}
    </section>
  `;
}

// ─── Logistics ───────────────────────────────────────────────────────────────
const LOGISTICS_FEE_PER_UNIT = 2; // credits per unit transferred

function renderLogistics(data) {
  const station = getCurrentStationInfo(data);
  const bannerEl = document.getElementById("logistics-station-banner");
  if (bannerEl) bannerEl.innerHTML = stationLocationBanner(station);

  const contentEl = document.getElementById("logistics-content");
  if (!contentEl) return;

  const allInventory = getAllInventory();
  const stationRegistry = appState.stationRegistry || [];
  const currentStationId = data.corp?.currentStationId || "earth-station-prime";

  // Build per-station asset cards
  let cardsHtml = "";
  for (const st of stationRegistry) {
    const inv = allInventory[st.id] || {};
    const entries = Object.entries(inv).filter(([, qty]) => Number(qty) > 0);
    const isCurrent = st.id === currentStationId;
    const badge = isCurrent ? `<span class="logistics-current-badge">Current</span>` : "";

    let itemsHtml;
    if (entries.length === 0) {
      itemsHtml = `<p class="muted" style="font-size:0.82rem;">No assets stored here.</p>`;
    } else {
      itemsHtml = `<table class="data-table data-table--compact"><thead><tr><th>Resource</th><th>Quantity</th>${!isCurrent ? "<th>Transfer</th>" : ""}</tr></thead><tbody>`;
      for (const [item, qty] of entries) {
        const fee = LOGISTICS_FEE_PER_UNIT * Number(qty);
        if (isCurrent) {
          itemsHtml += `<tr><td>${escapeHtml(item)}</td><td>${Number(qty).toLocaleString()}</td></tr>`;
        } else {
          itemsHtml += `<tr>
            <td>${escapeHtml(item)}</td>
            <td>${Number(qty).toLocaleString()}</td>
            <td>
              <div class="logistics-transfer-row">
                <input type="number" class="logistics-qty-input" min="1" max="${Number(qty)}" value="${Number(qty)}" data-from-station="${escapeHtml(st.id)}" data-item="${escapeHtml(item)}" />
                <button class="btn btn-outline btn-sm logistics-transfer-btn" type="button" data-from-station="${escapeHtml(st.id)}" data-item="${escapeHtml(item)}">
                  Transfer here
                </button>
              </div>
              <span class="muted" style="font-size:0.72rem;">Fee: ${toCurrency(LOGISTICS_FEE_PER_UNIT)}/unit</span>
            </td>
          </tr>`;
        }
      }
      itemsHtml += `</tbody></table>`;
    }

    cardsHtml += `
      <div class="logistics-station-card ${isCurrent ? "logistics-station-card--current" : ""}">
        <div class="logistics-station-header">
          <h3>${escapeHtml(st.name)} ${badge}</h3>
          <span class="muted" style="font-size:0.78rem;">${escapeHtml(st.body)}, ${escapeHtml(st.systemId?.toUpperCase() || "SOL")}</span>
        </div>
        ${itemsHtml}
      </div>
    `;
  }

  contentEl.innerHTML = cardsHtml;

  // Bind transfer buttons
  contentEl.querySelectorAll(".logistics-transfer-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const fromStation = btn.getAttribute("data-from-station");
      const item = btn.getAttribute("data-item");
      const qtyInput = contentEl.querySelector(`.logistics-qty-input[data-from-station="${fromStation}"][data-item="${item}"]`);
      const quantity = Math.max(1, parseInt(qtyInput?.value || "1", 10));

      btn.disabled = true;
      btn.textContent = "Transferring...";

      try {
        const response = await apiFetch(
          `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/transfer-resources`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromStationId: fromStation, item, quantity })
          }
        );
        const account = await parseJsonResponse(response);
        appState.data = deepClone(account.state);
        appState.walkthroughCompleted = Boolean(account.walkthroughCompleted);
        updateAllViews();
        pushFeedback(`Transferred ${quantity.toLocaleString()} ${item} to ${station?.name || "current station"}.`, "success");
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Transfer here";
        pushFeedback(err.message || "Transfer failed.", "warn");
      }
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
    if (order?.sellerAccountId && appState.accountId && order.sellerAccountId === appState.accountId) {
      return true;
    }
    const seller = String(order?.seller || "").trim().toLowerCase();
    if (!seller) {
      return false;
    }
    return Boolean((myCorpName && seller === myCorpName) || (myEmail && seller === myEmail));
  };

  const allSellOrders = (data.market.orderBook || []).filter((order) => order.type === "sell" && !isOwnSellOrder(order));
  const mySellOrders = (data.market.orderBook || [])
    .filter((order) => order.type === "sell" && isOwnSellOrder(order))
    .slice(0, 50);
  const npcBuyOrders = data.market.npcBuyOrders || [];

  // Build resource filter pills from all visible resources
  const resourceSet = new Set();
  allSellOrders.forEach((o) => o.item && resourceSet.add(o.item));
  npcBuyOrders.forEach((o) => o.item && resourceSet.add(o.item));
  const resources = Array.from(resourceSet).sort();

  const filterBar = document.getElementById("exchange-filter-bar");
  if (filterBar) {
    const cur = appState.exchangeFilter || "";
    filterBar.innerHTML =
      `<button class="exchange-filter-pill${!cur ? " active" : ""}" data-filter="">All</button>` +
      resources.map((r) => `<button class="exchange-filter-pill${cur === r ? " active" : ""}" data-filter="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join("");
  }

  // Apply filter
  const filter = appState.exchangeFilter || "";
  const filteredSellOrders = (filter ? allSellOrders.filter((o) => o.item === filter) : allSellOrders).slice(0, 30);
  const filteredNpcOrders = filter ? npcBuyOrders.filter((o) => o.item === filter) : npcBuyOrders;

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
  if (buyEmpty) buyEmpty.hidden = filteredSellOrders.length > 0;

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
            <td>${toCurrency(order.unitPrice)}</td>
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
  if (npcBuyEmpty) npcBuyEmpty.hidden = filteredNpcOrders.length > 0;

  // Mercenary book
  const mercBook = document.getElementById("mercenary-book");
  mercBook.innerHTML = data.market.mercenaryContracts
    .map(
      (item) =>
        `<li><strong>${item.provider}</strong> renting ${item.unitType} (Power ${item.strength}) for ${toCurrency(item.ratePerHour)}/hour over ${item.durationHours}h.</li>`
    )
    .join("");

  // Inventory snapshot
  const inventory = getInventory();
  const entries = Object.entries(inventory).filter(([, qty]) => Number(qty) > 0);
  const inventoryList = document.getElementById("inventory-list");
  inventoryList.innerHTML = entries.length
    ? entries.map(([name, qty]) => `<li>${escapeHtml(name)}: ${Number(qty).toLocaleString()}</li>`).join("")
    : "<li>No inventory available yet. Begin mining and refining to generate tradable stock.</li>";

  // Create Listing grid
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
          </tr>
        `
      )
      .join("");
  }
  if (mySellOrdersEmpty) mySellOrdersEmpty.hidden = mySellOrders.length > 0;

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

// ─── Mission Reputation System ─────────────────────────────────────────────
const REPUTATION_THRESHOLDS = [0, 1, 3, 7, 15, 30, 60, 120, 250, 500, 1000];
const REPUTATION_TITLES = [
  "Unknown",
  "Registered",
  "Recognized",
  "Reliable",
  "Trusted",
  "Valued",
  "Distinguished",
  "Esteemed",
  "Elite",
  "Legendary",
  "Exalted"
];

function getAgentRepLevel(agentId) {
  const rep = appState.data?.corp?.agentReputation?.[agentId];
  const count = rep?.completedCount || 0;
  let level = 0;
  for (let i = REPUTATION_THRESHOLDS.length - 1; i >= 0; i--) {
    if (count >= REPUTATION_THRESHOLDS[i]) { level = i; break; }
  }
  const nextThreshold = level < 10 ? REPUTATION_THRESHOLDS[level + 1] : REPUTATION_THRESHOLDS[10];
  return { level, count, title: REPUTATION_TITLES[level], nextThreshold, maxLevel: 10 };
}

// ─── Mission Agent Registry ────────────────────────────────────────────────
const MISSION_AGENTS = [
  {
    id: "elara-voss",
    name: "Elara Voss",
    title: "Senior Logistics Coordinator",
    faction: "Interstellar Settlement Authority",
    factionCode: "ISA",
    portrait: "/images/elara_voss.jpg",
    stationId: "earth-station-prime",
    bio: `Coordinator Voss has served the ISA's logistics division for over fourteen years, beginning as a junior freight auditor on Luna Gateway before transferring to Earth Station Prime's newly established Contracting & Assignments Bureau. She earned her Senior Coordinator designation after managing the emergency redistribution of silicate reserves during the Ceres Supply Crisis of 2139 — an operation that required coordinating seventeen independent mining corporations under a 72-hour ISA directive.

Her management style is precise, documented, and unapologetically procedural. Contractors who deliver on time and within specification earn her trust. Those who miss deadlines or falsify manifests do not get second contracts.

She maintains a small but well-organised office on Deck 7 of the Bureau. The filing cabinets are alphabetised. The coffee is adequate. The contracts are real.`,
    dialogue: [
      "Good. You're here. I have contracts that need competent operators — not speculators who think logistics is a side business.",
      "The ISA needs resources moved, extracted, and delivered on schedule. If you can handle that, we'll get along fine.",
      "Review the available contracts below. Each one has a deadline and a quota. Meet the terms, sell directly to me, and you'll be compensated. Miss the terms, and I file an incomplete. Your record is your reputation."
    ],
    missionType: "Logistics",
    available: true
  }
];

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
  const isAtAgentStation = !agentStationId || agentStationId === currentStationId;

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
    const riskClass = mission.risk === "Low" ? "risk-low" : mission.risk === "Medium" ? "risk-med" : "risk-high";
    riskBadge.className = `mission-card-risk ${riskClass}`;
    riskBadge.textContent = `${mission.risk} Risk`;
  }
  if (rewardBadge) rewardBadge.textContent = mission.reward;

  // Accept button: only for non-active missions
  if (acceptBtn) {
    acceptBtn.hidden = isActive;
  }

  // Quota progress (only for active missions with a quota)
  let canComplete = false;
  if (isActive && mission.quota && quotaSection) {
    const inv = getInventory(); // current station inventory
    const resource = mission.quota.resource || "";
    const required = mission.quota.amount || 0;
    const have = inv[resource] || 0;
    const pct = required > 0 ? Math.min(100, Math.round((have / required) * 100)) : 100;
    const isFulfilled = have >= required;
    canComplete = isFulfilled && isAtAgentStation;

    quotaSection.hidden = false;
    if (quotaBar) {
      quotaBar.style.width = pct + "%";
      quotaBar.className = "mission-quota-bar" + (isFulfilled ? " quota-fulfilled" : "");
    }
    const currentStation = appState.stationRegistry.find(s => s.id === currentStationId);
    const stationLabel = currentStation ? currentStation.name : "this station";
    if (quotaText) {
      const displayResource = resource.charAt(0).toUpperCase() + resource.slice(1);
      quotaText.innerHTML = `<strong>${have.toLocaleString()}</strong> / ${required.toLocaleString()} ${escapeHtml(displayResource)} at ${escapeHtml(stationLabel)}`;
    }
  } else if (quotaSection) {
    quotaSection.hidden = true;
  }

  // Location warning (active + remote)
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

function showMissionCompleteOverlay(mission, rep, agentName) {
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
        <span class="mission-complete-reward-value">${escapeHtml(mission.reward)}</span>
      </div>
      <div class="mission-complete-rep">
        <span class="mission-complete-rep-label">Standing with ${escapeHtml(agentName)}</span>
        <span class="mission-complete-rep-value">${escapeHtml(rep.title)} (Level ${rep.level})</span>
      </div>
      ${leveledUp ? `<div class="mission-complete-levelup">\u2B50 Reputation Level Up! You are now <strong>${escapeHtml(rep.title)}</strong> with ${escapeHtml(agentName)}.</div>` : ""}
      <button class="btn btn-accent btn-command mission-complete-dismiss" type="button">Dismiss</button>
    </div>
  `;

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
          const riskClass = mission.risk === "Low" ? "risk-low" : mission.risk === "Medium" ? "risk-med" : "risk-high";
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
            const riskClass = mission.risk === "Low" ? "risk-low" : mission.risk === "Medium" ? "risk-med" : "risk-high";
            const agent = MISSION_AGENTS.find(a => a.id === mission.agentId);
            const agentStation = agent ? agent.stationId : null;
            const isRemote = agentStation && agentStation !== currentStationId;
            const stationObj = isRemote ? appState.stationRegistry.find(s => s.id === agentStation) : null;
            const locationTag = isRemote && stationObj
              ? `<span class="mission-location-tag mission-location-remote" title="Agent is at ${escapeHtml(stationObj.name)}">⚠ ${escapeHtml(stationObj.body || stationObj.name)}</span>`
              : isRemote
                ? `<span class="mission-location-tag mission-location-remote">⚠ Remote</span>`
                : `<span class="mission-location-tag mission-location-local">● Local</span>`;
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
              <button class="btn btn-outline btn-sm" type="button" data-abandon-mission="${mission.id}">Abandon</button>
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
      completedLog.innerHTML = completedMissions.slice(0, 30).map(m => {
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
  enforceTravelTabLockdown(data);
  renderTravelPage(data);
  renderStation(data);
  renderLevel2Progress(data);
  renderActionHints(data);
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
  renderCombatReports(data);
  renderChatLog(data);
  renderChatChannelTabs();
  renderFinanceCharts(data.corp.finances);
  renderFeedbackLog();
  updateInvestmentPanel(data);
  starmap.setSystems(data.world.systems);
  starmap.setStations(appState.stationRegistry, data.corp?.currentStationId, data.corp?.currentSystemId || "sol");
  starmap.setUnlockedTech(new Set(data.corp?.unlockedTech || []));
  const am = data.corp?.asteroidMining || {};
  starmap.setAsteroidMining({
    probeCount: am.probeCount || 0,
    maxProbes: am.maxProbes || 2,
    maxDeployments: am.maxDeployments || 1,
    activeExpeditions: am.activeExpeditions || [],
    scoutedBelts: am.scoutedBelts || [],
    beltCompositions: appState.beltCompositions || {}
  });
  renderExpeditions(data);
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
        `Hiring order confirmed. ${count} employee(s) onboarded for ${toCurrency(count * 2000)}. Payroll burn increased by ${toCurrency(count * 150)}/day.`,
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
        `Basic Extractor Yard commissioned. ${toCurrency(50000)} capital deployed and your first persistent mining line is now available.`,
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
}

function bindTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.jump));
  });

  // Delegated handler for dynamically-rendered requirement cards
  const requirementsWrap = document.getElementById("level2-requirements");
  if (requirementsWrap) {
    requirementsWrap.addEventListener("click", (e) => {
      const card = e.target.closest("[data-jump]");
      if (card) setTab(card.dataset.jump);
    });
  }
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
  appState.activeMissions = appState.data.corp?.activeMissions || [];

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
    appState.activeMissions = appState.data.corp?.activeMissions || [];
    refreshBeltCompositions();
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
      if (!response.ok) return;
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
        if (!response.ok) return;
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
    // Click card → open modal
    const card = event.target.closest("[data-mission-id]");
    if (card) {
      openMissionModal(card.getAttribute("data-mission-id"), appState.data);
    }
  });

  // Complete contract: deduct resources and remove from active
  missionCompleteBtn?.addEventListener("click", async () => {
    const mission = (appState.activeMissions || []).find((m) => m.id === appState.selectedMissionId);
    if (!mission || !mission.quota) return;

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
      const inv = getInventory();
      const resource = mission.quota.resource || "";
      const required = mission.quota.amount || 0;
      const have = inv[resource] || 0;
      if (have < required) return;

      // Deduct resources
      inv[resource] = have - required;
      if (inv[resource] <= 0) delete inv[resource];

      // Remove from active
      appState.activeMissions = appState.activeMissions.filter((m) => m.id !== mission.id);
      if (appState.data?.corp) {
        appState.data.corp.activeMissions = appState.activeMissions;
      }

      // Credit reward
      const rewardCredits = parseInt(String(mission.reward).replace(/[^0-9]/g, ""), 10);
      if (rewardCredits && appState.data?.corp) {
        appState.data.corp.credits = (appState.data.corp.credits || 0) + rewardCredits;
      }
    }

    pushFeedback(`Contract completed: "${mission.title}". ${mission.reward} credited.`, "success");

    // Check for reputation level-up
    const agentId = mission.agentId || "unknown";
    const rep = getAgentRepLevel(agentId);
    const agent = MISSION_AGENTS.find(a => a.id === agentId);
    const agentName = agent ? agent.name : "Agent";

    // Show completion celebration overlay
    showMissionCompleteOverlay(mission, rep, agentName);

    renderMissions(appState.data);
    renderInventoryPanel();
    updateAllViews();
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
    const seller = row?.children[3]?.textContent || "Anonymous";

    const totalCost = qty * price;
    const confirmed = await showTradeConfirmation({
      heading: "Buy from Sell Order",
      title: `Buy ${escapeHtml(item)}`,
      confirmLabel: "Buy",
      rows: [
        { label: "Item", value: escapeHtml(item) },
        { label: "Quantity", value: qty.toLocaleString() },
        { label: "Unit Price", value: toCurrency(price) },
        { label: "Seller", value: escapeHtml(seller) },
        { label: "Total Cost", value: toCurrency(totalCost), highlight: true }
      ]
    });
    if (!confirmed) return;

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

  // Resource filter pills
  const filterBarEl = document.getElementById("exchange-filter-bar");
  filterBarEl?.addEventListener("click", (event) => {
    const pill = event.target.closest(".exchange-filter-pill");
    if (!pill) return;
    appState.exchangeFilter = pill.getAttribute("data-filter") || "";
    renderMarket(appState.data);
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
    const qty = Math.max(1, Number(qtyInput?.value || 1));
    const npcStatus = document.getElementById("npc-buy-status");

    const grossTotal = qty * price;
    const taxPct = getClientExchangeTaxPct();
    const taxAmount = Math.round(grossTotal * taxPct / 100);
    const netProceeds = grossTotal - taxAmount;
    const buyer = row?.children[1]?.textContent || "NPC";

    const confirmed = await showTradeConfirmation({
      heading: "Sell to Standing Buy Order",
      title: `Sell ${escapeHtml(item)}`,
      confirmLabel: "Sell",
      rows: [
        { label: "Item", value: escapeHtml(item) },
        { label: "Quantity", value: qty.toLocaleString() },
        { label: "Unit Price", value: toCurrency(price) },
        { label: "Buyer", value: escapeHtml(buyer) },
        { label: "Gross Total", value: toCurrency(grossTotal) },
        { label: `GEX Sales Tax (${taxPct}%)`, value: `− ${toCurrency(taxAmount)}`, muted: true },
        { label: "You Receive", value: toCurrency(netProceeds), highlight: true }
      ]
    });
    if (!confirmed) return;

    try {
      const response = await apiFetch(`/api/market/npc-orders/${encodeURIComponent(orderId)}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: qty })
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

  socket.on("ceo:completed", (payload) => {
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
  });

  socket.on("expedition:completed", (payload) => {
    if (!appState.data || !appState.accountId || payload?.accountId !== appState.accountId) return;
    refreshFromServer();
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
