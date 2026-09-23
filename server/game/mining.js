// server/game/mining.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { applyCredits } from "../finances.js";
import { operationCostPerHourFor } from "../economy.js";
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
      if (operationCost <= 0) operationCost = operationCostPerHourFor(throughput);
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
      minedRemainder: Math.max(0, Number(extractor.minedRemainder || 0)),
      // Bug #1138: the running cost's unpaid fraction of a credit, carried like minedRemainder.
      costRemainder: Math.max(0, Number(extractor.costRemainder || 0)),
      totalSpent: Number(extractor.totalSpent || 0),
      lastCompletedAt: extractor.lastCompletedAt ?? null,
      leaseId: extractor.leaseId ?? null,
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

// TODO(AB#1052): Add force-stop functionality
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

export function applyMiningOperations(corp, now = Date.now()) {
  ensureCorpMiningModel(corp);

  const extractors = corp.mining.silicateExtractors || [];
  extractors.forEach((extractor) => {
    if (!extractor.active) {
      return;
    }

    // --- Downtime logic ---
    if (extractor.downtimeActive) {
      // If downtimeStartedAt is not a valid timestamp, forcibly set it to now (first tick only)
      if (!Number.isFinite(Number(extractor.downtimeStartedAt)) || Number(extractor.downtimeStartedAt) <= 0) {
        extractor.downtimeStartedAt = now;
      }
      // Enforce minimum downtime duration (15 minutes = 900,000 ms)
      const minDowntimeMs = 15 * 60 * 1000;
      const nowMs = now;
      const startedAt = Number(extractor.downtimeStartedAt);
      if (nowMs - startedAt < minDowntimeMs) {
        // Still within minimum downtime, cannot recover yet
        return;
      }
      // Per-tick recovery probability (default: 0.0276% per second)
      const lastTick = Number(extractor.lastTickAt || extractor.downtimeStartedAt || now);
      const intervalEnd = now;
      const elapsedMs = Math.max(0, intervalEnd - lastTick);
      const recoveryProbPerSec = 0.000276; // 0.0276% per second
      const tickSeconds = elapsedMs / 1000;
      const tickProb = 1 - Math.pow(1 - recoveryProbPerSec, tickSeconds);
      if (Math.random() < tickProb) {
        // Recovery!
        extractor.downtimeActive = false;
        extractor.downtimeRecoveredAt = now;
        extractor.downtimeStartedAt = null;
        // Resume mining: update lastTickAt so mining resumes from now
        extractor.lastTickAt = now;
      }
      // If not recovered, remain in downtime (mining paused)
      return;
    } else {
      // If not in downtime, always clear downtimeStartedAt
      extractor.downtimeStartedAt = null;
    }

    // Per-tick downtime probability (default: 0.005% per second)
    // If tick is longer than 1s, scale probability accordingly
    const lastTick = Number(extractor.lastTickAt || extractor.startedAt || now);
    const maxEnd = Number(extractor.endsAt || now);
    const intervalEnd = Math.min(now, maxEnd);
    const elapsedMs = Math.max(0, intervalEnd - lastTick);

    if (elapsedMs <= 0) {
      if (now >= maxEnd) {
        stopExtractorCycle(extractor, now);
      }
      return;
    }

    // Calculate downtime probability for this tick
    const probPerSec = extractorDowntimeProbPerSec(corp);
    const tickSeconds = elapsedMs / 1000;
    // Probability of at least one event in tickSeconds: P = 1 - (1 - p)^n
    const tickProb = 1 - Math.pow(1 - probPerSec, tickSeconds);
    if (Math.random() < tickProb) {
      // Trigger downtime
      extractor.downtimeActive = true;
      extractor.downtimeStartedAt = now;
      extractor.downtimeRecoveredAt = null;
      return; // Mining is paused this tick
    }

    // --- Normal mining logic ---
    const elapsedHours = elapsedMs / (60 * 60 * 1000);
    const throughput = Math.max(0, Number(extractor.throughputPerHour || 0));
    let efficiency = 1;
    if ((corp.unlockedTech || []).includes("tt-basic-extraction")) efficiency *= 1.1;
    if ((corp.unlockedTech || []).includes("tt-supply-forecast")) efficiency *= 1.06;
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

    const consumedMs = Math.round(elapsedMs * affordabilityRatio);
    extractor.lastTickAt = lastTick + consumedMs;

    if (affordabilityRatio < 1 || now >= maxEnd) {
      stopExtractorCycle(extractor, now);
    }
  });

  corp.mining.silicateExtractor = extractors[0];
}

