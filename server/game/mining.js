// server/game/mining.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { applyCredits } from "../finances.js";
import { ECONOMY, operationCostPerHourFor } from "../economy.js";
import { miningEfficiency } from "../../public/scripts/miningEfficiency.js"; // ISP-98 (AB#788)
import { BODY_TO_STATION, getStationInventory } from "./catalog.js";

export function ensureCorpMiningModel(corp) {
  if (!corp.mining || typeof corp.mining !== "object") {
    corp.mining = {};
  }

  if (!Array.isArray(corp.mining.silicateExtractors)) {
    corp.mining.silicateExtractors = [];
  }

  // Migrate legacy single extractor model into the multi-extractor array only if it has real data.
  // TODO(AB#737): Is this still needed?
  const legacyExtractor = corp.mining.silicateExtractor;
  const legacyHasData = Boolean(
    legacyExtractor &&
      (legacyExtractor.active ||
        Number(legacyExtractor.totalMined || 0) > 0 ||
        Number(legacyExtractor.totalSpent || 0) > 0 ||
        Number(legacyExtractor.throughputPerHour || 0) > 0 ||
        legacyExtractor.startedAt ||
        legacyExtractor.endsAt)
  );

  if (legacyHasData && !corp.mining.silicateExtractors.length) {
    corp.mining.silicateExtractors.push({
      id: "ext-basic-1",
      name: "Basic Extractor Yard #1",
      tier: 1,
      ...legacyExtractor
    });
  }

  const builtExtractorCount = (corp.buildings || []).filter((b) => b.name === "Basic Extractor Yard").length;
  while (corp.mining.silicateExtractors.length < builtExtractorCount) {
    const nextIndex = corp.mining.silicateExtractors.length + 1;
    corp.mining.silicateExtractors.push({
      id: `ext-basic-${nextIndex}`,
      name: `Basic Extractor Yard #${nextIndex}`,
      tier: 1,
      active: false,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      throughputPerHour: 0,
      operationCostPerHour: 0,
      totalMined: 0,
      minedRemainder: 0,
      costRemainder: 0,
      totalSpent: 0,
      lastCompletedAt: null,
      downtimeActive: false,
      downtimeStartedAt: null,
      downtimeRecoveredAt: null
    });
  }

  corp.mining.silicateExtractors = corp.mining.silicateExtractors.map((extractor, index) => {
    // Bulletproof downtime: if downtimeActive is true and downtimeStartedAt is missing, set it to now
    let downtimeStartedAt = extractor.downtimeStartedAt;
    if (extractor.downtimeActive && (!downtimeStartedAt || downtimeStartedAt === 0)) {
      downtimeStartedAt = Date.now();
    }
    let throughput = Number(extractor.throughputPerHour || 0);
    let operationCost = Number(extractor.operationCostPerHour || 0);
    // Only auto-fix throughput/cost if NOT active
    if (!extractor.active) {
      if (throughput <= 0) throughput = 40;
      if (operationCost <= 0) operationCost = operationCostPerHourFor(throughput, undefined, { yardIndex: index, tier: extractor.tier }); // AB#2284, AB#793
    }
    const normalized = {
      id: String(extractor.id || `ext-basic-${index + 1}`),
      name: String(extractor.name || `Basic Extractor Yard #${index + 1}`),
      tier: Number(extractor.tier || 1),
      active: Boolean(extractor.active),
      startedAt: extractor.startedAt ?? null,
      lastTickAt: extractor.lastTickAt ?? null,
      endsAt: extractor.endsAt ?? null,
      throughputPerHour: throughput,
      operationCostPerHour: operationCost,
      totalMined: Number(extractor.totalMined || 0),
      // AB#575: this cycle's output, zeroed by startExtractorCycle; totalMined is the lifetime.
      minedThisCycle: Math.max(0, Number(extractor.minedThisCycle || 0)),
      // AB#746: this cycle's cost so far, set by startExtractorCycle and added to by each charged tick. null for a cycle
      // started before the field existed, so the page shows its estimate from the clock instead of a false 0.
      spentThisCycle: extractor.spentThisCycle == null ? null : Math.max(0, Number(extractor.spentThisCycle) || 0),
      minedRemainder: Math.max(0, Number(extractor.minedRemainder || 0)),
      // Bug #1138: the running cost's unpaid fraction of a credit, carried like minedRemainder.
      costRemainder: Math.max(0, Number(extractor.costRemainder || 0)),
      totalSpent: Number(extractor.totalSpent || 0),
      lastCompletedAt: extractor.lastCompletedAt ?? null,
      leaseId: extractor.leaseId ?? null,
      // AB#792: the id of this extractor's yard in corp.buildings, given by ensureBuildingIds (server/game/buildingIds.js).
      buildingId: extractor.buildingId ?? null,
      // AB#793: while an upgrade is under way the yard is offline until this time (ms); no cycle starts before it.
      upgradingUntil: Number(extractor.upgradingUntil) > 0 ? Number(extractor.upgradingUntil) : null,
      // Authoritative location string (planet/moon name). Persisted on the
      // extractor row directly so we don't have to chase leaseId references
      // across hydrations to know where the yard physically lives.
      body: extractor.body ?? null,
      downtimeActive: Boolean(extractor.downtimeActive),
      downtimeStartedAt: downtimeStartedAt ?? null,
      downtimeRecoveredAt: (extractor.downtimeRecoveredAt !== undefined ? extractor.downtimeRecoveredAt : null)
    };
    return normalized;
  });

  // Legacy compatibility surface for existing frontend code paths.
  corp.mining.silicateExtractor = corp.mining.silicateExtractors[0] || {
    id: "ext-basic-0",
    name: "Basic Extractor Yard #0",
    tier: 1,
    active: false,
    startedAt: null,
    lastTickAt: null,
    endsAt: null,
    throughputPerHour: 0,
    operationCostPerHour: 0,
    totalMined: 0,
    minedRemainder: 0,
    costRemainder: 0,
    totalSpent: 0,
    lastCompletedAt: null
  };

  // Backfill leaseId/body for legacy extractors built before location was
  // tracked on the row itself.
  // Strategy:
  //   1. If a lease references the extractor in extractorIds, link it.
  //   2. If a leaseId points to a lease whose id only differs by an `accountId::`
  //      namespace prefix (legacy hydration mismatch), rewire to the unwrapped id.
  //   3. If there's exactly one lease, assume the extractor lives there.
  //   4. Otherwise leave it unassigned — the UI will surface "Unassigned" so
  //      the player can tell which yards still need to be placed, instead of
  //      silently defaulting them all to whichever lease happens to be first.
  const leases = Array.isArray(corp.miningLeases) ? corp.miningLeases : [];
  if (leases.length) {
    for (const ex of corp.mining.silicateExtractors) {
      if (ex.leaseId) {
        const direct = leases.find((l) => l.id === ex.leaseId);
        if (direct) {
          if (!ex.body) ex.body = direct.body || null;
          continue;
        }
        // Try matching by raw suffix in case of stale namespace prefixes.
        const stripped = String(ex.leaseId).split("::").pop();
        const fuzzy = leases.find((l) => String(l.id).split("::").pop() === stripped);
        if (fuzzy) {
          ex.leaseId = fuzzy.id;
          if (!ex.body) ex.body = fuzzy.body || null;
          continue;
        }
        // leaseId points nowhere; fall through to reassignment.
      }
      const owning = leases.find((l) => Array.isArray(l.extractorIds) && l.extractorIds.includes(ex.id));
      if (owning) {
        ex.leaseId = owning.id;
        if (!ex.body) ex.body = owning.body || null;
        continue;
      }
      // Single-lease shortcut: only one lease means there's only one place
      // the yard could be — safe to attach without ambiguity.
      if (leases.length === 1) {
        const target = leases[0];
        ex.leaseId = target.id;
        if (!ex.body) ex.body = target.body || null;
        if (!Array.isArray(target.extractorIds)) target.extractorIds = [];
        if (!target.extractorIds.includes(ex.id)) target.extractorIds.push(ex.id);
      }
      // Multiple leases + no link → leave unassigned (ex.leaseId stays null).
    }
    // Rebuild extractorIds lists from the now-authoritative leaseId pointers.
    for (const lease of leases) {
      lease.extractorIds = corp.mining.silicateExtractors
        .filter((ex) => ex.leaseId === lease.id)
        .map((ex) => ex.id);
    }
  }
}

// AB#1052: also called directly by POST /lease/:leaseId/stop-mining (server/index.js). mutateAccountState
// settles every extractor up to "now" via applyMiningOperations before that route's mutator runs, so by the
// time this is called the extractor's minedThisCycle/totalSpent/lastTickAt already reflect the real elapsed
// time — stopping it here charges for exactly what happened, not a moment more.
export function stopExtractorCycle(extractor, timestamp) {
  extractor.active = false;
  extractor.endsAt = timestamp;
  extractor.lastTickAt = timestamp;
  extractor.lastCompletedAt = timestamp;
}

/**
 * Start a mining cycle on an extractor: the one place both start routes go through (AB#575). It zeroes the
 * per-cycle count the extractor panel shows as "Mined this cycle"; totalMined stays the lifetime figure.
 */
export function startExtractorCycle(extractor, { now, hours, throughputPerHour, operationCostPerHour, startupCost }) {
  extractor.active = true;
  extractor.startedAt = now;
  extractor.lastTickAt = now;
  extractor.endsAt = now + hours * 60 * 60 * 1000;
  extractor.throughputPerHour = throughputPerHour;
  extractor.operationCostPerHour = operationCostPerHour;
  extractor.totalSpent = Number(extractor.totalSpent || 0) + startupCost;
  extractor.minedThisCycle = 0;
  extractor.spentThisCycle = startupCost; // AB#746
}

/**
 * An extractor's chance of breaking down per second: 0.005%, 8% less with Industrial Safety research and 12% less
 * again with the Risk Assessment Framework CEO program (Bug #983: that program used to change nothing).
 */
export function extractorDowntimeProbPerSec(corp) {
  let probPerSec = 0.00005;
  if ((corp.unlockedTech || []).includes("tt-industrial-safety")) probPerSec *= 0.92;
  if ((corp.completedInsights || []).includes("ceo-risk-assessment")) probPerSec *= 0.88;
  return probPerSec;
}

// Bug #1138: whole units now, the fraction carried to the next call, for yield and running cost alike. The mining step
// runs on every account read and around every write as well as on the ticker, so the same hour can arrive in one
// slice or in thousands; it must come to the same totals either way. The tolerance absorbs floating-point drift:
// 36,000 slices of 1/900 add up to 39.99999..., which floored to 39 and lost the last ton of every cycle.
export const CARRY_TOLERANCE = 1e-6;
export function takeWhole(amount, carried) {
  const total = amount + Math.max(0, Number(carried) || 0);
  const whole = Math.floor(total + CARRY_TOLERANCE);
  return { whole, rest: Math.max(0, total - whole) };
}

// AB#2296: breakdowns are settled as events inside the interval, not as one roll over it. The old step drew one
// breakdown roll for everything since lastTickAt and, on a hit, returned before mining, so a breakdown anywhere in an
// hour forfeited the whole hour; its recovery roll measured from a lastTickAt that did not move while broken, and on
// recovery restarted from the read time, dropping what came before. So a cycle's output and its downtime depended on
// how often the account was read, the class Bug #1138 fixed for fees. Now: mine until a breakdown time drawn from the
// per-second chance, stay down at least MIN_DOWNTIME_MS, recover at a time drawn the same way, mine again. Each draw
// is memoryless, so one call over an hour and 720 calls five seconds apart settle it the same way in distribution.
const MIN_DOWNTIME_MS = 15 * 60 * 1000;
const RECOVERY_PROB_PER_SEC = 0.000276; // 0.0276% a second, once the minimum is over

/**
 * Seconds until the first event of a chance of `probPerSec` each second: P(within s) = 1 - (1 - p)^s, the per-call
 * formula this replaces, drawn once. Math.random() of 0 is an event at once; close to 1, practically never.
 */
function secondsUntil(probPerSec) {
  if (!(probPerSec > 0)) return Infinity;
  const u = Math.min(Math.random(), 1 - 1e-12);
  return Math.log(1 - u) / Math.log(1 - probPerSec);
}

/** Mine and charge an extractor for [from, to] at its rate. Returns the share of the span it could afford. */
function mineSpan(corp, extractor, from, to, now) {
  const elapsedMs = Math.max(0, to - from);
  if (elapsedMs <= 0) return 1;
  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const throughput = Math.max(0, Number(extractor.throughputPerHour || 0));
  // ISP-98 (AB#788): research, and a Cryo-vapor Extractor Array on the extractor's lease; one rule with the panel.
  const efficiency = miningEfficiency(corp, (corp.miningLeases || []).find((l) => l.id === extractor.leaseId), ECONOMY.buildings);
  const projectedMined = elapsedHours * throughput * efficiency;
  const projectedCost = elapsedHours * Math.max(0, Number(extractor.operationCostPerHour || 0));

  let affordabilityRatio = 1;
  if (projectedCost > 0) {
    const byCredits = corp.finances.credits / projectedCost;
    affordabilityRatio = Math.max(0, Math.min(1, byCredits));
  }

  const mined = takeWhole(projectedMined * affordabilityRatio, extractor.minedRemainder);
  const actualMined = mined.whole;
  extractor.minedRemainder = mined.rest;
  const cost = takeWhole(projectedCost * affordabilityRatio, extractor.costRemainder);
  const actualCost = cost.whole;
  extractor.costRemainder = cost.rest;

  if (actualCost > 0) {
    const charged = -applyCredits(corp, -Math.min(actualCost, Math.max(0, Math.round(Number(corp.finances.credits) || 0))), "mining-ops", now);
    extractor.totalSpent += charged;
    if (extractor.spentThisCycle != null) extractor.spentThisCycle += charged; // AB#746
  }

  if (actualMined > 0) {
    // Deposit at the station orbiting the extractor's lease body
    const lease = (corp.miningLeases || []).find((l) => l.id === extractor.leaseId);
    const depositStation = (lease && BODY_TO_STATION[lease.body]) || corp.currentStationId || "earth-station-prime";
    const stationInv = getStationInventory(corp, depositStation);
    stationInv.Silicates = (stationInv.Silicates || 0) + actualMined;
    extractor.totalMined += actualMined;
    extractor.minedThisCycle = Number(extractor.minedThisCycle || 0) + actualMined;
    // Bug #984: mined silicates are inventory, not income; revenue is booked when they are sold.
  }

  extractor.lastTickAt = from + Math.round(elapsedMs * affordabilityRatio);
  return affordabilityRatio;
}

/** Settle one active extractor up to `now`: mining, breakdowns and recoveries, in the order they happen. */
function settleExtractor(corp, extractor, now) {
  const maxEnd = Number(extractor.endsAt || now);
  const miningUntil = Math.min(now, maxEnd);
  let t = Number(extractor.lastTickAt || extractor.startedAt || now);
  if (!Number.isFinite(t)) t = now;
  if (extractor.downtimeActive) {
    // A breakdown saved without its time is taken to have started where settling stopped.
    if (!(Number(extractor.downtimeStartedAt) > 0)) extractor.downtimeStartedAt = t;
  } else {
    extractor.downtimeStartedAt = null;
  }

  // Each pass settles up to one event; the minimum downtime bounds the count (at most one breakdown per 15 minutes).
  for (let pass = 0; pass < 100_000; pass += 1) {
    if (extractor.downtimeActive) {
      // Broken down: repairs can run past the cycle's end, as before; only `now` bounds them.
      const from = Math.max(t, Number(extractor.downtimeStartedAt) + MIN_DOWNTIME_MS);
      if (from >= now) { t = Math.max(t, Math.min(now, from)); break; }
      const recoverAt = Math.round(from + secondsUntil(RECOVERY_PROB_PER_SEC) * 1000);
      if (recoverAt >= now) { t = now; break; }
      extractor.downtimeActive = false;
      extractor.downtimeRecoveredAt = recoverAt;
      extractor.downtimeStartedAt = null;
      t = recoverAt;
      continue;
    }
    if (t >= miningUntil) break;
    const breakAt = Math.round(t + secondsUntil(extractorDowntimeProbPerSec(corp)) * 1000);
    const spanEnd = Math.min(breakAt, miningUntil);
    if (mineSpan(corp, extractor, t, spanEnd, now) < 1) {
      stopExtractorCycle(extractor, now); // out of credit: the cycle ends, as it always has
      return;
    }
    t = spanEnd;
    if (breakAt < miningUntil) {
      extractor.downtimeActive = true;
      extractor.downtimeStartedAt = breakAt;
      extractor.downtimeRecoveredAt = null;
    }
  }

  extractor.lastTickAt = Math.max(Number(extractor.lastTickAt) || 0, Math.min(t, now));
  if (now >= maxEnd && !extractor.downtimeActive) stopExtractorCycle(extractor, now);
}

export function applyMiningOperations(corp, now = Date.now()) {
  ensureCorpMiningModel(corp);

  const extractors = corp.mining.silicateExtractors || [];
  extractors.forEach((extractor) => {
    if (!extractor.active) {
      return;
    }
    settleExtractor(corp, extractor, now);
  });

  corp.mining.silicateExtractor = extractors[0];
}

