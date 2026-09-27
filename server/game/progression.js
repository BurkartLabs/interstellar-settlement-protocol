// server/game/progression.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { ECONOMY } from "../economy.js";
import { PLAYER_BUILDING_CATALOGUE } from "../playerBuildings.js";
import { taxBreakdown } from "../../public/scripts/exchangeTax.js";
import { SHIP_UNIT_IDS } from "./units.js"; // ISP-171 (AB#865): ships share the Fleet Cap with probes
import { BASE_MAX_DEPLOYMENTS, BASE_MAX_PROBES, CEO_INSIGHT_LIBRARY, FLEET_COORDINATION_BONUS, FLEET_COORDINATION_TECH, LEVEL_UNLOCK_KEYS, MAX_DEFINED_LEVEL, MILESTONE_LEVELS, MINEABLE_RESOURCES, REFINED_ITEMS, REQ_ID_TO_TITLE, createId } from "./catalog.js";

// ─── Exchange sales tax ──────────────────────────────────────────────────────
// The base rate is in data/economy.json (AB#726); the ISA lease royalty adds to it by leases held (ISP-302, AB#2285);
// CEO insights lower it from there. The arithmetic is public/scripts/exchangeTax.js, shared with the Exchange page.
export const BASE_EXCHANGE_SALES_TAX_PCT = ECONOMY.exchange.salesTaxPct;

/** The rate and its parts for this corporation: base, royalty for its leases, discount, and the lines they make. */
export function exchangeTaxBreakdown(state, basePct = BASE_EXCHANGE_SALES_TAX_PCT) { // ISP-239 (AB#934): a lobbied system's base
  // CEO Insight: Negotiation Fundamentals reduces tax by 2% per completion (max 3 completions = 6%)
  // BRIEF.md, Monetization (Board decision AB#980, 2026-09-21): "Research and Insight should never be sellable."
  // This program, and every level or wait inside it, may never be bought or sped up with real money - only ever
  // earned with in-game credits and time, the way every other player already earns their own discount.
  const completedInsights = state.corp.completedInsights || [];
  const negLevels = completedInsights.filter((id) => id === "ceo-negotiation-fundamentals").length;
  const maxLevels = CEO_INSIGHT_LIBRARY["ceo-negotiation-fundamentals"]?.maxLevels || 3;
  return taxBreakdown({
    basePct,
    discountPoints: Math.min(negLevels, maxLevels) * 2, // 2% per level
    leasesHeld: (state.corp.miningLeases || []).length,
    royaltyPointsByLeasesHeld: ECONOMY.leases.royaltyPointsByLeasesHeld
  });
}

export function getEffectiveExchangeTaxRate(state) {
  return exchangeTaxBreakdown(state).ratePct;
}

/**
 * Keep the corporation's stored rate and its breakdown current (ISP-302, AB#2285). The Exchange page reads them from
 * finances, which the finance:updated event replaces whole, so they are stored rather than worked out on the page; and
 * with the royalty the rate moves with leases held, so it is refreshed after every change, not only an insight's.
 */
export function refreshExchangeTax(state) {
  if (!state?.corp?.finances) return;
  const breakdown = exchangeTaxBreakdown(state);
  state.corp.finances.exchangeSalesTaxPct = breakdown.ratePct;
  state.corp.finances.exchangeTaxBreakdown = breakdown;
}

// ─── What the level ladder may name (Bug #424) ────────────────────────────────
// Levels 6 to 10 named statistics no code kept and buildings no one could build, so nobody passed Level 5. The
// schema test (tests/schema/data-files.test.js) fails when a milestone names anything outside these lists.
/** Statistics the resolver works out from other state. */
export const DERIVED_STATS = ["officeRented", "miningLeasesCount", "missionsCompleted"];
/** Statistics kept as counters in corp.stats, through bumpStat. */
export const COUNTED_STATS = Object.freeze([
  "silicateSoldOnExchange", "refinedUnitsProduced", "asteroidExpeditionsCompleted",
  // ISP-106 (AB#798): every contract ever completed. completedMissions keeps only the last 200, so a level past that
  // (docs/design/ladder-11-40.md) could never be met from it; stat:missionsCompleted reads the larger of the two.
  "missionsCompletedTotal",
  // ISP-106 (AB#798): what returning expeditions deposit, per resource, for totalMined:<resource>.
  ...MINEABLE_RESOURCES.map((r) => `mined:${r}`),
  // AB#831: what refinery runs have delivered, per product, so a level can name a product (stat:manufactured:<item>),
  // as docs/design/ladder-11-40.md plans for v0.8. The ladder names none yet; that is the PM's call.
  ...REFINED_ITEMS.map((item) => `manufactured:${item}`)
]);
export const STAT_KEYS = Object.freeze([...DERIVED_STATS, ...COUNTED_STATS]);
/** Buildings a player can build: the names in data/player-buildings.json (AB#783). A test checks the construction
 * routes add exactly these. */
export const PLAYER_BUILDINGS = Object.freeze(PLAYER_BUILDING_CATALOGUE.map((b) => b.name));

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
    if (key === "missionsCompleted") {
      // AB#798: the running total, or the recorded window for a save from before it was kept.
      return Math.max(Array.isArray(corp.completedMissions) ? corp.completedMissions.length : 0, Number(stats.missionsCompletedTotal) || 0);
    }
    if (!STAT_KEYS.includes(key)) return unknownMetric(metric);
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
    // ISP-97 (AB#787): an upgrade (the Refinery Complex) is recorded on the building it upgraded, which keeps its name.
    return buildings.some((b) => b.name === name || (Array.isArray(b.upgrades) && b.upgrades.includes(name))) ? 1 : 0;
  }

  // building-tier:<id>:<n> (ISP-106, AB#798) — how many of that catalogue building are at tier n or above.
  if (metric.startsWith("building-tier:")) {
    const [, id, n] = metric.split(":");
    const entry = PLAYER_BUILDING_CATALOGUE.find((b) => b.id === id);
    const tier = Number(n);
    if (!entry || !Number.isInteger(tier) || tier < 1) return unknownMetric(metric);
    return buildings.filter((b) => b.name === entry.name && (Number(b.tier) || 1) >= tier).length;
  }

  // building-count:<name> — count of matching buildings
  if (metric.startsWith("building-count:")) {
    const name = metric.slice(15);
    return buildings.filter((b) => b.name === name).length;
  }

  // totalMined:<resource>
  if (metric.startsWith("totalMined:")) {
    if (metric === "totalMined:silicate") {
      // AB#828: the Silicates the yards mined; a yard saved before per-item counts mined nothing else.
      return (corp?.mining?.silicateExtractors || [])
        .reduce((sum, ex) => sum + Number(ex?.minedByItem ? ex.minedByItem.Silicates || 0 : ex?.totalMined || 0), 0);
    }
    // ISP-106 (AB#798): any other raw resource, as returning expeditions deposited it (asteroids.js bumps mined:<name>).
    const wanted = metric.slice(11).toLowerCase();
    const resource = MINEABLE_RESOURCES.find((r) => r.toLowerCase() === wanted);
    if (!resource) return unknownMetric(metric);
    return Number(stats[`mined:${resource}`] || 0);
  }

  // unlockedTech:<techId>
  if (metric.startsWith("unlockedTech:")) {
    const techId = metric.slice(13);
    return unlockedTech.includes(techId) ? 1 : 0;
  }

  return unknownMetric(metric);
}

// ISP-106 (AB#798): a metric the resolver does not know used to resolve to 0 in silence, so a level naming it could
// never be reached and nothing said why (AB#424). Under tests it throws; in production it is logged once and counts 0.
const reportedUnknownMetrics = new Set();
function unknownMetric(metric) {
  if (process.env.NODE_ENV === "test") throw new Error(`resolveMetric does not know "${metric}" (AB#798).`);
  if (!reportedUnknownMetrics.has(metric)) {
    reportedUnknownMetrics.add(metric);
    console.warn(`[progression] unknown milestone metric "${metric}": it counts as 0 (AB#798).`);
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
  // ISP-171 (AB#865): the ships a corporation has and every ship its shipyard is building are vessels too
  const ships = SHIP_UNIT_IDS.reduce((sum, id) => sum + (Number(corp?.military?.units?.[id]) || 0), 0)
    + (corp?.shipyard?.queue || []).reduce((sum, job) => sum + (Number(job.quantity) || 0), 0);
  const vessels = Number(am.probeCount || 0) + (am.fabricationQueue || []).length + (am.activeExpeditions || []).length + ships;
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

/**
 * ISP-104 (AB#796): what each unlock key does to a corporation, one applier per LEVEL_UNLOCK_KEYS entry. Each merges
 * upward: a level never lowers a value the corporation already has (a larger cap from research or a later level, a
 * sector opened another way), so evaluating again, or in any order, is harmless.
 */
const raise = (current, value) => Math.max(Number(current) || 0, Number(value) || 0);
export const UNLOCK_APPLIERS = Object.freeze({
  employeeCap: (corp, v) => { corp.employeeCap = raise(corp.employeeCap, v); },
  buildingSlots: (corp, v) => { corp.buildingSlots = raise(corp.buildingSlots, v); },
  maxFleetSize: (corp, v) => { corp.unlocks.maxFleetSize = raise(corp.unlocks.maxFleetSize, v); },
  // AB#793: the highest building tier this level allows (docs/design/upgrades.md), never below 1.
  maxUpgradeTier: (corp, v) => { corp.unlocks.maxUpgradeTier = Math.max(1, raise(corp.unlocks.maxUpgradeTier, v)); },
  // AB#2307: concurrent expedition slots, raised from BASE_MAX_DEPLOYMENTS (docs/design/ladder-11-40.md, levels 12/24/33).
  // Not through ensureCorpAsteroidMiningModel: asteroids.js sits above this module in the layer order (AB#737), and the
  // model fills every other field the first time it is read.
  maxDeployments: (corp, v) => {
    if (!corp.asteroidMining || typeof corp.asteroidMining !== "object") corp.asteroidMining = {};
    const am = corp.asteroidMining;
    am.maxDeployments = raise(typeof am.maxDeployments === "number" ? am.maxDeployments : BASE_MAX_DEPLOYMENTS, v);
  },
  marketSectors: (corp, v) => {
    if (!Array.isArray(corp.unlocks.marketSectors)) corp.unlocks.marketSectors = [];
    for (const sector of Array.isArray(v) ? v : []) if (!corp.unlocks.marketSectors.includes(sector)) corp.unlocks.marketSectors.push(sector);
  }
});
{
  const missing = LEVEL_UNLOCK_KEYS.filter((k) => !UNLOCK_APPLIERS[k]);
  const extra = Object.keys(UNLOCK_APPLIERS).filter((k) => !LEVEL_UNLOCK_KEYS.includes(k));
  if (missing.length || extra.length) throw new Error(`Unlock appliers and LEVEL_UNLOCK_KEYS differ (AB#796): missing ${missing.join(", ") || "none"}, extra ${extra.join(", ") || "none"}.`);
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
    // ISP-104 (AB#796): every key the level names, through its applier; catalog.js refused any other at load.
    if (!corp.unlocks || typeof corp.unlocks !== "object") corp.unlocks = {};
    for (const [key, value] of Object.entries(levelDef.unlocks || {})) UNLOCK_APPLIERS[key](corp, value);
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

/** AB#803: what each unlock key is called on screen; the level notice and the level panel use the same words. */
export const UNLOCK_LABELS = Object.freeze({
  employeeCap: "Employee cap",
  buildingSlots: "Building slots",
  maxFleetSize: "Fleet cap",
  maxUpgradeTier: "Highest building tier",
  maxDeployments: "Deployment slots", // the expedition panel's words (AB#2307)
  marketSectors: "Market sectors opened"
});

/**
 * AB#803: a level's own unlocks as the level panel lists them, in the data's order, each as the level grants it (a cap
 * research adds to, such as Fleet Coordination's, is shown without it). A sector list that opens nothing is left out.
 */
export function levelUnlockList(unlocks) {
  return Object.entries(unlocks || {}).flatMap(([key, v]) => {
    const value = Array.isArray(v) ? v.join(", ") : String(v);
    return value === "" ? [] : [{ key, label: UNLOCK_LABELS[key] || key, value }];
  });
}

/**
 * The notices for the levels `corp` reached since `before`. The figures are the ones the sidebar shows once each level
 * is granted, built by the same rules as evaluateLevelProgress and fleetStatus: each cap is the highest of what the
 * corporation had and what every level up to this one grants, and the fleet cap includes Fleet Coordination.
 */
export function levelReachedNotices(before, corp, levels = MILESTONE_LEVELS) {
  const coordinated = (corp?.unlockedTech || []).includes(FLEET_COORDINATION_TECH);
  let employeeCap = Number(before.employeeCap || 0);
  let buildingSlots = Number(before.buildingSlots || 0);
  let maxFleetSize = Number(before.maxFleetSize || 0);
  let maxUpgradeTier = Math.max(1, Number(before.maxUpgradeTier || 1)); // AB#793
  let maxDeployments = Math.max(BASE_MAX_DEPLOYMENTS, Number(before.maxDeployments || 0)); // AB#2307
  const sectors = new Set(before.marketSectors || []);
  const notices = [];
  for (const levelDef of [...levels].sort((a, b) => a.level - b.level)) {
    if (levelDef.level > Number(corp.level || 0)) break;
    const u = levelDef.unlocks || {};
    employeeCap = Math.max(employeeCap, Number(u.employeeCap || 0));
    buildingSlots = Math.max(buildingSlots, Number(u.buildingSlots || 0));
    maxFleetSize = Math.max(maxFleetSize, Number(u.maxFleetSize || 0));
    maxUpgradeTier = Math.max(maxUpgradeTier, Number(u.maxUpgradeTier || 0));
    maxDeployments = Math.max(maxDeployments, Number(u.maxDeployments || 0));
    const opened = (Array.isArray(u.marketSectors) ? u.marketSectors : []).filter((sector) => !sectors.has(sector));
    opened.forEach((sector) => sectors.add(sector));
    if (levelDef.level <= Number(before.level || 0)) continue;
    const fleetCap = Math.max(BASE_MAX_PROBES, maxFleetSize) + (coordinated ? FLEET_COORDINATION_BONUS : 0);
    // AB#743: the same figures, one per unlock this level defines in data/milestones.json, for the milestone modal. A
    // key this list does not know is still shown, under its own name, rather than dropped.
    const resulting = {
      employeeCap: { label: UNLOCK_LABELS.employeeCap, value: String(employeeCap) },
      buildingSlots: { label: UNLOCK_LABELS.buildingSlots, value: String(buildingSlots) },
      maxFleetSize: { label: UNLOCK_LABELS.maxFleetSize, value: String(fleetCap) },
      maxUpgradeTier: { label: UNLOCK_LABELS.maxUpgradeTier, value: String(maxUpgradeTier) },
      maxDeployments: { label: UNLOCK_LABELS.maxDeployments, value: String(maxDeployments) },
      marketSectors: { label: UNLOCK_LABELS.marketSectors, value: (opened.length ? opened : u.marketSectors || []).join(", ") }
    };
    notices.push({
      type: "level",
      title: `Corporation Level ${levelDef.level}`,
      body:
        `Your corporation reached Level ${levelDef.level} of ${MAX_DEFINED_LEVEL}. ` +
        `Employee cap ${employeeCap}, building slots ${buildingSlots}, fleet cap ${fleetCap}.` +
        (opened.length ? ` Market sector${opened.length > 1 ? "s" : ""} opened: ${opened.join(", ")}.` : ""),
      level: levelDef.level,
      maxLevel: MAX_DEFINED_LEVEL,
      unlocks: Object.keys(u).map((key) => ({ key, ...(resulting[key] || { label: key, value: String(u[key]) }) }))
    });
  }
  return notices;
}

/**
 * Evaluate an account's level and tell it about each level it has just reached. Returns those levels, as
 * { level, maxLevel, title, unlocks }, oldest first, and [] when none (AB#743: mutateAccountState hands them to the
 * route's response for the milestone modal).
 */
export function evaluateAccountLevel(accountId, account) {
  const corp = account.state.corp;
  const before = {
    level: Number(corp.level || 0),
    employeeCap: corp.employeeCap,
    buildingSlots: corp.buildingSlots,
    maxFleetSize: corp.unlocks?.maxFleetSize,
    maxDeployments: corp.asteroidMining?.maxDeployments,
    marketSectors: [...(corp.unlocks?.marketSectors || [])]
  };
  evaluateLevelProgress(account.state);
  if (!(Number(corp.level || 0) > before.level)) return [];
  const notices = levelReachedNotices(before, corp);
  for (const notice of notices) {
    pushSystemNotification(account, notice);
    if (accountNotificationListener) accountNotificationListener(accountId, sanitizeNotification(account.notifications[0]));
  }
  return notices.map(({ level, maxLevel, title, unlocks }) => ({ level, maxLevel, title, unlocks }));
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

