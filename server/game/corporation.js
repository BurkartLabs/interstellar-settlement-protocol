// server/game/corporation.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { MAX_DEFINED_LEVEL, MISSIONS_DATA, createId, deepClone } from "./catalog.js";
import { evaluateLevelProgress } from "./progression.js";
import { ensureCorpMiningModel } from "./mining.js";
import { ensureCorpRefineryModel } from "./refining.js";
import { ECONOMY } from "../economy.js";
import { ensureBuildingIds } from "./buildingIds.js";
import { ensureCorpMilitary } from "./units.js";

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
    // AB#861: units by the catalog's ids (data/units.json); power is worked out from them by ensureCorpMilitary
    military: {
      units: { lf: 0, ds: 0, se: 0, at: 0, dt: 0 },
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
  ensureBuildingIds(next.corp); // AB#792: Headquarters has an id from the start
  ensureCorpMilitary(next.corp); // AB#861: the unit catalog's shape, with its power
  return next;
}

// ─── Mission Template Pool ─────────────────────────────────────────────────
export const CONTRACT_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours
export const CONTRACTS_PER_AGENT = 2;
export const COMPLETED_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h before a completed mission can reappear
// AB#579: the walkthrough closes with Elara Voss promising a new corporation this contract, so a corporation that has
// never accepted or completed one is always offered it. public/scripts/walkthrough.js names it (handoffContractId).
export const FIRST_CONTRACT_ID = "ms-log-001";

// AB#1051: the pool itself, its agent registry and its reputation tiers all live in data/missions.json now —
// see MISSION_AGENTS_DATA and REPUTATION_TIERS_DATA below, and GET /api/mission-agents (server/index.js), which
// is how the client gets its own copy instead of keeping a second one (the CEO Insight pattern, Bug #983).
// A template carries a *range* (quotaMin/quotaMax, rewardMin/rewardMax), not a fixed value; materializeOffer
// below rolls one instance of it per refresh, so the same template reads differently contract to contract.
export const MISSION_TEMPLATES = MISSIONS_DATA.templates;
export const MISSION_AGENTS_DATA = MISSIONS_DATA.agents;
export const REPUTATION_TIERS_DATA = MISSIONS_DATA.reputationTiers;

/** A whole multiple of `step` in [min, max], min when the range is empty or inverted. */
function randomInRange(min, max, step) {
  if (!(max > min)) return min;
  const steps = Math.max(0, Math.floor((max - min) / step));
  return min + Math.floor(Math.random() * (steps + 1)) * step;
}

/**
 * One instance of a template, offered now: a quota amount and a reward rolled within the template's own bounds
 * (AB#1051). The offered mission keeps the exact shape every existing reader (the client, accept-mission,
 * complete-mission, missionRewardCredits) already expects — reward as a formatted string, quota as
 * { resource, amount } — so nothing downstream of an offer needs to know templates changed shape.
 */
export function materializeOffer(template) {
  const amount = randomInRange(template.quotaMin, template.quotaMax, 10);
  const rewardCredits = randomInRange(template.rewardMin, template.rewardMax, 100);
  return {
    id: template.id,
    title: template.title,
    type: template.type,
    risk: template.risk,
    text: template.text,
    agentId: template.agentId,
    quota: { resource: template.resource, amount },
    reward: `${rewardCredits.toLocaleString("en-US")} Credits`
  };
}

// ─── Salvage Assignment (ISP-297, AB#1789, AB#1741) ────────────────────────
// ECONOMY.md "The way back from broke": a corporation with 0 credits and no ore has no move that changes
// anything (start-mining needs startup credits it does not have). This is the way out: a Bureau contract paid
// in time served, not delivered resources, offered only while it is actually needed. Every number lives in
// ECONOMY.salvage, not here, and none of them is a lever a player can turn (T-018) — accepting, waiting and
// completing are the only three actions, and none of them changes what it pays or how fast.
export const SALVAGE_ASSIGNMENT_ID = "ms-salvage-001";

/** The Salvage Assignment offer: not materializeOffer's random range, a fixed shape built from ECONOMY.salvage. */
export function salvageAssignmentOffer() {
  return {
    id: SALVAGE_ASSIGNMENT_ID,
    title: "ISA Salvage Assignment",
    type: "Salvage",
    risk: "None",
    text: "The Bureau extends emergency salvage work to a corporation with no active operation and nothing left "
      + "to sell: report for documented recovery work at any ISA facility, and the Bureau pays for your time, "
      + "not a delivered quota.",
    agentId: "elara-voss",
    kind: "time-served",
    hoursRequired: ECONOMY.salvage.hoursRequired,
    reward: `${ECONOMY.salvage.payoutCredits.toLocaleString("en-US")} Credits`
  };
}

/** Whether corpState should be offered a fresh Salvage Assignment right now (recomputed on every call, not cached). */
export function salvageEligible(corpState, now = Date.now()) {
  const credits = Number(corpState?.finances?.credits || 0);
  if (credits >= ECONOMY.salvage.creditsThreshold) return false;
  const hasActiveCycle = (corpState?.mining?.silicateExtractors || []).some((e) => e?.active);
  if (hasActiveCycle) return false;
  if ((corpState.activeMissions || []).some((m) => m.id === SALVAGE_ASSIGNMENT_ID)) return false;
  const lastCompleted = (corpState.completedMissions || []).find((m) => m.id === SALVAGE_ASSIGNMENT_ID);
  if (lastCompleted && now - Number(lastCompleted.completedAt || 0) < ECONOMY.salvage.cooldownHours * 3_600_000) return false;
  return true;
}

/**
 * Refresh contract offerings for an account if the timer has expired.
 * Returns the current offerings array (mutates state in-place).
 */
export function refreshContractOfferings(corpState) {
  if (!corpState.contractOfferings) corpState.contractOfferings = { missions: [], nextRefreshAt: 0 };
  const offerings = corpState.contractOfferings;
  const now = Date.now();

  // Only regenerate the random pool when the timer has actually expired
  if (!(offerings.nextRefreshAt > 0 && now < offerings.nextRefreshAt)) {
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
    offerings.missions = picked.slice(0, CONTRACTS_PER_AGENT).map(materializeOffer);
    offerings.nextRefreshAt = now + CONTRACT_REFRESH_MS;
  }

  // The Salvage Assignment is not part of the random rotation above: it is evaluated fresh on every call, so a
  // corporation crossing the credits threshold (either way) sees it appear or disappear immediately, not on the
  // next 2-hour refresh.
  offerings.missions = offerings.missions.filter((m) => m.id !== SALVAGE_ASSIGNMENT_ID);
  if (salvageEligible(corpState, now)) {
    offerings.missions = [salvageAssignmentOffer(), ...offerings.missions];
  }

  return offerings;
}

