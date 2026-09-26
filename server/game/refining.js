// server/game/refining.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { REFINERY_CHAINS, getStationInventory } from "./catalog.js";
import { bumpStat } from "./progression.js";
import { ECONOMY } from "../economy.js";
// ISP-97 (AB#787): a Refinery Complex (tier 2) delivers 1.5 times; the rule is shared with the page and the receipt.
import { refineryMultiplierFor, refineryOutput } from "../../public/scripts/refineryOutput.js";

// ─── Refinery model ──────────────────────────────────────────────────────────
export function ensureCorpRefineryModel(corp) {
  if (!Array.isArray(corp.refineries)) {
    corp.refineries = [];
  }

  // Sync refineries array with built Refinery buildings
  const builtCount = (corp.buildings || []).filter((b) => b.name === "Refinery").length;
  while (corp.refineries.length < builtCount) {
    const idx = corp.refineries.length + 1;
    corp.refineries.push({
      id: `ref-${idx}`,
      name: `Refinery #${idx}`,
      tier: 1,
      active: false,
      chainId: null,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      cyclesCompleted: 0,
      totalInputConsumed: 0,
      totalOutputProduced: 0
    });
  }

  corp.refineries = corp.refineries.map((ref, i) => ({
    id: String(ref.id || `ref-${i + 1}`),
    name: String(ref.name || `Refinery #${i + 1}`),
    tier: Number(ref.tier || 1),
    active: Boolean(ref.active),
    chainId: ref.chainId ?? null,
    stationId: ref.active ? refineryCycleStation(corp, ref) : null,
    cycleScale: Math.max(1, Number(ref.cycleScale || 1)),
    startedAt: ref.startedAt ?? null,
    lastTickAt: ref.lastTickAt ?? null,
    endsAt: ref.endsAt ?? null,
    cyclesCompleted: Number(ref.cyclesCompleted || 0),
    totalInputConsumed: Number(ref.totalInputConsumed || 0),
    totalOutputProduced: Number(ref.totalOutputProduced || 0),
    // AB#794: while an upgrade is under way the refinery is offline until this time (ms); no run starts before it.
    upgradingUntil: Number(ref.upgradingUntil) > 0 ? Number(ref.upgradingUntil) : null
  }));
}

// The station a running cycle delivers to: the one its inputs came from, recorded by start-refinery (Bug #692).
// A cycle started before that field existed is pinned once, at its first touch, to where the corporation is
// then, or to Earth Station Prime if it is in transit, so its outputs always land somewhere.
export function refineryCycleStation(corp, ref) {
  if (ref.stationId) return String(ref.stationId);
  const pinned = corp.currentStationId || "earth-station-prime";
  console.warn(`[refinery] Bug #692: running cycle on ${ref.id || "a refinery"} had no station; pinned to ${pinned}.`);
  return pinned;
}

export function applyRefineryOperations(corp, now = Date.now()) {
  ensureCorpRefineryModel(corp);

  corp.refineries.forEach((ref) => {
    if (!ref.active || !ref.chainId) return;

    const chain = REFINERY_CHAINS[ref.chainId];
    if (!chain) {
      ref.active = false;
      ref.stationId = null;
      return;
    }

    const endsAt = Number(ref.endsAt || 0);
    if (!endsAt || now < endsAt) return;

    // Cycle complete — produce outputs at the station the cycle started at, scaled by the
    // number of batches the player queued (refinery `cycleScale`, default 1).
    if (!corp.inventory) corp.inventory = {};
    const refStationInv = getStationInventory(corp, ref.stationId);
    const scale = Math.max(1, Number(ref.cycleScale || 1));
    for (const output of chain.outputs) {
      const produced = refineryOutput(output.quantityPerCycle, scale, ref.tier, refineryMultiplierFor(ref.tier, ECONOMY.buildings)); // AB#794: by tier
      bumpStat(corp, "refinedUnitsProduced", produced); // Bug #424: levels 9 and 10
      refStationInv[output.item] = (refStationInv[output.item] || 0) + produced;
      ref.totalOutputProduced += produced;
    }

    ref.cyclesCompleted += scale;
    ref.active = false;
    ref.chainId = null;
    ref.stationId = null;
    ref.cycleScale = 1;
    ref.startedAt = null;
    ref.lastTickAt = null;
    ref.endsAt = null;
  });
}

