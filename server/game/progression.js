// server/game/progression.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { ECONOMY } from "../economy.js";
import { BASE_MAX_PROBES, CEO_INSIGHT_LIBRARY, FLEET_COORDINATION_BONUS, FLEET_COORDINATION_TECH, MAX_DEFINED_LEVEL, MILESTONE_LEVELS, REQ_ID_TO_TITLE, createId } from "./catalog.js";

// ─── Exchange sales tax ──────────────────────────────────────────────────────
// The base rate is in data/economy.json (AB#726); CEO insights lower it from there.
export const BASE_EXCHANGE_SALES_TAX_PCT = ECONOMY.exchange.salesTaxPct;

export function getEffectiveExchangeTaxRate(state) {
  let taxPct = BASE_EXCHANGE_SALES_TAX_PCT;

  // CEO Insight: Negotiation Fundamentals reduces tax by 2% per completion (max 3 completions = 6%)
  // BRIEF.md, Monetization (Board decision AB#980, 2026-09-21): "Research and Insight should never be sellable."
  // This program, and every level or wait inside it, may never be bought or sped up with real money - only ever
  // earned with in-game credits and time, the way every other player already earns their own discount.
  const completedInsights = state.corp.completedInsights || [];
  const negLevels = completedInsights.filter((id) => id === "ceo-negotiation-fundamentals").length;
  if (negLevels > 0) {
    const prog = CEO_INSIGHT_LIBRARY["ceo-negotiation-fundamentals"];
    const maxLevels = prog?.maxLevels || 3;
    const effectiveLevels = Math.min(negLevels, maxLevels);
    taxPct -= effectiveLevels * 2; // 2% per level
  }

  return Math.max(0, taxPct);
}

// ─── What the level ladder may name (Bug #424) ────────────────────────────────
// Levels 6 to 10 named statistics no code kept and buildings no one could build, so nobody passed Level 5. The
// schema test (tests/schema/data-files.test.js) fails when a milestone names anything outside these lists.
/** Statistics the resolver works out from other state. */
export const DERIVED_STATS = ["officeRented", "miningLeasesCount", "missionsCompleted"];
/** Statistics kept as counters in corp.stats, through bumpStat. */
export const COUNTED_STATS = ["silicateSoldOnExchange", "refinedUnitsProduced", "asteroidExpeditionsCompleted"];
export const STAT_KEYS = Object.freeze([...DERIVED_STATS, ...COUNTED_STATS]);
/** Buildings a player can build (the construction routes in server/index.js; a test checks the two agree). */
export const PLAYER_BUILDINGS = Object.freeze(["Basic Extractor Yard", "Assembly Facility", "Refinery"]);

/** Add `n` to a counted statistic. Refuses a key nothing reads, so a typo cannot quietly start a new counter. */
export function bumpStat(corp, key, n = 1) {
  if (!COUNTED_STATS.includes(key)) throw new Error(`Unknown statistic "${key}": add it to COUNTED_STATS first.`);
  if (!corp.stats || typeof corp.stats !== "object") corp.stats = {};
  corp.stats[key] = (Number(corp.stats[key]) || 0) + (Number(n) || 0);
}

// ─── Metric resolver: maps milestones.json metric strings to live corp values ─
export function resolveMetric(metric, corp) {
  const stats = corp.stats || {};
  const buildings = corp.buildings || [];
  const unlockedTech = corp.unlockedTech || [];
  const miningLeases = corp.miningLeases || [];

  // stat:<key> — check corp flags first, then corp.stats
  if (metric.startsWith("stat:")) {
    const key = metric.slice(5);
    if (key === "officeRented") return (Array.isArray(corp.offices) && corp.offices.length > 0) ? 1 : 0;
    if (key === "miningLeasesCount") return miningLeases.length;
    // Bug #424: counted from the missions already recorded (kept to the last 200), so old saves get credit too.
    if (key === "missionsCompleted") return Array.isArray(corp.completedMissions) ? corp.completedMissions.length : 0;
    return Number(stats[key] || 0);
  }

  // employeeCount
  if (metric === "employeeCount") return Number(corp.employeeCount || 0);

  // miningLease:<body> — check body field, fall back to type field. "any" (Bug #1753) is a lease on any body:
  // the milestone is testing for a working lease, not a specific planet, and pinning it to one instance (Mars)
  // let a cost-minimising player (and both ops/probes/isp-runway.ts bots) lease the cheaper Earth instead and
  // be stuck permanently with no error explaining why.
  if (metric.startsWith("miningLease:")) {
    const target = metric.slice(12);
    if (target === "any") return miningLeases.length > 0 ? 1 : 0;
    return miningLeases.some((l) => (l.body || l.type || l) === target) ? 1 : 0;
  }

  // building:<name> — boolean: has at least one
  if (metric.startsWith("building:")) {
    const name = metric.slice(9);
    return buildings.some((b) => b.name === name) ? 1 : 0;
  }

  // building-count:<name> — count of matching buildings
  if (metric.startsWith("building-count:")) {
    const name = metric.slice(15);
    return buildings.filter((b) => b.name === name).length;
  }

  // totalMined:<resource>
  if (metric.startsWith("totalMined:")) {
    if (metric === "totalMined:silicate") {
      return (corp?.mining?.silicateExtractors || [])
        .reduce((sum, ex) => sum + Number(ex?.totalMined || 0), 0);
    }
    return 0;
  }

  // unlockedTech:<techId>
  if (metric.startsWith("unlockedTech:")) {
    const techId = metric.slice(13);
    return unlockedTech.includes(techId) ? 1 : 0;
  }

  return 0;
}

// Bug #586: the Fleet Cap the sidebar shows is the cap fabrication enforces. It is the maxFleetSize
// granted by levels reached (never below the pre-Level-1 floor), plus Fleet Coordination Matrix.
// Every vessel counts: in the hangar, in fabrication, or out on an expedition.
export function fleetStatus(corp) {
  const am = corp?.asteroidMining || {};
  const granted = Math.max(BASE_MAX_PROBES, Number(corp?.unlocks?.maxFleetSize || 0));
  const coordinated = (corp?.unlockedTech || []).includes(FLEET_COORDINATION_TECH);
  const bonus = coordinated ? FLEET_COORDINATION_BONUS : 0;
  const cap = granted + bonus;
  const vessels = Number(am.probeCount || 0) + (am.fabricationQueue || []).length + (am.activeExpeditions || []).length;
  const raises = [];
  const nextLevel = [...MILESTONE_LEVELS]
    .sort((a, b) => a.level - b.level)
    .find((l) => l.level > Number(corp?.level || 0) && Number(l.unlocks?.maxFleetSize || 0) > granted);
  if (nextLevel) raises.push({ kind: "level", level: nextLevel.level, cap: nextLevel.unlocks.maxFleetSize + bonus });
  if (!coordinated) raises.push({ kind: "research", techId: FLEET_COORDINATION_TECH, name: "Fleet Coordination Matrix", bonus: FLEET_COORDINATION_BONUS });
  return { cap, vessels, full: vessels >= cap, raises, raiseText: fleetRaiseText(raises) };
}

// What raises the Fleet Cap next, in words; empty when nothing in this build does.
export function fleetRaiseText(raises) {
  const parts = raises.map((r) => r.kind === "level"
    ? `Reaching Corporation Level ${r.level} raises it to ${r.cap}`
    : `${r.name} research adds ${r.bonus}`);
  return parts.length ? `${parts.join("; ")}.` : "This is the highest Fleet Cap in this build.";
}

export function evaluateLevelProgress(profileState) {
  const corp = profileState.corp;
  corp.levelCap = MAX_DEFINED_LEVEL; // Bug #424: saves carried a literal 40

  // Build levelProgress from milestones.json definitions
  corp.levelProgress = {};
  const allRequirements = [];

  for (const levelDef of MILESTONE_LEVELS) {
    const lvlNum = levelDef.level;
    const reqs = levelDef.requirements.map((r) => {
      const progress = resolveMetric(r.metric, corp);
      return {
        id: r.id,
        title: r.title,
        metric: r.metric, // AB#1061: the card reads the body a lease milestone names from here
        progress,
        target: r.target,
        complete: Number(progress || 0) >= Number(r.target || 0)
      };
    });
    corp.levelProgress[`level${lvlNum}`] = {
      requirements: reqs,
      allCompleted: reqs.every((r) => r.complete)
    };
    allRequirements.push(...reqs);
  }

  // Track completed milestones by display title
  allRequirements.forEach((req) => {
    const milestoneName = REQ_ID_TO_TITLE[req.id] || req.title;
    if (req.complete && !corp.milestonesCompleted.includes(milestoneName)) {
      corp.milestonesCompleted.push(milestoneName);
    }
  });

  // Climb one level at a time: level N is granted only from level N-1, so a later level met
  // first waits for the one below it instead of skipping it (AB#690).
  const ordered = [...MILESTONE_LEVELS].sort((a, b) => a.level - b.level);
  for (const levelDef of ordered) {
    const lvlNum = levelDef.level;
    if (lvlNum <= corp.level) continue;
    if (lvlNum !== corp.level + 1 || !corp.levelProgress[`level${lvlNum}`].allCompleted) break;
    corp.level = lvlNum;
  }

  // Every level at or below the current one holds its tag and unlocks. Idempotent, so it also
  // repairs corporations the old loop promoted past a level without granting it (AB#690).
  for (const levelDef of ordered) {
    if (levelDef.level > corp.level) break;
    const tag = `Reached Corporation Level ${levelDef.level}`;
    if (!corp.milestonesCompleted.includes(tag)) {
      corp.milestonesCompleted.push(tag);
    }
    const u = levelDef.unlocks;
    if (u.employeeCap) corp.employeeCap = Math.max(corp.employeeCap, u.employeeCap);
    if (u.buildingSlots) corp.buildingSlots = Math.max(corp.buildingSlots, u.buildingSlots);
    if (u.maxFleetSize) corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, u.maxFleetSize);
    if (Array.isArray(u.marketSectors)) {
      for (const sector of u.marketSectors) {
        if (!corp.unlocks.marketSectors.includes(sector)) {
          corp.unlocks.marketSectors.push(sector);
        }
      }
    }
  }

  corp.fleet = fleetStatus(corp); // Bug #586: derived every evaluation, like levelProgress
}

// Bug #1260: reaching a level told the player nothing. evaluateLevelProgress is a pure state function; the account
// paths below wrap it, compare the level before and after, and tell the player once per level reached, in order. A
// level already held (reached before this fix, or earlier) is never announced again, and a level cannot go down.
export let accountNotificationListener = null;

/** index.js sends each notification made here to the account's own sockets, as notifications:new. */
export function onAccountNotification(listener) {
  accountNotificationListener = listener;
}

/**
 * The notices for the levels `corp` reached since `before`. The figures are the ones the sidebar shows once each level
 * is granted, built by the same rules as evaluateLevelProgress and fleetStatus: each cap is the highest of what the
 * corporation had and what every level up to this one grants, and the fleet cap includes Fleet Coordination.
 */
export function levelReachedNotices(before, corp) {
  const coordinated = (corp?.unlockedTech || []).includes(FLEET_COORDINATION_TECH);
  let employeeCap = Number(before.employeeCap || 0);
  let buildingSlots = Number(before.buildingSlots || 0);
  let maxFleetSize = Number(before.maxFleetSize || 0);
  const sectors = new Set(before.marketSectors || []);
  const notices = [];
  for (const levelDef of [...MILESTONE_LEVELS].sort((a, b) => a.level - b.level)) {
    if (levelDef.level > Number(corp.level || 0)) break;
    const u = levelDef.unlocks || {};
    employeeCap = Math.max(employeeCap, Number(u.employeeCap || 0));
    buildingSlots = Math.max(buildingSlots, Number(u.buildingSlots || 0));
    maxFleetSize = Math.max(maxFleetSize, Number(u.maxFleetSize || 0));
    const opened = (Array.isArray(u.marketSectors) ? u.marketSectors : []).filter((sector) => !sectors.has(sector));
    opened.forEach((sector) => sectors.add(sector));
    if (levelDef.level <= Number(before.level || 0)) continue;
    const fleetCap = Math.max(BASE_MAX_PROBES, maxFleetSize) + (coordinated ? FLEET_COORDINATION_BONUS : 0);
    notices.push({
      type: "level",
      title: `Corporation Level ${levelDef.level}`,
      body:
        `Your corporation reached Level ${levelDef.level} of ${MAX_DEFINED_LEVEL}. ` +
        `Employee cap ${employeeCap}, building slots ${buildingSlots}, fleet cap ${fleetCap}.` +
        (opened.length ? ` Market sector${opened.length > 1 ? "s" : ""} opened: ${opened.join(", ")}.` : "")
    });
  }
  return notices;
}

/** Evaluate an account's level and tell it about each level it has just reached. */
export function evaluateAccountLevel(accountId, account) {
  const corp = account.state.corp;
  const before = {
    level: Number(corp.level || 0),
    employeeCap: corp.employeeCap,
    buildingSlots: corp.buildingSlots,
    maxFleetSize: corp.unlocks?.maxFleetSize,
    marketSectors: [...(corp.unlocks?.marketSectors || [])]
  };
  evaluateLevelProgress(account.state);
  if (!(Number(corp.level || 0) > before.level)) return;
  for (const notice of levelReachedNotices(before, corp)) {
    pushSystemNotification(account, notice);
    if (accountNotificationListener) accountNotificationListener(accountId, sanitizeNotification(account.notifications[0]));
  }
}

export function sanitizeNotification(notification) {
  return {
    id: notification.id,
    accountId: notification.accountId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    createdAt: notification.createdAt,
    readAt: notification.readAt || null
  };
}

export function pushSystemNotification(account, payload) {
  if (!account.notifications) {
    account.notifications = [];
  }

  account.notifications.unshift({
    id: createId("ntf"),
    accountId: account.id,
    type: payload.type || "system",
    title: payload.title || "Notification",
    body: payload.body || "",
    createdAt: Date.now(),
    readAt: null
  });

  account.notifications = account.notifications.slice(0, 120);
}

