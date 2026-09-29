import { renderFinanceCharts, bindChartDurationPickers } from "./charts.js";

import { escapeHtml, bootFailureHtml } from "./html.js";

// AB#738 (ISP-52): the shared pieces app.js used to define itself.
import { appState, IS_DEV_ACCESS, techTree } from "./state.js";
import { loadSectionCodes } from "./sectionCodes.js"; // ISP-248 (AB#944)
import { navigationFor } from "./navigation.js"; // ISP-112 (AB#804)
import { connectApiClient, socket, reauthenticateSocket, persistSession, clearSession, redirectToLoginPage, handleSessionExpired, createInvalidSessionError, hydrateSession, refreshSessionToken, apiFetch, parseJsonResponse } from "./apiClient.js";
import { toCurrency, deepClone } from "./helpers.js";

import { connectWalkthroughUi, hasSeenWalkthroughOffer, noteWalkthroughEvent, promptWalkthroughOffer } from "./walkthroughUi.js";
// AB#739 (ISP-53): one module per tab, and the shared pieces they use.
import { renderAssets } from "./views/assets.js";
import { renderFleet } from "./views/fleet.js"; // ISP-175 (AB#869)
import { renderRaids } from "./views/raids.js"; // ISP-181 (AB#875)
import { applyMissionAgentsCatalog, bindAssignmentForms, refreshOpenMissionModal, renderMissions } from "./views/assignments.js";
import { renderInsightTree } from "./views/ceoInsight.js";
import { bindCollapsibleSections, bindGlobalControls, loadNotifications, renderNotifications, updateCorpIdentity, updateReplayOnboardingVisibility } from "./views/chrome.js";
import { bindCommsForms, renderChatChannelTabs, renderChatLog, resolveChatChannel } from "./views/comms.js";
import { bindExchangeForms, renderMarket } from "./views/exchange.js";
import { bindFinanceSubpages, loadStatements, refreshStatementsIfDayClosed, renderFinanceDashboard } from "./views/finance.js";
import { applyForumsEvent, bindForumForms, renderForums } from "./views/forums.js";
import { bindInboxControls, loadMessages, onInboxTabActivated, renderInboxMessageList } from "./views/inbox.js";
import { onConversationEvent } from "./views/conversations.js"; // AB#911
import { renderLogistics } from "./views/logistics.js";
import { renderMiningCyclePanel, startMiningUiTicker, stopMiningUiTicker } from "./views/miningTicker.js";
import { renderExpeditionPanel, renderLevel2Progress, updateOverview } from "./views/overview.js";
import { loadConglomerate, onConglomerateChange, openBureau, refreshStations, renderConglomerateHq } from "./views/conglomerateBureau.js"; // ISP-201 (AB#895); refreshStations: ISP-213 (AB#908)
import { renderRefinery } from "./views/refinery.js";
import { bindResearchForms, renderQueue, renderResearchTotals, renderTechTree } from "./views/research.js";
import { connectViews, isPlayerTraveling, pushFeedback, renderFeedbackLog, revealUnderHeader } from "./views/shared.js";
import { commsMeaning } from "./commsProtocol.js"; // ISP-255c1 (AB#4830)
import { noteLevel, startTelemetry } from "./telemetry.js"; // ISP-256 (AB#952)
import { loadBeltCompositionsIntoStarmap, loadTariffs, starmap } from "./views/starmap.js";
import { loadPatentRegister } from "./views/patentOffice.js"; // ISP-237 (AB#932): the Refinery's royalty quote reads it
import { bindBuildingActions, refreshOpenLeaseView, renderStation } from "./views/station.js";
import { bindOperations, renderOperations } from "./views/operations.js"; // AB#2471
import { clearTravelTimer, renderTravelPage } from "./views/travel.js";

// The moved modules call back into the game screen app.js owns; hand them what they need before anything runs.
connectApiClient({ stopMiningUiTicker, showAuthScreen });
connectWalkthroughUi({ updateAllViews, setTab });
connectViews({ updateAllViews, setTab, refreshFromServer, showAuthScreen });

// ------------- ELEMENTS ------------- //
const tabButtons = Array.from(document.querySelectorAll(".nav-tab"));
const groupButtons = Array.from(document.querySelectorAll(".nav-group__button")); // ISP-75 (AB#764)
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const authShell = document.getElementById("auth-shell");
const gameShell = document.getElementById("game-shell");

import { starmapMiningState } from "./beltCompositions.js";
import { openGroupOf, tabForGroup, lockEmptyGroups } from "./navGroups.js"; // ISP-75 (AB#764) // Bug #1264 (placed here, apart from the imports at the top that parallel PRs edit)
import { showTabGroup, toggleNavGroup } from "./sidebarState.js"; // AB#2481
import { sidebarStartsCollapsed } from "./firstAction.js"; // AB#2481: a phone's width, where the groups are the bar

// ─── Tabs allowed during travel ──────────────────────────────────────────────
// The Travel screen itself is views/travel.js, on the design system since ISP-83 (AB#772); e2e/travel-screen.spec.js
// looks at its three states (AB#1053).
// ISP-201 (AB#895): membership moves happen anywhere (docs/design/CONGLOMERATES.md), so the Conglomerate tab stays open in transit.
const TRAVEL_ALLOWED_TABS = new Set(["overview", "inbox", "chat", "forums", "starmap", "travel", "conglomerate"]);
// ISP-201 (AB#895): each fresh read of the conglomerate redraws the Overview's card.
onConglomerateChange(() => {
  if (!appState.authenticated || !appState.data) return;
  updateOverview(appState.data);
  // ISP-208 (AB#903): the Exchange's Sellers filter and Partner badges follow membership.
  if (document.getElementById("market")?.classList.contains("active")) renderMarket(appState.data);
  // ISP-213 (AB#908): the Station tab's panel for a member docked at its own conglomerate's station. Drawn whether or
  // not the tab is showing: switching to it does not draw it again, and the first draw often precedes this read.
  renderStation(appState.data);
});

function isPlayerInSpace(data) {
  return !data?.corp?.currentStationId && !isPlayerTraveling(data);
}

function enforceTravelTabLockdown(data) {
  const traveling = isPlayerTraveling(data);
  const inSpace = isPlayerInSpace(data);
  const showTravelTab = traveling || inSpace;
  const travelTabBtn = document.querySelector('.nav-tab[data-tab="travel"]');

  // Show/hide the Travel tab button
  if (travelTabBtn) travelTabBtn.hidden = !showTravelTab;

  // Enable/disable tabs
  tabButtons.forEach((btn) => {
    const tabId = btn.dataset.tab;
    if (traveling && !TRAVEL_ALLOWED_TABS.has(tabId)) {
      btn.disabled = true;
      btn.classList.add("nav-tab--locked");
    } else {
      btn.disabled = false;
      btn.classList.remove("nav-tab--locked");
    }
  });
  lockEmptyGroups();

  // If currently on a locked tab, switch to travel
  if (traveling) {
    const activeTab = document.querySelector(".nav-tab.active");
    const activeId = activeTab?.dataset?.tab;
    if (!activeId || !TRAVEL_ALLOWED_TABS.has(activeId)) {
      setTab("travel");
    }
  }

  // If in space (just arrived in system), switch to travel to show docking options
  if (inSpace) {
    const activeTab = document.querySelector(".nav-tab.active");
    const activeId = activeTab?.dataset?.tab;
    if (activeId === "station") {
      setTab("travel");
    }
  }
}

// The asteroid-mining feedback lines (AB#1257), beside the fabrication handler that writes one of them.
import { probeReadyText } from "./miningFeedback.js";

// TODO(AB#730): Can this be refactored to improve performance? Where is this function called? Do we always need to update every single view? 
// AB#730: every full re-render is timed as a performance measure, "isp:updateAllViews", which DevTools shows in its
// Timings track and scripts/bench-render.mjs reads. The cost is one performance.now() and one measure per render.
function updateAllViews() {
  const start = performance.now();
  renderAllViews();
  performance.measure("isp:updateAllViews", { start });
}

/**
 * AB#1452 (ISP-44a): the two costliest views, the Galactic Exchange's order book and the six finance charts (74 and
 * 51 ms of a ~178 ms re-render at 4x throttling), draw only while their tab is on screen, and setTab draws them on the
 * switch to it. Nothing else reads what they draw, so a hidden one is simply drawn later, from the state as it is then.
 */
const isTabOnScreen = (id) => document.getElementById(id)?.classList.contains("active") === true;

function renderMarketIfOnScreen(data) {
  if (isTabOnScreen("market")) renderMarket(data);
}

function renderFinanceChartsIfOnScreen(data) {
  if (isTabOnScreen("finance")) renderFinanceCharts(data.corp.finances);
}

function renderAllViews() {
  noteLevel(appState.data?.corp?.level); // ISP-256 (AB#952): a rise in the corporation's level is rank_up
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
  renderOperations(data); // AB#2471: everything in progress
  renderFleet(data); // ISP-175 (AB#869)
  renderRaids(data); // ISP-181 (AB#875): the incoming-raid alert, garrisons, the target picker and reports
  renderLevel2Progress(data);
  renderQueue("rnd-queue", data.queues.corporateRnD, "Permanent corporate unlock track");
  renderQueue("ceo-queue", data.queues.ceoInsight, "CEO-centric growth track");
  renderResearchTotals(data); // AB#2475
  renderTechTree(data);
  renderInsightTree(data);
  renderRefinery(data);
  renderMarketIfOnScreen(data);
  renderAssets(data);
  renderLogistics(data);
  renderForums(data);
  renderMissions(data);
  renderChatLog(data);
  renderChatChannelTabs();
  renderFinanceChartsIfOnScreen(data);
  renderFinanceDashboard(data.corp.finances);
  renderFeedbackLog();
  if (data.world?.systems) starmap.setSystems(data.world.systems);
  starmap.setStations(appState.stationRegistry, data.corp?.currentStationId, data.corp?.currentSystemId || "sol");
  starmap.setUnlockedTech(new Set(data.corp?.unlockedTech || []));
  starmap.setAsteroidMining(starmapMiningState(data, appState.beltCompositions, { belts: appState.belts, respawnChancePerHour: appState.beltRespawnChance, remoteDispatchYieldPct: appState.remoteDispatchYieldPct }));
  renderExpeditionPanel(data);
  renderInboxMessageList();
}

function setTab(targetId) {
  // Block navigation to locked tabs during travel
  const traveling = isPlayerTraveling(appState.data || {});
  if (traveling && !TRAVEL_ALLOWED_TABS.has(targetId)) return;

  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === targetId);
    if (btn.dataset.tab === targetId) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  openGroupOf(targetId);
  showTabGroup(targetId, sidebarStartsCollapsed(window.innerWidth)); // AB#2481: the open tab's group is expanded

  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === targetId);
  });

  if (targetId === "starmap") {
    requestAnimationFrame(() => starmap.resize());
  }

  // AB#1452: a view that is not drawn while hidden is drawn now, as its tab comes on screen.
  const shown = appState.authenticated ? appState.data : null;
  if (targetId === "market" && shown) renderMarket(shown);

  if (targetId === "finance") {
    if (shown) renderFinanceCharts(shown.corp.finances);
    loadStatements(); // AB#714: the closed days are fetched on their own, not carried in the account
  }

  if (targetId === "inbox") {
    onInboxTabActivated();
  }

  if (targetId === "conglomerate" && shown) renderConglomerateHq(document.getElementById("conglomerate-hq"));

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
  // ISP-201 (AB#895): "bureau" is the Conglomerate Affairs Bureau: its building when docked at Earth Station Prime, where
  // it is, and otherwise the Conglomerate tab, which says where to go.
  if (targetId === "bureau") {
    if (appState.data?.corp?.currentStationId === "earth-station-prime") return openBureau();
    targetId = "conglomerate";
  }
  setTab(targetId);
  const panel = document.getElementById(targetId);
  if (panel?.classList.contains("active")) revealUnderHeader(panel);
}

function bindTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => goToTab(button.dataset.tab));
  });
  // ISP-75 (AB#764): a group's button opens the tab that group last showed, or its first. AB#2481: on a desktop, where
  // the group's tabs are listed under its name, the name collapses and expands them instead; the briefing is told, so
  // its highlight moves from the name to the tab it now shows.
  groupButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!sidebarStartsCollapsed(window.innerWidth)) {
        toggleNavGroup(button.dataset.group);
        noteWalkthroughEvent(`nav-group:${button.dataset.group}`);
        return;
      }
      const tab = tabForGroup(button.dataset.group);
      if (tab) goToTab(tab);
    });
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
  appState.walkthroughCompleted = Boolean(options.walkthroughCompleted);
  appState.data = deepClone(data);
  startTelemetry({ version: appState.appVersion }); // ISP-256 (AB#952): app_open, once a page, when the game is entered
  noteLevel(appState.data?.corp?.level);
  appState.activeMissions = appState.data.corp?.activeMissions || [];
  appState.beltCompositions = {}; // Bug #1264: never another account's; this account's are fetched below
  appState.belts = {}; // AB#2331: likewise

  if (appState.serverData) {
    applySharedState(appState.serverData);
  }

  persistSession();
  if (appState.accountId) loadBeltCompositionsIntoStarmap(); // Bug #1264
  appState.tariffs = null; // ISP-231 (AB#926): never another account's; this account's are fetched below
  if (appState.accountId) loadTariffs();
  appState.patents = null; // ISP-237 (AB#932): the public register, for the royalty on a patented chain
  if (appState.accountId && mode !== "dummy") loadPatentRegister();
  // ISP-201 (AB#895): the Overview's Conglomerate card reads this; never another account's.
  appState.conglomerate = undefined;
  if (appState.accountId && mode !== "dummy") loadConglomerate();

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
  // ISP-95 (AB#785): the building catalogue, for the construction panel; kept for the same reason as the economy.
  if (Array.isArray(appState.serverData?.playerBuildings)) appState.playerBuildings = appState.serverData.playerBuildings;
  if (Array.isArray(appState.serverData?.units)) appState.units = appState.serverData.units; // ISP-171 (AB#865)
  if (Array.isArray(appState.serverData?.milestoneRoadmap)) appState.milestoneRoadmap = appState.serverData.milestoneRoadmap; // AB#798
  if (Array.isArray(appState.serverData?.levelLadder)) appState.levelLadder = appState.serverData.levelLadder; // AB#803

  const version = appState.serverData?.version;
  appState.appVersion = version || null; // ISP-256 (AB#952): kept apart, since state:init replaces serverData wholesale
  if (version) {
    const versionLine = document.getElementById("app-version-line");
    if (versionLine) {
      // ISP-83 (AB#772): the version and the founding year; the name is the heading right under it.
      versionLine.textContent = `v${version} · est. 2147`;
    }
  }

  return appState.serverData;
}

async function loadStationRegistry() {
  loadSectionCodes(); // ISP-248 (AB#944): the document codes, filled into every title's slot; never awaited
  try {
    const [stationsRes, buildingsRes, insightRes, missionAgentsRes, researchRes, systemsRes] = await Promise.all([
      fetch("/api/stations"),
      fetch("/api/buildings"),
      fetch("/api/ceo-insight"),
      fetch("/api/mission-agents"),
      fetch("/api/research"),
      fetch("/api/systems")
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
    if (systemsRes.ok) {
      // ISP-112 (AB#804): every per-system fact, and the travel gate and routes over it, from data/systems.json.
      const data = await systemsRes.json();
      appState.systemsCatalog = data.systems || [];
      appState.navigation = navigationFor(appState.systemsCatalog);
    }
    if (insightRes.ok) {
      const data = await insightRes.json();
      appState.insightPrograms = data.programs || [];
      appState.insightCategories = data.categories || []; // AB#2474
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

  // AB#757: a page load holds no access token; the HttpOnly refresh cookie is the session, and refreshing from it
  // either yields one or sends the player to log in (refreshSessionToken handles the expiry).
  if (!appState.accessToken && !(await refreshSessionToken())) {
    return null;
  }

  const account = await loadAuthenticatedAccount();
  enterGame("account", account.state, {
    accountId: account.id,
    accountEmail: account.email,
    accessToken: appState.accessToken,
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
    loadTariffs(); // ISP-231 (AB#926): a jump or a dock changes the rate the corporation pays
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

/** Each tab binds its own forms (AB#739): the listeners are the ones bindForms always added, grouped by tab. */
function bindForms() {
  bindExchangeForms();
  bindResearchForms();
  bindCommsForms();
  bindForumForms();
  bindAssignmentForms();
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
    // Bug #2364: state:init comes on every connect and reconnect, and notifications:new reaches only the sockets in
    // the account's room when it is sent: read the list again, so a note made while this one was down is not lost.
    if (appState.accountId) loadNotifications();
  });

  // ISP-67: the server drops a socket whose token has expired back to anonymous and says so here, rather than
  // disconnecting it. Get a fresh access token and reconnect so per-account events resume without a page reload.
  socket.on("auth:expired", () => {
    if (appState.accountId) refreshSessionToken();
  });

  // AB#995: a chat line the server did not take (too long, or more than 10 in 10 seconds), with its reason
  socket.on("chat:refused", (refusal) => {
    if (refusal?.error) pushFeedback(refusal.error, "warn", { meaning: commsMeaning(refusal), screen: "chat" }); // ISP-255c1 (AB#4830)
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
    renderMarketIfOnScreen(appState.data); // AB#1452: another player's trade no longer redraws a hidden book
  });

  socket.on("forums:updated", (event) => {
    // AB#995: one thread that changed (a new thread, a reply, a like), applied to what this player has paged in, and
    // the visible forum view re-rendered, so new posts appear in real time without a reload.
    if (!appState.data) return;
    applyForumsEvent(event);
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
    if (payload.creditRating !== undefined) appState.data.corp.creditRating = payload.creditRating; // ISP-148 (AB#842)
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

  // ISP-201 (AB#895): a membership change in this corporation's conglomerate, or one addressed to it (the server sends
  // these to the conglomerate's room and the affected account only): read the conglomerate again.
  for (const event of ["invited", "applied", "joined", "left", "invitation-closed", "application-closed", "role-changed", "removed", "dissolved", "identity-changed", "levelled", "level-lost", "treasury", "hangar", "station-project", "station-vote"]) { // station-*: ISP-213 (AB#908)
    socket.on(`conglomerate:${event}`, () => { if (appState.accountId) loadConglomerate(); });
  }
  // ISP-213 (AB#908): a station opened: the conglomerate again, and the station list every map and list reads
  socket.on("conglomerate:station-built", () => { if (appState.accountId) { loadConglomerate(); refreshStations(); } });

  // Bug #1130: mail for this account arrived (the server sends it to this account's room only, with no payload).
  socket.on("messages:new", () => {
    loadMessages();
  });
  // AB#911: a private message arrived (or this account sent one from another tab): the open thread and the unread count
  socket.on("conversations:new", (payload) => onConversationEvent(payload));

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
      const activeTab = document.querySelector(".nav-tab.active");
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
    renderMiningCyclePanel(appState.data); // AB#746: and so does Active Mining Cycles, on the event, not the next tick
    renderMissions(appState.data); // AB#2484: and what an active contract still needs
    refreshOpenMissionModal(appState.data);
  });

  socket.on("expedition:completed", (payload) => {
    if (!appState.data || !appState.accountId || payload?.accountId !== appState.accountId) return;
    refreshFromServer();
    loadMessages();
    loadBeltCompositionsIntoStarmap(); // AB#2331: the belt's reserve has moved
  });

  // AB#2331: a belt emptied or formed anew somewhere: what this account may see of the slots, fetched again, so an
  // open belt panel shows it without a reload.
  socket.on("belts:changed", () => {
    if (!appState.accountId) return;
    loadBeltCompositionsIntoStarmap();
  });
  // Bug #4665: a partner scouted a belt (the conglomerate's room): what this corporation may see of the belts, read
  // again, so an open belt panel shows the shared intel without a reload.
  socket.on("conglomerate:intel", () => {
    if (!appState.accountId) return;
    loadBeltCompositionsIntoStarmap();
  });

  socket.on("fabrication:completed", async (payload) => {
    if (!appState.data || !appState.accountId || payload?.accountId !== appState.accountId) return;
    await refreshFromServer();
    pushFeedback(probeReadyText(appState.data?.corp?.asteroidMining?.probeCount), "ok"); // AB#1257: said once, when true
  });
}

// AB#716: imported beside its one use, away from the import block that parallel pull requests edit.
import { bindPriceChart } from "./priceChart.js";
import { installNumberAcknowledgement } from "./numberChange.js"; // AB#745

async function boot() {
  hydrateSession();
  installNumberAcknowledgement(); // before the first render, so what it draws is the baseline, not a change
  showAuthScreen();
  bindCollapsibleSections();
  bindTabs();
  bindForms();
  bindRealtimeEvents();
  bindGlobalControls();
  bindBuildingActions();
  bindOperations(); // AB#2471: the Station's and Operations' subpages
  bindInboxControls();
  bindChartDurationPickers();
  bindFinanceSubpages(); // AB#2470
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
        authShell.innerHTML = bootFailureHtml("Session restore failed", error.message);
        return;
      }
    }
  } catch (error) {
    authShell.innerHTML = bootFailureHtml("Bootstrap failed", error?.message); // Bug AB#2297: escaped
  }
}

window.addEventListener("DOMContentLoaded", boot);

