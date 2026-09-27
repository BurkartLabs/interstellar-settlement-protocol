// server/game/refining.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { REFINERY_CHAINS, getStationInventory } from "./catalog.js";
import { bumpStat, COUNTED_STATS } from "./progression.js";
import { ECONOMY } from "../economy.js";
// ISP-97 (AB#787): a Refinery Complex (tier 2) delivers 1.5 times; the rule is shared with the page and the receipt.
import { refineryMultiplierFor, refineryOutput } from "../../public/scripts/refineryOutput.js";

// ─── Facilities that run chains ──────────────────────────────────────────────
// ISP-189 (AB#883; docs/design/v0.11-tier4.md, section 3): a chain names the building it runs in. Refineries run the
// v0.8 chains; the Synthesis Array runs the Tier 4 ones. Each kind keeps its own list on the corporation, so a
// Refinery Complex still upgrades the n-th Refinery (server/construction.js), and both lists run through one engine.
export const FACILITY_LISTS = Object.freeze({ refinery: "refineries", "synthesis-array": "synthesisArrays" });
const FACILITY_NAMES = Object.freeze({ refinery: "Refinery", "synthesis-array": "Synthesis Array" });

/** The building a chain runs in: its `building`, or a Refinery for every chain from before Tier 4. */
export function chainBuilding(chain) {
  return chain?.building || "refinery";
}

// ─── Refinery model ──────────────────────────────────────────────────────────
export function ensureCorpRefineryModel(corp) {
  if (!Array.isArray(corp.refineries)) {
    corp.refineries = [];
  }
  ensureCorpSynthesisModel(corp); // ISP-189 (AB#883)

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

  corp.refineries = corp.refineries.map((ref, i) => facilityRecord(corp, ref, i, "ref", "Refinery"));
}

/**
 * ISP-189 (AB#883): the Synthesis Array's record, one per built Synthesis Array, the same shape as a refinery's (tier 1:
 * it has no upgrades), so the start route and the tick treat both alike.
 */
function ensureCorpSynthesisModel(corp) {
  if (!Array.isArray(corp.synthesisArrays)) corp.synthesisArrays = [];
  const built = (corp.buildings || []).filter((b) => b.name === FACILITY_NAMES["synthesis-array"]).length;
  while (corp.synthesisArrays.length < built) {
    const idx = corp.synthesisArrays.length + 1;
    corp.synthesisArrays.push({ id: `syn-${idx}`, name: idx === 1 ? "Synthesis Array" : `Synthesis Array #${idx}`, tier: 1, active: false, chainId: null });
  }
  corp.synthesisArrays = corp.synthesisArrays.map((ref, i) => facilityRecord(corp, ref, i, "syn", "Synthesis Array"));
}

/** A facility's record, normalised: a refinery's or a Synthesis Array's. */
function facilityRecord(corp, ref, i, prefix, label) {
  return {
    id: String(ref.id || `${prefix}-${i + 1}`),
    name: String(ref.name || `${label} #${i + 1}`),
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
    upgradingUntil: Number(ref.upgradingUntil) > 0 ? Number(ref.upgradingUntil) : null,
    // AB#825: what a running cycle took and will deliver, recorded at its start. A cycle started before the record
    // existed has none, and completes from its chain as before.
    inputs: ref.active ? runRecord(ref.inputs) : null,
    outputs: ref.active ? runRecord(ref.outputs) : null
  };
}

/** A run's `[{ item, quantity }]` record as stored, or null when there is none or it is not a list of whole amounts. */
function runRecord(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const ok = list.every((e) => typeof e?.item === "string" && e.item && Number.isInteger(e.quantity) && e.quantity >= 0);
  return ok ? list.map((e) => ({ item: e.item, quantity: e.quantity })) : null;
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
  // ISP-189 (AB#883): the Synthesis Array's runs complete exactly as a refinery's do.
  for (const list of Object.values(FACILITY_LISTS)) (corp[list] || []).forEach((ref) => completeRun(corp, ref, now));
}

/** Deliver a facility's run if it has finished, and free the facility. */
function completeRun(corp, ref, now) {
  {
    if (!ref.active || !ref.chainId) return;

    // AB#825: a cycle delivers what it recorded at its start, even if its chain has since changed or gone. One started
    // before the record existed (the deploy that added it) completes from its chain, as it always did.
    const chain = Object.hasOwn(REFINERY_CHAINS, ref.chainId) ? REFINERY_CHAINS[ref.chainId] : null;
    if (!ref.outputs && !chain) {
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
    const delivered = ref.outputs || chain.outputs.map((output) => ({
      item: output.item,
      quantity: refineryOutput(output.quantityPerCycle, scale, ref.tier, refineryMultiplierFor(ref.tier, ECONOMY.buildings)) // AB#794: by tier
    }));
    for (const { item, quantity } of delivered) {
      bumpStat(corp, "refinedUnitsProduced", quantity); // Bug #424: levels 9 and 10
      // AB#831: per product. A run's record names only catalog items (server/game/items.js refuses any other at start),
      // but a record from an older save is checked rather than trusted.
      if (COUNTED_STATS.includes(`manufactured:${item}`)) bumpStat(corp, `manufactured:${item}`, quantity);
      refStationInv[item] = (refStationInv[item] || 0) + quantity;
      ref.totalOutputProduced += quantity;
    }

    ref.cyclesCompleted += scale;
    ref.active = false;
    ref.chainId = null;
    ref.stationId = null;
    ref.cycleScale = 1;
    ref.inputs = null;
    ref.outputs = null;
    ref.startedAt = null;
    ref.lastTickAt = null;
    ref.endsAt = null;
  }
}

