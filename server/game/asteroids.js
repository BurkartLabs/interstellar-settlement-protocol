// server/game/asteroids.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { ECONOMY } from "../economy.js";
import { BASE_MAX_DEPLOYMENTS, MINEABLE_RESOURCES, SYSTEMS_BY_ID, SYSTEMS_DATA, createId, getStationInventory } from "./catalog.js";
import { allStations } from "./stations.js"; // ISP-209 (AB#904)
import { bumpStat } from "./progression.js";
import { countBuilt, playerBuilding } from "../playerBuildings.js";
import { BASE_YIELD_PER_MIN, RARITY_YIELD_MULTIPLIER } from "./beltRules.js"; // AB#2329: one copy, with the belt rules
import { beltAt, isBeltPresent, markBeltEmpty } from "./belts.js";
import { canRecover } from "./researchGates.js";
import { recordExtraction } from "./dominanceCounters.js"; // ISP-217 (AB#912)

// ISP-96 (AB#786): the Ferric Mining Complex multiplies the Nickel and Titanium a returning expedition deposits, by
// data/economy.json's buildings.ferricMiningComplexMetalMultiplier, in whole units rounded down.
const FERRIC_MINING_COMPLEX = playerBuilding("ferric-mining-complex");
export const FERRIC_METALS = Object.freeze(["Nickel", "Titanium"]);

/** What a corporation's Ferric Mining Complex adds to these yields, { Nickel: n, ... }, or null when it adds nothing. */
export function ferricBonus(corp, yields) {
  if (countBuilt(FERRIC_MINING_COMPLEX, corp) === 0) return null;
  const multiplier = ECONOMY.buildings.ferricMiningComplexMetalMultiplier;
  const bonus = {};
  for (const metal of FERRIC_METALS) {
    const carried = Number(yields?.[metal] || 0);
    const added = Math.floor(carried * multiplier) - carried;
    if (added > 0) bonus[metal] = added;
  }
  return Object.keys(bonus).length ? bonus : null;
}

// ─── Asteroid Belt Mining ────────────────────────────────────────────────────

// Deterministic belt compositions per system — scoutable
/**
 * ISP-112 (AB#804): each belt's composition is its Field body's `composition` in data/systems.json, keyed
 * "<system id>:<body id>" as a scout and an expedition name it. AB#2330: that is the belt's generation 1; in play an
 * expedition mines the belt in the world state (server/game/belts.js), its composition and rarity, out of its reserve.
 * Whether belts should out-earn extractor yards (a Sol expedition breaks even today) is left to the economy: see
 * docs/design/belts.md (AB#1050).
 */
const BELT_COMPOSITION_BY_KEY = new Map(SYSTEMS_DATA.flatMap((system) =>
  (system.bodies || []).filter((b) => b.composition).map((b) => [`${system.id}:${b.id}`, Object.freeze({ ...b.composition })])));

/** Every belt a corporation can scout or send an expedition to. */
export const BELT_KEYS = Object.freeze([...BELT_COMPOSITION_BY_KEY.keys()]);

/** A belt's composition (resource: weight), or null for a key the catalog does not have. */
export function beltComposition(beltKey) {
  return BELT_COMPOSITION_BY_KEY.get(beltKey) || null;
}

// Rarity tiers control yield multiplier and the chance of bonus "jackpot" drops
/**
 * ISP-112 (AB#804): a system's rarity is its `rarity` in data/systems.json. AB#2329: a new belt's rarity is drawn from a
 * distribution centred on this label (server/game/belts.js); the label is its generation 1's rarity.
 */
export function systemRarity(systemId) {
  return SYSTEMS_BY_ID.get(systemId)?.rarity || null;
}

// TODO(AB#822): In addition to rarity improving yields, it should also determine what types of raw resources are available
export { RARITY_YIELD_MULTIPLIER }; // in beltRules.js since AB#2329

export const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV !== "production";

// Expedition durations (ms) — short, standard, extended
// In dev mode: 10s with scaled-up yield multipliers for quick testing
export const EXPEDITION_DURATIONS = IS_DEV ? {
  short:    { label: "Short Sweep (10s)",      ms: 10 * 1000, tickYieldMultiplier: 126 },
  standard: { label: "Standard Survey (10s)",  ms: 10 * 1000, tickYieldMultiplier: 360 },
  extended: { label: "Deep Core Drill (10s)",  ms: 10 * 1000, tickYieldMultiplier: 1008 }
} : {
  short:    { label: "Short Sweep (30 min)",       ms: 30 * 60 * 1000, tickYieldMultiplier: 1 },
  standard: { label: "Standard Survey (1 hr)",     ms: 60 * 60 * 1000, tickYieldMultiplier: 1 },
  extended: { label: "Deep Core Drill (2 hr)",     ms: 2 * 60 * 60 * 1000, tickYieldMultiplier: 1 }
};

export const EXPEDITION_LAUNCH_COST = ECONOMY.expeditions.launchCost;   // credits per expedition launch (data/economy.json)
export const PROBE_BUILD_COST = ECONOMY.probes.buildCost;               // credits to fabricate one mining probe
export const PROBE_ASSET_VALUE = ECONOMY.probes.assetValue;
export const PROBE_FABRICATION_MS = IS_DEV ? 10 * 1000 : 30 * 60 * 1000; // 10s dev, 30 min prod
export { BASE_MAX_DEPLOYMENTS }; // concurrent expedition slots; in catalog.js, where progression can read it (AB#2307)

export function ensureCorpAsteroidMiningModel(corp) {
  if (!corp.asteroidMining || typeof corp.asteroidMining !== "object") {
    corp.asteroidMining = {};
  }
  const am = corp.asteroidMining;

  if (typeof am.probeCount !== "number") am.probeCount = 0;
  if (typeof am.maxDeployments !== "number") am.maxDeployments = BASE_MAX_DEPLOYMENTS;
  if (!Array.isArray(am.fabricationQueue)) am.fabricationQueue = [];
  if (!Array.isArray(am.activeExpeditions)) am.activeExpeditions = [];
  if (!Array.isArray(am.completedExpeditions)) am.completedExpeditions = [];
  if (!Array.isArray(am.scoutedBelts)) am.scoutedBelts = [];

  // Normalize each active expedition
  am.activeExpeditions = am.activeExpeditions.map((exp) => ({
    id: exp.id || createId("exp"),
    beltKey: exp.beltKey || "sol:belt",
    systemId: exp.systemId || "sol",
    duration: exp.duration || "standard",
    deployedAt: exp.deployedAt || Date.now(),
    completesAt: exp.completesAt || Date.now(),
    lastTickAt: exp.lastTickAt || exp.deployedAt || Date.now(),
    // AB#2330: the belt generation it was launched at; an expedition saved before belts had generations was at the first.
    generation: Number(exp.generation) || 1,
    launchCost: Number(exp.launchCost || EXPEDITION_LAUNCH_COST),
    yields: exp.yields || {},
    // Bug #1274: the fraction of a unit carried to the next tick; an expedition saved before it starts at 0.
    yieldCarry: Math.max(0, Number(exp.yieldCarry) || 0),
    status: exp.status || "active"
  }));
}

/**
 * Seeded pseudo-random for deterministic-per-tick asteroid loot.
 * Returns value in [0, 1).
 */
export function seededRand(seed) {
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xFFFFFFFF;
}

export function weightedPick(pool, seed) {
  const total = Object.values(pool).reduce((a, b) => a + b, 0);
  let roll = seededRand(seed) * total;
  for (const [resource, weight] of Object.entries(pool)) {
    roll -= weight;
    if (roll <= 0) return resource;
  }
  // Fallback
  return Object.keys(pool)[0];
}

// Bug #1274: an expedition's yield in whole units, with the fraction carried to the next tick, and split across the
// tick's drops so the drops add up to exactly that many. In production a 10-second tick of a Short Sweep is worth 0.5
// units; floored on its own it was always 0, and every production expedition came home empty. This is the extractors'
// rule (Bug #1138, !177: whole units now, the fraction carried, the same tolerance for floating-point drift), so a sweep
// yields the same total whether it is settled every 10 seconds or once at the end. An expedition saved before this has
// no carry yet, which reads as 0.
export const EXPEDITION_CARRY_TOLERANCE = 1e-6;
export function takeWholeUnits(amount, carried) {
  const total = amount + Math.max(0, Number(carried) || 0);
  const whole = Math.floor(total + EXPEDITION_CARRY_TOLERANCE);
  return { whole, rest: Math.max(0, total - whole) };
}

/** Split `whole` units into `weights.length` shares that add up to exactly `whole` (largest remainders first). */
export function splitExactly(whole, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (whole * w) / sum);
  const shares = raw.map(Math.floor);
  let left = whole - shares.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) shares[order[k][1]] += 1;
  return shares;
}

/**
 * Settle a corporation's expeditions to `now`, and bring home each one that is due. Returns the expeditions that came
 * home, as filed in completedExpeditions.
 *
 * AB#2330: given the world state, an expedition mines its belt there: the belt's composition and rarity, its yield
 * taken out of the belt's remaining reserve, which every corporation on the belt shares. The tick that takes the last
 * unit marks the belt empty, and an expedition whose belt is empty or has since respawned (a later generation) comes
 * home that tick with what it carried, its report saying it ended early; the launch cost is not refunded. The ticker
 * reaches corporations in turn, so on the tick that empties a belt the one it reaches first takes its full share and
 * the next what is left. Without the world state (unit tests and fixtures that settle one corporation alone) the
 * belt is the catalog's generation 1, never running out.
 */
export function applyAsteroidExpeditions(corp, now = Date.now(), world = null) {
  ensureCorpAsteroidMiningModel(corp);

  const am = corp.asteroidMining;
  const expeditionsToRemove = [];
  const cameHome = [];

  const bringHome = (exp, endedEarly) => {
    exp.status = "completed";
    if (endedEarly) exp.endedEarly = { reason: "belt-depleted", at: now, scheduledAt: Number(exp.completesAt) };

    // Deposit yields into nearest station in the expedition's system
    const stationsInSystem = allStations().filter(s => s.systemId === exp.systemId);
    const depositStationId = (stationsInSystem.length > 0)
      ? (stationsInSystem.find(s => s.id === corp.currentStationId)?.id || stationsInSystem[0].id)
      : (corp.currentStationId || "earth-station-prime");

    // ISP-96 (AB#786): what the Ferric Mining Complex adds is deposited with the rest and named in the report.
    const bonus = ferricBonus(corp, exp.yields);
    if (bonus) {
      for (const [metal, added] of Object.entries(bonus)) exp.yields[metal] += added;
      exp.ferricBonus = bonus;
    }

    const stationInv = getStationInventory(corp, depositStationId);
    for (const [resource, qty] of Object.entries(exp.yields)) {
      stationInv[resource] = (stationInv[resource] || 0) + qty;
      // ISP-106 (AB#798): counted for totalMined:<resource>; only the catalogue's raw resources have a counter.
      if (MINEABLE_RESOURCES.includes(resource) && qty > 0) bumpStat(corp, `mined:${resource}`, qty);
    }

    // Return the probe
    am.probeCount = (am.probeCount || 0) + 1; // it counted against the Fleet Cap while away

    // Move to completed log (keep last 20)
    const record = { ...exp, completedAt: now, depositStationId };
    am.completedExpeditions.unshift(record);
    bumpStat(corp, "asteroidExpeditionsCompleted", 1); // Bug #424: levels 7 and 10
    if (am.completedExpeditions.length > 20) am.completedExpeditions.length = 20;

    expeditionsToRemove.push(exp.id);
    cameHome.push(record);
  };

  am.activeExpeditions.forEach((exp) => {
    if (exp.status !== "active") return;

    const lastTick = Number(exp.lastTickAt || exp.deployedAt);
    const completesAt = Number(exp.completesAt);

    // AB#2330: the belt this expedition was launched at, or null when it has been mined out or replaced since.
    const belt = world ? beltAt(world, exp.beltKey) : null;
    if (world && (!isBeltPresent(belt) || belt.generation !== exp.generation)) {
      exp.lastTickAt = now;
      bringHome(exp, now < completesAt);
      return;
    }

    const intervalEnd = Math.min(now, completesAt);
    const elapsedMs = Math.max(0, intervalEnd - lastTick);

    if (elapsedMs <= 0 && now < completesAt) return;

    // Determine belt composition
    const composition = belt ? belt.composition : beltComposition(exp.beltKey);
    if (!composition || !beltComposition(exp.beltKey)) {
      exp.status = "completed";
      expeditionsToRemove.push(exp.id);
      return;
    }

    // AB#804: every system in the catalog has a rarity (tests/schema/data-files.test.js); "common" is only for an
    // expedition sent to a system since taken out of the catalog. AB#2330: in play, the belt's own rarity.
    const rarity = belt?.rarity || systemRarity(exp.systemId) || "common";
    const rarityMult = RARITY_YIELD_MULTIPLIER[rarity];
    const durationDef = EXPEDITION_DURATIONS[exp.duration] || EXPEDITION_DURATIONS.standard;
    const tickMult = durationDef.tickYieldMultiplier;

    // Roll resources for this tick interval
    const tickMinutes = elapsedMs / (60 * 1000);
    // Base: ~2-5 units per resource per tick minute
    const units = takeWholeUnits(tickMinutes * BASE_YIELD_PER_MIN * rarityMult * tickMult, exp.yieldCarry);
    // AB#2330: never more than the belt has left; what it could not have is not carried either.
    const totalYield = belt ? Math.min(units.whole, belt.remaining) : units.whole;
    exp.yieldCarry = totalYield < units.whole ? 0 : units.rest;
    if (belt) belt.remaining -= totalYield;
    recordExtraction(corp, exp.systemId, totalYield, intervalEnd); // ISP-217 (AB#912): drawn from the belt, in its system

    if (totalYield > 0) {
      // Generate a tick-unique seed from expedition id + tick timestamp
      const tickSeed = (hashSeedStr(exp.id) + Math.floor(now / 5000)) | 0;

      // Roll 1–3 resources per tick (never more drops than units), sharing exactly totalYield between them
      const dropCount = Math.min(totalYield, 1 + Math.floor(seededRand(tickSeed) * 3));
      const weights = Array.from({ length: dropCount }, (_, i) => 0.6 + seededRand(tickSeed + i * 3571) * 0.8);
      const shares = splitExactly(totalYield, weights);
      for (let i = 0; i < dropCount; i++) {
        if (shares[i] <= 0) continue;
        const resource = weightedPick(composition, tickSeed + i * 7919);
        if (!canRecover(corp, resource)) continue; // AB#880: dug from the belt, not recovered without the research
        exp.yields[resource] = (exp.yields[resource] || 0) + shares[i];
      }
    }

    exp.lastTickAt = now;

    // AB#2330: the unit that empties the belt ends every expedition on it; this one comes home now.
    if (belt && belt.remaining <= 0) {
      markBeltEmpty(world, exp.beltKey, now);
      bringHome(exp, now < completesAt);
      return;
    }

    // Check completion
    if (now >= completesAt) bringHome(exp, false);
  });

  // Remove completed expeditions from active list
  if (expeditionsToRemove.length > 0) {
    am.activeExpeditions = am.activeExpeditions.filter((e) => !expeditionsToRemove.includes(e.id));
  }
  return cameHome;
}

export function hashSeedStr(input) {
  let h = 0;
  const text = String(input || "x");
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

