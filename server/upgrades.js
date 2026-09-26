// server/upgrades.js: upgrading one of a corporation's buildings by a tier (ISP-101, AB#793). The design, its numbers
// and why they make upgrading a decision are docs/design/upgrades.md (AB#791). Only the Basic Extractor Yard has tiers
// so far; the other catalogue buildings get theirs in AB#794, and until then an upgrade of one is refused.
//
// Everything is decided here, on the server, from data/economy.json and the caller's own state: the building is found
// by the id AB#792 gave it, and the cost, the effect and every limit come from the tier table. The request carries the
// id and nothing else. A refusal changes nothing (upgradeBuilding returns before its first write).

import { yardMaxTier, yardUpgradeTo } from "./economy.js";
import { applyCredits } from "./finances.js";
import { PLAYER_BUILDING_CATALOGUE } from "./playerBuildings.js";

const HOUR_MS = 60 * 60 * 1000;
const YARD_ID = "basic-extractor-yard";

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
  const type = PLAYER_BUILDING_CATALOGUE.find((b) => b.name === building.name);
  // Fail closed: a building the catalogue cannot resolve, or one without tiers yet, is not upgraded.
  if (!type) return { outcome: "no-upgrades", name: building.name };
  if (type.id !== YARD_ID) return { outcome: "no-upgrades", name: type.name };

  const tier = Math.floor(Number(building.tier) || 1);
  const lastTier = yardMaxTier();
  if (tier >= lastTier) return { outcome: "last-tier", name: type.name, tier, lastTier };
  const next = tier + 1;
  const row = yardUpgradeTo(next);
  if (!row) return { outcome: "no-upgrades", name: type.name };
  const allowed = maxUpgradeTierOf(corp);
  if (next > allowed) return { outcome: "level-too-low", name: type.name, next, allowed };

  const extractor = (corp.mining?.silicateExtractors || []).find((e) => e?.buildingId === building.id);
  if (!extractor) return { outcome: "no-extractor", name: type.name };
  if (extractor.active) return { outcome: "running", name: extractor.name || type.name };
  if (Number(extractor.upgradingUntil) > now) return { outcome: "already-upgrading", name: extractor.name || type.name, until: Number(extractor.upgradingUntil) };
  if ((Number(corp.finances?.credits) || 0) < row.upgradeCost) return { outcome: "insufficient-credits", cost: row.upgradeCost };

  applyCredits(corp, -row.upgradeCost, "construction");
  corp.finances.assets = (Number(corp.finances.assets) || 0) + row.assetValue;
  building.tier = next;
  extractor.tier = next;
  extractor.upgradingUntil = now + row.offlineHours * HOUR_MS;
  return {
    outcome: "ok",
    name: extractor.name || type.name,
    tier: next,
    cost: row.upgradeCost,
    assetValue: row.assetValue,
    offlineUntil: extractor.upgradingUntil,
    throughputCap: row.throughputCap,
    throughputReferencePerHour: row.throughputReferencePerHour
  };
}

/** The player-facing reason for a refusal. It names no id and never repeats the request. */
export function upgradeRefusal(result, formatCredits, formatUtc) {
  switch (result.outcome) {
    case "unknown-building": return "That is not one of your buildings.";
    case "no-upgrades": return `The ${result.name} has no upgrades yet.`;
    case "last-tier": return `The ${result.name} is at tier ${result.tier}, its last.`;
    case "level-too-low": return `Your corporation's level allows tier ${result.allowed}; tier ${result.next} needs a higher Corporation Level.`;
    case "no-extractor": return `The ${result.name} has no extractor linked to it, so it cannot be upgraded.`;
    case "running": return `${result.name} is running a mining cycle. Stop it or let it finish before upgrading: the yard is offline while it upgrades.`;
    case "already-upgrading": return `${result.name} is already being upgraded, until ${formatUtc(result.until)}.`;
    case "insufficient-credits": return `The upgrade costs ${formatCredits(result.cost)}.`;
    default: return "The upgrade could not be made.";
  }
}
