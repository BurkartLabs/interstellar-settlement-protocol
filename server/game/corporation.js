// server/game/corporation.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { MAX_DEFINED_LEVEL, createId, deepClone } from "./catalog.js";
import { evaluateLevelProgress } from "./progression.js";
import { ensureCorpMiningModel } from "./mining.js";
import { ensureCorpRefineryModel } from "./refining.js";

/* TODO(AB#726): Should this all be hardcoded? Or should some of it be based upon completed research, etc? */
export function createStarterCorporationState(baseState, ceoName, corpName) {
  const next = deepClone(baseState);

  next.corp = {
    ...next.corp,
    // Bug #711: how other players address this corporation. Opaque and random, never the account id, because names
    // are not unique and mail was routed by name.
    publicId: createId("corp"),
    ceo: ceoName,
    corporationName: corpName,
    location: "Earth",
    currentStationId: "earth-station-prime",
    currentSystemId: "sol",
    travel: null,
    level: 0,
    levelCap: MAX_DEFINED_LEVEL,
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
      bondYieldPct: 0,
      exchangeSalesTaxPct: 8,
      lifetimeRevenue: 0,
      lifetimeCosts: 0,
      incomeBySource: {},
      expensesByCategory: {},
      snapshots: []
    },
    inventory: {},
    mining: {
      silicateExtractors: [],
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
      marketSectors: [],
      maxUpgradeTier: 1,
      maxFleetSize: 0
    },
    investments: [],
    unlockedTech: [],
    completedInsights: [],
    offices: [],
    miningLeases: [],
    tradeHistory: []
  };

  next.queues = {
    corporateRnD: [],
    ceoInsight: []
  };

  next.playerProfile = {
    isNewPlayer: true,
    registeredAt: Date.now(),
    walkthroughCompleted: false
  };

  evaluateLevelProgress(next);
  ensureCorpMiningModel(next.corp);
  ensureCorpRefineryModel(next.corp);
  return next;
}

// ─── Mission Template Pool ─────────────────────────────────────────────────
export const CONTRACT_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours
export const CONTRACTS_PER_AGENT = 2;
export const COMPLETED_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h before a completed mission can reappear
// AB#579: the walkthrough closes with Elara Voss promising a new corporation this contract, so a corporation that has
// never accepted or completed one is always offered it. public/scripts/walkthrough.js names it (handoffContractId).
export const FIRST_CONTRACT_ID = "ms-log-001";

/*
  TODO(AB#1051): This shouldn't be hardcoded in this way. The values should be more random. 
*/
export const MISSION_TEMPLATES = [
  {
    id: "ms-log-001",
    title: "Silicate Requisition Order — Batch 4-7A",
    type: "Logistics",
    risk: "Low",
    reward: "12,000 Credits",
    text: "The Bureau requires 400 units of raw silicates for redistribution to ISA-contracted construction projects. Mine the quota from any active extraction lease and deliver it to the Bureau when you have it.",
    agentId: "elara-voss",
    quota: { resource: "Silicates", amount: 400 }
  },
  {
    id: "ms-log-002",
    title: "Nickel Freight Manifest — Consignment 9-2B",
    type: "Logistics",
    risk: "Low",
    reward: "15,000 Credits",
    text: "The Bureau has flagged a shortfall of nickel across ISA-administered construction depots. Deliver 300 units of nickel to fulfil this standing requisition order.",
    agentId: "elara-voss",
    quota: { resource: "Nickel", amount: 300 }
  },
  {
    id: "ms-log-003",
    title: "Carbon Fibre Supply Run — Priority C",
    type: "Logistics",
    risk: "Low",
    reward: "10,000 Credits",
    text: "Station maintenance divisions require a resupply of carbon for composite fabrication. Source and deliver 500 units to the contracting office.",
    agentId: "elara-voss",
    quota: { resource: "Carbon", amount: 500 }
  },
  {
    id: "ms-log-004",
    title: "Helium-3 Emergency Allocation — Directive 77",
    type: "Logistics",
    risk: "Medium",
    reward: "24,000 Credits",
    text: "Reactor fuel reserves are approaching critical minimums. The ISA has issued a priority directive: deliver 200 units of Helium-3 to the Bureau for immediate redistribution to power infrastructure.",
    agentId: "elara-voss",
    quota: { resource: "Helium-3", amount: 200 }
  },
  {
    id: "ms-log-005",
    title: "Titanium Structural Allotment — Frame Series 12",
    type: "Logistics",
    risk: "Medium",
    reward: "20,000 Credits",
    text: "Station expansion projects require titanium for structural framework assembly. Deliver 250 units to satisfy this standing allotment.",
    agentId: "elara-voss",
    quota: { resource: "Titanium", amount: 250 }
  },
  {
    id: "ms-log-006",
    title: "Water Ice Procurement — Habitat Sustainment",
    type: "Logistics",
    risk: "Low",
    reward: "8,000 Credits",
    text: "Life-support divisions have requisitioned 600 units of water ice for processing into potable reserves. Standard sustainment contract — deliver to the Bureau at your earliest.",
    agentId: "elara-voss",
    quota: { resource: "Water Ice", amount: 600 }
  },
  {
    id: "ms-log-007",
    title: "Rare Earths Acquisition — R&D Allocation",
    type: "Logistics",
    risk: "High",
    reward: "35,000 Credits",
    text: "The ISA's applied sciences division has requested rare earth elements for experimental fabrication. Deliver 150 units. Extraction difficulty is noted — compensation reflects the challenge.",
    agentId: "elara-voss",
    quota: { resource: "Rare Earths", amount: 150 }
  },
  {
    id: "ms-log-008",
    title: "Lithium Cell Stockpile — Battery Reserve",
    type: "Logistics",
    risk: "Medium",
    reward: "22,000 Credits",
    text: "Energy storage facilities need lithium for next-generation battery cell production. Source and deliver 200 units to the contracting office to fulfil this standing order.",
    agentId: "elara-voss",
    quota: { resource: "Lithium", amount: 200 }
  },
  {
    id: "ms-log-009",
    title: "Cobalt Shipment — Alloy Programme",
    type: "Logistics",
    risk: "Medium",
    reward: "18,000 Credits",
    text: "The metallurgy division requires cobalt for high-temperature alloy production. Deliver 250 units to satisfy the current programme quota.",
    agentId: "elara-voss",
    quota: { resource: "Cobalt", amount: 250 }
  },
  {
    id: "ms-log-010",
    title: "Thorium Fuel Rods — Reactor Consignment",
    type: "Logistics",
    risk: "High",
    reward: "30,000 Credits",
    text: "Next-generation reactor trials require thorium. The ISA has authorised a premium-rate contract for 100 units delivered to the Bureau. Handle with appropriate caution.",
    agentId: "elara-voss",
    quota: { resource: "Thorium", amount: 100 }
  }
];

/**
 * Refresh contract offerings for an account if the timer has expired.
 * Returns the current offerings array (mutates state in-place).
 */
export function refreshContractOfferings(corpState) {
  if (!corpState.contractOfferings) corpState.contractOfferings = { missions: [], nextRefreshAt: 0 };
  const offerings = corpState.contractOfferings;
  const now = Date.now();

  // Only regenerate when the timer has actually expired
  if (offerings.nextRefreshAt > 0 && now < offerings.nextRefreshAt) {
    return offerings;
  }

  // Gather IDs that are on cooldown (recently completed)
  const completedMissions = corpState.completedMissions || [];
  const cooldownIds = new Set();
  for (const m of completedMissions) {
    if (m.completedAt && (now - m.completedAt) < COMPLETED_COOLDOWN_MS) {
      cooldownIds.add(m.id);
    }
  }

  // Gather IDs that are currently active
  const activeIds = new Set((corpState.activeMissions || []).map(m => m.id));

  // Filter eligible templates
  const eligible = MISSION_TEMPLATES.filter(t => !cooldownIds.has(t.id) && !activeIds.has(t.id));

  // Shuffle and pick; a corporation's first offering always includes the contract the walkthrough promised it.
  const shuffled = eligible.slice().sort(() => Math.random() - 0.5);
  const neverContracted = !completedMissions.length && !activeIds.size;
  const promised = neverContracted ? shuffled.find((t) => t.id === FIRST_CONTRACT_ID) : null;
  const picked = promised ? [promised, ...shuffled.filter((t) => t !== promised)] : shuffled;
  offerings.missions = picked.slice(0, CONTRACTS_PER_AGENT).map(t => ({ ...t }));
  offerings.nextRefreshAt = now + CONTRACT_REFRESH_MS;

  return offerings;
}

