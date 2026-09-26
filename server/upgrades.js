// server/upgrades.js: upgrading one of a corporation's buildings by a tier (ISP-101, AB#793; every catalogue building,
// ISP-102, AB#794). The design, its numbers and why they make upgrading a decision are docs/design/upgrades.md
// (AB#791). A building's tiers are its catalogue entry's table (server/buildingTiers.js); one marked "none" is refused.
//
// Everything is decided here, on the server, from data/economy.json and the caller's own state: the building is found
// by the id AB#792 gave it, and the cost, the effect and every limit come from the tier table. The request carries the
// id and nothing else. A refusal changes nothing (upgradeBuilding returns before its first write).

import { applyCredits } from "./finances.js";
import { catalogueEntryFor, fabricationMsFor, tierTableFor } from "./buildingTiers.js";
import { hasResearchFor, PLAYER_BUILDING_CATALOGUE } from "./playerBuildings.js";
import { PROBE_FABRICATION_MS } from "./game/asteroids.js";

const HOUR_MS = 60 * 60 * 1000;
const inWords = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`);

/**
 * Where each tiered type keeps what it runs, what "busy" means for it, and what a tier's row changes, in words for the
 * receipt. The record's tier is what the game reads; the building's tier is what the player sees and the route checks.
 */
const TYPES = {
  "basic-extractor-yard": {
    // AB#792: each extractor names its yard's building id.
    record: (corp, building) => (corp.mining?.silicateExtractors || []).find((e) => e?.buildingId === building.id) || null,
    busy: (corp, record) => (record.active ? "a mining cycle" : ""),
    effect: (row) => ({ label: "Throughput cap", value: `${row.throughputCap} tons per hour` })
  },
  refinery: {
    // The n-th Refinery building and the n-th refinery record are pushed together and never removed (server/construction.js).
    record: (corp, building) => {
      const own = (corp.buildings || []).filter((b) => b?.name === building.name);
      return (Array.isArray(corp.refineries) ? corp.refineries[own.indexOf(building)] : null) || null;
    },
    busy: (corp, record) => (record.active ? "a production run" : ""),
    effect: (row) => ({ label: "Output per run", value: `${row.outputMultiplier} times every output` })
  },
  "assembly-facility": {
    // The facility's state is the corporation's fabrication queue; the building itself carries the tier and downtime.
    record: (_corp, building) => building,
    busy: (corp) => ((corp.asteroidMining?.fabricationQueue || []).length ? "a probe fabrication" : ""),
    effect: (row) => ({ label: "Probe fabrication", value: `${inWords(fabricationMsFor(row.toTier, PROBE_FABRICATION_MS))} each` })
  }
};

/** The corporation's highest allowed tier, from its level's unlocks (data/milestones.json, AB#791), never below 1. */
export function maxUpgradeTierOf(corp) {
  return Math.max(1, Math.floor(Number(corp?.unlocks?.maxUpgradeTier) || 1));
}

/**
 * Upgrade the building `buildingId` of `corp` by one tier, at `now`. Returns { outcome: "ok", ... } after charging
 * and applying it, or { outcome: <reason>, ... } having changed nothing.
 */
export function upgradeBuilding(corp, buildingId, now = Date.now()) {
  const building = (corp?.buildings || []).find((b) => typeof b?.id === "string" && b.id === buildingId);
  if (!building) return { outcome: "unknown-building" };
  const type = catalogueEntryFor(building);
  const table = tierTableFor(type);
  const kind = type && TYPES[type.id];
  // Fail closed: a building the catalogue cannot resolve, one marked "no tiers", or a type with no rules here.
  if (!type || !table?.length || !kind) return { outcome: "no-upgrades", name: type?.name || building.name };

  const tier = Math.floor(Number(building.tier) || 1);
  const lastTier = 1 + table.length;
  if (tier >= lastTier) return { outcome: "last-tier", name: type.name, tier, lastTier };
  const next = tier + 1;
  const row = table.find((r) => r.toTier === next);
  if (!row) return { outcome: "no-upgrades", name: type.name };
  const allowed = maxUpgradeTierOf(corp);
  if (next > allowed) return { outcome: "level-too-low", name: type.name, next, allowed };
  // A tier the catalogue sells as an upgrade building keeps that building's research gate (the Refinery Complex's).
  const via = row.via ? PLAYER_BUILDING_CATALOGUE.find((b) => b.id === row.via) : null;
  if (row.via && (!via || !hasResearchFor(via, corp))) return { outcome: "missing-research", name: type.name };

  const record = kind.record(corp, building);
  if (!record) return { outcome: "no-record", name: type.name };
  const label = record.name || type.name;
  const busy = kind.busy(corp, record);
  if (busy) return { outcome: "running", name: label, busy };
  if (Number(record.upgradingUntil) > now) return { outcome: "already-upgrading", name: label, until: Number(record.upgradingUntil) };
  if ((Number(corp.finances?.credits) || 0) < row.upgradeCost) return { outcome: "insufficient-credits", cost: row.upgradeCost };

  applyCredits(corp, -row.upgradeCost, "construction");
  corp.finances.assets = (Number(corp.finances.assets) || 0) + row.assetValue;
  building.tier = next;
  record.tier = next;
  if (row.offlineHours > 0) record.upgradingUntil = now + row.offlineHours * HOUR_MS;
  // The same Refinery either way: buying tier 2 here records the Refinery Complex as the build route does (AB#787),
  // which the level ladder's building: metric counts.
  if (via && !(building.upgrades || []).includes(via.name)) building.upgrades = [...(building.upgrades || []), via.name];
  return {
    outcome: "ok",
    type: type.id,
    name: label,
    tier: next,
    cost: row.upgradeCost,
    assetValue: row.assetValue,
    offlineUntil: row.offlineHours > 0 ? record.upgradingUntil : null,
    effect: kind.effect(row),
    throughputCap: row.throughputCap
  };
}

/** The player-facing reason for a refusal. It names no id and never repeats the request. */
export function upgradeRefusal(result, formatCredits, formatUtc) {
  switch (result.outcome) {
    case "unknown-building": return "That is not one of your buildings.";
    case "no-upgrades": return `The ${result.name} has no upgrades.`;
    case "last-tier": return `The ${result.name} is at tier ${result.tier}, its last.`;
    case "level-too-low": return `Your corporation's level allows tier ${result.allowed}; tier ${result.next} needs a higher Corporation Level.`;
    case "missing-research": return `The ${result.name}'s next tier needs research you do not have yet.`;
    case "no-record": return `The ${result.name} has nothing linked to it to upgrade.`;
    case "running": return `${result.name} is running ${result.busy}. Stop it or let it finish before upgrading.`;
    case "already-upgrading": return `${result.name} is already being upgraded, until ${formatUtc(result.until)}.`;
    case "insufficient-credits": return `The upgrade costs ${formatCredits(result.cost)}.`;
    default: return "The upgrade could not be made.";
  }
}
