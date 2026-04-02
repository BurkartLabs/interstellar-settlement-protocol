import { renderFinanceCharts } from "./charts.js";
import { createStarmapController } from "./starmap.js";

const appState = {
  serverData: null,
  data: null,
  authenticated: false,
  accountId: null,
  profileMode: null,
  walkthroughCompleted: false,
  textOnly: false,
  chatChannel: "global",
  mapMounted: false,
  walkthroughIndex: 0,
  activeTypewriter: null,
  scoutedBodies: new Set(),
  feedbackLog: []
};

const techTree = [
  {
    id: "tt-basic-extraction",
    name: "Basic Extraction Analytics",
    effect: "+10% raw extraction throughput",
    durationHours: 2,
    costCredits: 18000,
    costLiquidity: 12000,
    prereqs: []
  },
  {
    id: "tt-industrial-safety",
    name: "Industrial Safety Protocols",
    effect: "-8% facility downtime risk",
    durationHours: 3,
    costCredits: 26000,
    costLiquidity: 18000,
    prereqs: ["tt-basic-extraction"]
  },
  {
    id: "tt-supply-forecast",
    name: "Supply Forecast Engine",
    effect: "+6% logistics efficiency",
    durationHours: 4,
    costCredits: 32000,
    costLiquidity: 22000,
    prereqs: ["tt-basic-extraction"]
  },
  {
    id: "tt-energy-routing",
    name: "High-Density Energy Routing",
    effect: "+1 advanced manufacturing lane",
    durationHours: 6,
    costCredits: 54000,
    costLiquidity: 36000,
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
    text: "Use this to monitor liquidity, liabilities, and strategic investment activity.",
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
const refreshButton = document.getElementById("refresh-btn");
const textModeToggle = document.getElementById("text-mode-toggle");
const replayOnboardingButton = document.getElementById("replay-onboarding-btn");

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

function toCurrency(number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(number);
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
              text: "Hire your initial employees, queue your first Corporate R&D project, and establish your first mining operation before overcommitting to military spend. Maintain liquidity and use market contracts to smooth bottlenecks.",
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
    level: 1,
    milestonesCompleted: [],
    employeeCap: 20,
    employeeCount: 0,
    buildingSlots: 2,
    buildings: [],
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
      liquidity: 90000,
      liquidityCap: 90000,
      liquidityRegenPerHour: 2800,
      lastLiquidityTick: Date.now(),
      taxRatePct: 14,
      bondYieldPct: 0
    },
    inventory: {},
    mining: {
      silicateExtractor: {
        active: false,
        startedAt: null,
        lastTickAt: null,
        endsAt: null,
        throughputPerHour: 0,
        operationCostPerHour: 0,
        totalMined: 0,
        totalSpent: 0,
        lastCompletedAt: null
      }
    },
    unlocks: {
      marketSectors: ["Raw Materials"],
      maxUpgradeTier: 1,
      maxFleetSize: 8
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
        <p class="muted">Funding: ${toCurrency(node.costCredits)} credits | ${toCurrency(node.costLiquidity)} liquidity</p>
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
    <dt>Level</dt><dd>${corp.level} / ${corp.levelCap}</dd>
    <dt>Employees</dt><dd>${corp.employeeCount} / ${corp.employeeCap}</dd>
    <dt>Building Slots</dt><dd>${corp.buildingSlots}</dd>
    <dt>Fleet Cap</dt><dd>${corp.unlocks.maxFleetSize}</dd>
  `;

  const milestones = document.getElementById("milestone-list");
  milestones.innerHTML = corp.milestoneRoadmap
    .map((item) => {
      const done = corp.milestonesCompleted.includes(item);
      return `<li>${done ? "[Done]" : "[Open]"} ${item}</li>`;
    })
    .join("");
}

function updateOverview(data) {
  const liquidity = Number(data.corp.finances.liquidity || 0);
  const liquidityCap = Number(data.corp.finances.liquidityCap || liquidity);
  const liquidityRegenPerHour = Number(data.corp.finances.liquidityRegenPerHour || 0);

  const cards = [
    {
      title: "Expansion Liquidity",
      value: `${toCurrency(liquidity)} / ${toCurrency(liquidityCap)}`,
      body: `Regenerates at approximately ${toCurrency(liquidityRegenPerHour)}/hour and gates expansion actions.`
    },
    {
      title: "Cash Reserves",
      value: toCurrency(data.corp.finances.credits),
      body: "Total corporate credits on hand. Spending requires both cash and available liquidity."
    },
    {
      title: "Net Daily Flow",
      value: toCurrency(data.corp.finances.dailyRevenue - data.corp.finances.dailyCosts),
      body: "Daily revenue minus operational burn. This drives long-horizon compounding over years."
    },
    {
      title: "Conglomerate Capacity",
      value: `${data.conglomerates[0]?.memberCount || 0} / ${data.conglomerates[0]?.maxMembers || 0}`,
      body: "Alliance scaling path: early groups stay small and unlock higher membership over time."
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

  if (!requirementsWrap || !status) {
    return;
  }

  const level2 = data?.corp?.levelProgress?.level2;
  if (!level2?.requirements?.length) {
    requirementsWrap.innerHTML =
      '<section class="data-card"><p class="muted">Level 2 requirements are unavailable for this profile.</p></section>';
    status.textContent = "";
    return;
  }

  requirementsWrap.innerHTML = level2.requirements
    .map((req) => {
      const doneClass = req.complete ? " requirement-done" : "";
      return `
      <section class="data-card${doneClass}">
        <h3>${req.title}</h3>
        <p><strong>${req.progress} / ${req.target}</strong></p>
        <p class="muted">${req.complete ? "Completed" : "In Progress"}</p>
      </section>
      `;
    })
    .join("");

  if (data.corp.level >= 2) {
    status.textContent = "Level 2 unlocked. Growth unlocks have been applied to your corporation profile.";
    return;
  }

  const extractorCycle = data?.corp?.mining?.silicateExtractor;
  if (extractorCycle?.active && extractorCycle.endsAt) {
    const remainingMs = Math.max(0, Number(extractorCycle.endsAt) - Date.now());
    const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
    status.textContent = `Silicate extraction cycle active. Remaining time: approximately ${remainingMinutes} minute(s).`;
    return;
  }

  status.textContent = "Complete all four requirements to advance from Corporation Level 1 to 2.";
}

function renderActionHints(data) {
  const hireInput = document.getElementById("level2-hire-count");
  const mineInput = document.getElementById("level2-mine-amount");
  const hireHint = document.getElementById("hire-action-hint");
  const mineHint = document.getElementById("mine-action-hint");
  const buildHint = document.getElementById("build-action-hint");
  const level2RndHint = document.getElementById("level2-rnd-hint");

  if (!hireInput || !mineInput || !hireHint || !mineHint || !buildHint || !level2RndHint) {
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

  hireHint.textContent = `Immediate funding: ${toCurrency(hireCost)} credits and liquidity. Ongoing payroll impact: ${toCurrency(adjustedHireCount * 36)}/day. Available headroom: ${corp.employeeCap - corp.employeeCount} employee(s).`;

  const requestedThroughput = Math.max(10, Number(mineInput.value || 40));
  const clampedThroughput = Math.max(10, Math.min(250, requestedThroughput));
  const operationCostPerHour = Math.max(600, Math.round(clampedThroughput * 16));
  const startupCost = Math.max(500, Math.round(operationCostPerHour * 0.35));
  mineHint.textContent = `Launch cost: ${toCurrency(startupCost)} credits and liquidity. Cycle profile: ${clampedThroughput} silicates/hour for 8 hours, with ${toCurrency(operationCostPerHour)}/hour operating spend.`;

  buildHint.textContent = `Requires 1 free building slot and ${toCurrency(65000)} credits plus ${toCurrency(65000)} liquidity. Current slots: ${corp.buildings.length}/${corp.buildingSlots}.`;
  level2RndHint.textContent = `Immediate completion cost: ${toCurrency(40000)} credits and ${toCurrency(40000)} liquidity.`;
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
  details.textContent = `${node.name} costs ${toCurrency(node.costCredits)} credits and ${toCurrency(node.costLiquidity)} liquidity, runs for ${node.durationHours}h, and requires: ${prereqLabel}.`;
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
        ${item.costCredits ? `<p class="muted">Committed funding: ${toCurrency(item.costCredits)} credits | ${toCurrency(item.costLiquidity || 0)} liquidity</p>` : ""}
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
  const orderBook = document.getElementById("order-book");
  orderBook.innerHTML = data.market.orderBook
    .slice(0, 30)
    .map((order) => {
      const actor = order.type === "sell" ? order.seller : order.buyer;
      return `<li><strong>${order.type.toUpperCase()}</strong> ${order.quantity} ${order.item} @ ${toCurrency(order.unitPrice)} by ${actor}</li>`;
    })
    .join("");

  const mercBook = document.getElementById("mercenary-book");
  mercBook.innerHTML = data.market.mercenaryContracts
    .map(
      (item) =>
        `<li><strong>${item.provider}</strong> renting ${item.unitType} (Power ${item.strength}) for ${toCurrency(item.ratePerHour)}/hour over ${item.durationHours}h.</li>`
    )
    .join("");

  renderInventoryPanel();
}

function renderForums(data) {
  const categories = document.getElementById("forum-categories");
  categories.innerHTML = data.forums.categories.map((cat) => `<span class="pill">${cat}</span>`).join("");

  const threads = document.getElementById("forum-threads");
  threads.innerHTML = data.forums.threads
    .map((thread) => {
      const replies = thread.replies
        .map(
          (reply) =>
            `<li><strong>${reply.author}</strong>: ${reply.content} <span class="muted">(${reply.likes} likes)</span></li>`
        )
        .join("");

      return `
      <section class="data-card">
        <h3>${thread.title}</h3>
        <p class="muted">${thread.category} | by ${thread.author} | ${thread.likes} likes</p>
        <ul class="text-list">${replies}</ul>
      </section>
      `;
    })
    .join("");
}

function renderMissions(data) {
  const missions = document.getElementById("mission-list");
  missions.innerHTML = data.missions
    .map(
      (mission) => `
      <section class="data-card">
        <h3>${mission.title}</h3>
        <p class="muted">${mission.type} | Risk: ${mission.risk} | Reward: ${mission.reward}</p>
        <p>${mission.text}</p>
        <p class="muted">Control-shift potential: ${mission.canShiftControl ? "Yes" : "No"}</p>
      </section>
    `
    )
    .join("");
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
  const messages = data.chatLog[channel] || [];
  const chatLog = document.getElementById("chat-log");

  chatLog.innerHTML = messages
    .slice(-40)
    .map(
      (msg) => `
      <li class="chat-msg">
        <div class="chat-meta">${msg.author} | ${formatTime(msg.createdAt)}</div>
        <div>${msg.content}</div>
      </li>
      `
    )
    .join("");
}

function updateAllViews() {
  const data = appState.data;
  if (!data || !appState.authenticated) {
    return;
  }

  updateCorpIdentity(data);
  updateOverview(data);
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
  renderFinanceCharts(data.corp.finances);
  renderFeedbackLog();
  starmap.setSystems(data.world.systems);
}

async function runLevel2Action(endpoint, payload = null) {
  if (!appState.accountId) {
    const status = document.getElementById("level2-status");
    if (status) {
      status.textContent = "Level progression actions require an authenticated account profile.";
    }
    return;
  }

  const response = await fetch(`/api/accounts/${encodeURIComponent(appState.accountId)}${endpoint}`, {
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
  const mineForm = document.getElementById("level2-mine-form");
  const mineAmount = document.getElementById("level2-mine-amount");
  const buildBtn = document.getElementById("level2-build-btn");
  const rndBtn = document.getElementById("level2-rnd-btn");
  const status = document.getElementById("level2-status");

  if (!hireForm || !hireCount || !mineForm || !mineAmount || !buildBtn || !rndBtn) {
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

  mineForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = Math.max(10, Number(mineAmount.value || 10));
    const throughputPerHour = Math.max(10, Math.min(250, amount));
    const operationCostPerHour = Math.max(600, Math.round(throughputPerHour * 16));
    const startupCost = Math.max(500, Math.round(operationCostPerHour * 0.35));
    try {
      const account = await runLevel2Action("/gameplay/mine", { amount });
      const cycle = account.state.corp.mining?.silicateExtractor;
      pushFeedback(
        `Silicate cycle authorized. Startup spend ${toCurrency(startupCost)}; throughput locked at ${throughputPerHour}/hour for 8 hours.`,
        "success"
      );
      if (status && cycle?.endsAt) {
        const remainingMinutes = Math.ceil(Math.max(0, Number(cycle.endsAt) - Date.now()) / (60 * 1000));
        status.textContent = `Silicate extraction cycle launched. Estimated completion in ${remainingMinutes} minute(s). Operating spend is ${toCurrency(operationCostPerHour)}/hour.`;
      }
    } catch (error) {
      if (status) {
        status.textContent = `Mining action failed: ${error.message}`;
      }
      pushFeedback(`Silicate cycle launch rejected. ${error.message}`, "error");
    }
  });

  buildBtn.addEventListener("click", async () => {
    try {
      await runLevel2Action("/gameplay/build-extractor");
      pushFeedback(
        `Basic Extractor Yard commissioned. ${toCurrency(65000)} capital deployed and your first persistent mining line is now available.`,
        "success"
      );
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

  rndBtn.addEventListener("click", async () => {
    try {
      await runLevel2Action("/gameplay/complete-rnd");
      pushFeedback(
        `Basic Extraction Analytics completed. ${toCurrency(40000)} deployed into immediate R&D, boosting raw extraction throughput.`,
        "success"
      );
      if (status) {
        status.textContent = "Basic Extraction Analytics completed. Extractor throughput is now improved.";
      }
    } catch (error) {
      if (status) {
        status.textContent = `R&D action failed: ${error.message}`;
      }
      pushFeedback(`Immediate R&D funding denied. ${error.message}`, "error");
    }
  });

  hireCount.addEventListener("input", () => renderActionHints(appState.data));
  mineAmount.addEventListener("input", () => renderActionHints(appState.data));
}

function setTab(targetId) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === targetId);
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === targetId);
  });
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
    const response = await fetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/walkthrough-complete`, {
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

  const response = await fetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/walkthrough-reset`, {
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
  authShell.hidden = false;
  gameShell.hidden = true;
}

function enterGame(mode, data, options = {}) {
  appState.profileMode = mode;
  appState.authenticated = true;
  appState.accountId = options.accountId || null;
  appState.walkthroughCompleted = Boolean(options.walkthroughCompleted);
  appState.data = deepClone(data);

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

  if (options.autoPromptWalkthrough !== false && (mode === "new" || mode === "account") && !appState.walkthroughCompleted) {
    promptWalkthroughOffer();
  }
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
  const response = await fetch("/api/bootstrap");
  if (!response.ok) {
    throw new Error("Failed to load bootstrap state.");
  }
  appState.serverData = await response.json();
  return appState.serverData;
}

async function loadAccountById(accountId) {
  const response = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`);
  return parseJsonResponse(response);
}

async function loginDummyAccount() {
  const response = await fetch("/api/auth/dummy-login", {
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
    const account = await loadAccountById(appState.accountId);
    appState.data = deepClone(account.state);
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
    const form = new FormData(investmentForm);
    const payload = {
      targetCorp: String(form.get("targetCorp")),
      instrument: String(form.get("instrument")),
      amount: Number(form.get("amount"))
    };

    const response = await fetch("/api/investments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return;
    }

    const result = await response.json();
    if (!appState.data.corp.investments) {
      appState.data.corp.investments = [];
    }

    appState.data.corp.investments.unshift(result.investment);
    const log = document.getElementById("investment-log");
    const line = document.createElement("li");
    line.textContent = `${payload.instrument} in ${payload.targetCorp} for ${toCurrency(payload.amount)} submitted.`;
    log.prepend(line);

    if (appState.profileMode === "new") {
      appState.data.corp.finances.credits -= payload.amount;
      appState.data.corp.finances.assets -= payload.amount;
    }

    await refreshFromServer();
    investmentForm.reset();
  });

  const listingForm = document.getElementById("listing-form");
  const listingItem = document.getElementById("listing-item");
  const listingQuantity = document.getElementById("listing-quantity");
  const listingStatus = document.getElementById("listing-status");

  listingItem.addEventListener("change", () => {
    const inventory = getInventory();
    const available = Math.max(1, Number(inventory[listingItem.value] || 1));
    listingQuantity.max = String(available);
    if (Number(listingQuantity.value) > available) {
      listingQuantity.value = String(available);
    }
  });

  listingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = new FormData(listingForm);
    const item = String(form.get("item"));
    const quantity = Number(form.get("quantity"));
    const unitPrice = Number(form.get("unitPrice"));

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

    inventory[item] = available - quantity;

    await fetch("/api/market/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "sell",
        item,
        quantity,
        unitPrice,
        actor: appState.data?.corp?.corporationName || "Unknown Corp"
      })
    });

    listingStatus.textContent = `Listing created: ${quantity} ${item} @ ${toCurrency(unitPrice)}.`;
    renderMarket(appState.data);
    await refreshFromServer();
    listingForm.reset();
  });

  const orderForm = document.getElementById("order-form");
  orderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(orderForm);
    const payload = {
      type: "buy",
      item: String(form.get("item")),
      quantity: Number(form.get("quantity")),
      unitPrice: Number(form.get("unitPrice")),
      actor: appState.data?.corp?.corporationName || "Unknown Corp"
    };

    await fetch("/api/market/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await refreshFromServer();
    orderForm.reset();
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
        const response = await fetch(`/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/queue-rnd`, {
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
        const liquidity = Number(appState.data.corp.finances.liquidity || 0);
        if (credits < node.costCredits || liquidity < node.costLiquidity) {
          throw new Error(
            `${node.name} requires ${toCurrency(node.costCredits)} credits and ${toCurrency(node.costLiquidity)} liquidity. Current reserves are ${toCurrency(credits)} credits and ${toCurrency(liquidity)} liquidity.`
          );
        }

        appState.data.corp.finances.credits -= node.costCredits;
        appState.data.corp.finances.liquidity -= node.costLiquidity;
        appState.data.queues.corporateRnD.push({
          id: `rnd-${Date.now()}`,
          techId: node.id,
          name: node.name,
          effect: node.effect,
          durationHours: node.durationHours,
          startedAt: Date.now(),
          costCredits: node.costCredits,
          costLiquidity: node.costLiquidity
        });
        updateAllViews();
      }

      if (rndStatus) {
        rndStatus.textContent = `${node.name} entered the queue. ${toCurrency(node.costCredits)} credits and ${toCurrency(node.costLiquidity)} liquidity committed.`;
      }
      pushFeedback(
        `${node.name} added to the corporate R&D queue. Funding locked: ${toCurrency(node.costCredits)} credits and ${toCurrency(node.costLiquidity)} liquidity.`,
        "success"
      );
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

    await fetch("/api/combat/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await refreshFromServer();
  });

  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatChannel = document.getElementById("chat-channel");

  chatChannel.addEventListener("change", () => {
    appState.chatChannel = chatChannel.value;
    renderChatLog(appState.data);
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const content = chatInput.value.trim();
    if (!content) {
      return;
    }

    socket?.emit("chat:send", {
      channel: appState.chatChannel,
      author: appState.data?.corp?.corporationName || "Anonymous",
      content
    });

    chatInput.value = "";
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
    loginDummyButton.addEventListener("click", async () => {
      if (!appState.serverData) {
        return;
      }

      const dummyProfile = createNewPlayerState(appState.serverData, "Test Director", "Protocol Sandbox Dynamics");
      if (loginPanel) {
        loginPanel.hidden = true;
      }
      await runIntroDialogue();
      enterGame("new", dummyProfile);
    });
  }

  if (!registerForm) {
    return;
  }

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(registerForm);
    const ceoName = String(formData.get("ceoName") || "New CEO").trim();
    const corpName = String(formData.get("corpName") || "Frontier Protocol Ventures").trim();

    if (!appState.serverData) {
      await loadBootstrap();
    }

    const freshProfile = createNewPlayerState(appState.serverData, ceoName, corpName);
    if (registerPanel) {
      registerPanel.hidden = true;
    }
    await runIntroDialogue();
    enterGame("new", freshProfile);
  });
}

function bindGlobalControls() {
  refreshButton.addEventListener("click", () => {
    refreshFromServer();
  });

  textModeToggle.addEventListener("click", () => {
    appState.textOnly = !appState.textOnly;
    textModeToggle.setAttribute("aria-pressed", String(appState.textOnly));
    textModeToggle.textContent = `Text-only fallback: ${appState.textOnly ? "On" : "Off"}`;
    starmap.setGraphicsMode(!appState.textOnly);
  });

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
  showAuthScreen();
  bindTabs();
  bindAuthControls();
  bindForms();
  bindLevel2Controls();
  bindRealtimeEvents();
  bindGlobalControls();

  try {
    await loadBootstrap();

    const url = new URL(window.location.href);
    const accountId = url.searchParams.get("account");
    const shouldDummyLogin = url.searchParams.get("dummy") === "1";

    if (accountId) {
      const account = await loadAccountById(accountId);
      url.searchParams.delete("account");
      const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", cleanUrl || "/");

      enterGame("account", account.state, {
        accountId: account.id,
        walkthroughCompleted: account.walkthroughCompleted,
        autoPromptWalkthrough: false
      });

      if (!account.walkthroughCompleted) {
        await runIntroDialogue();
        promptWalkthroughOffer();
      }
      return;
    }

    if (shouldDummyLogin) {
      const account = await loginDummyAccount();
      url.searchParams.delete("dummy");
      const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", cleanUrl || "/");

      enterGame("account", account.state, {
        accountId: account.id,
        walkthroughCompleted: account.walkthroughCompleted,
        autoPromptWalkthrough: false
      });

      if (!account.walkthroughCompleted) {
        await runIntroDialogue();
        promptWalkthroughOffer();
      }
    }
  } catch (error) {
    authShell.innerHTML = `<article class="auth-card"><p class="alert">Bootstrap failed: ${error.message}</p></article>`;
  }
}

window.addEventListener("DOMContentLoaded", boot);
