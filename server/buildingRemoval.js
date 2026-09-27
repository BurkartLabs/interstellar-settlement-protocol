// server/buildingRemoval.js: remove one building from a corporation cleanly (AB#2569).
//
// Nothing in ISP removed a building before this, and the model relied on it: an extractor yard is paired with its
// extractor record (by buildingId, server/game/buildingIds.js), a Refinery with the refinery record of the same order
// (server/upgrades.js, server/construction.js), and a lease counts its extractors and facilities as slots
// (public/scripts/leaseSlots.js). This takes the building and everything paired with it, in one change, so what is left
// agrees with itself. It exists for default recovery (AB#993: buildings force-sold to the ISA at 40% of what was paid,
// docs/design/v0.9-debt.md section 10). No route calls it.
//
// Call it inside mutateAccountState: that settles mining up to now first, so an extractor's cycle has delivered what it
// mined before its yard goes. What happens to work under way:
//   - an extractor's running cycle ends with the yard; its output so far was already delivered by that settle, and the
//     rest of the cycle is not charged;
//   - a refinery's completed run is delivered first (applyRefineryOperations); a run still going is abandoned and the
//     inputs it recorded at its start go back to the station they came from;
//   - probe fabrications and ship builds already queued and paid for complete as scheduled (their queues are checked
//     for the building only when an order is placed);
//   - a Cryo-vapor Extractor Array's slot on its lease is freed, so the extractors there lose its bonus.
// The Headquarters is refused (not-removable). The office, research and the level are not buildings, and nothing here
// touches them: a debtor is never removed from the game.
import { catalogueEntryFor, tierTableFor } from "./buildingTiers.js";
import { applyRefineryOperations } from "./game/refining.js";
import { getStationInventory } from "./game/catalog.js";

export const EXTRACTOR_YARD = "Basic Extractor Yard";
export const REFINERY = "Refinery";
export const CRYO_ARRAY = "Cryo-vapor Extractor Array";
/** Every corporation starts with its Headquarters; like the office, it is never taken, so a debtor stays in the game. */
export const NEVER_REMOVED = Object.freeze(["Headquarters"]);

const tierRows = (type, tier) => (tierTableFor(type) || []).filter((row) => row.toTier <= Math.floor(Number(tier) || 1));

/** What the building adds to corp.finances.assets: its catalogue asset value and every tier it was raised to. */
export function buildingAssetValue(building) {
  const type = catalogueEntryFor(building);
  if (!type) return 0;
  return (Number(type.assetValue) || 0) + tierRows(type, building.tier).reduce((s, row) => s + (Number(row.assetValue) || 0), 0);
}

/**
 * What the corporation paid for the building: `paid`, recorded by construction and upgrades since AB#2569. A building
 * built before then has none, so its base is the catalogue price plus the price of each tier it was raised to. For an
 * extractor yard that is the first yard's price, below what a later yard cost (ISP-303): it understates, never
 * overstates, what the corporation spent.
 */
export function buildingCostBasis(building) {
  if (Number.isFinite(building?.paid) && building.paid >= 0) return Math.round(building.paid);
  const type = catalogueEntryFor(building);
  if (!type) return 0;
  return (Number(type.cost) || 0) + tierRows(type, building.tier).reduce((s, row) => s + (Number(row.upgradeCost) || 0), 0);
}

/** The index of `building` among the corporation's buildings of the same name: what pairs a Refinery with its record. */
const orderAmongSame = (corp, building) => (corp.buildings || []).filter((b) => b?.name === building.name).indexOf(building);

function removeExtractor(corp, building) {
  const list = Array.isArray(corp.mining?.silicateExtractors) ? corp.mining.silicateExtractors : [];
  let at = list.findIndex((e) => e?.buildingId && e.buildingId === building.id);
  if (at < 0) at = orderAmongSame(corp, building) < list.length ? orderAmongSame(corp, building) : -1; // unlinked: by order
  if (at < 0) return { extractor: null };
  const [extractor] = list.splice(at, 1);
  for (const lease of corp.miningLeases || []) {
    if (Array.isArray(lease?.extractorIds)) lease.extractorIds = lease.extractorIds.filter((id) => id !== extractor.id);
  }
  if (corp.mining.silicateExtractor?.id === extractor.id) corp.mining.silicateExtractor = list[0] || null; // the legacy mirror
  return { extractor: extractor.id, stoppedCycle: Boolean(extractor.active) };
}

function removeRefinery(corp, building, now) {
  applyRefineryOperations(corp, now); // a run that has finished delivers before its refinery goes
  const list = Array.isArray(corp.refineries) ? corp.refineries : [];
  const at = orderAmongSame(corp, building);
  if (at < 0 || at >= list.length) return { refinery: null };
  const [ref] = list.splice(at, 1);
  const returned = [];
  if (ref.active && Array.isArray(ref.inputs) && ref.stationId) {
    const inv = getStationInventory(corp, ref.stationId);
    for (const { item, quantity } of ref.inputs) {
      if (typeof item !== "string" || !Number.isInteger(quantity) || quantity <= 0) continue;
      inv[item] = (Number(inv[item]) || 0) + quantity;
      returned.push({ item, quantity, stationId: ref.stationId });
    }
  }
  return { refinery: ref.id, abandonedRun: Boolean(ref.active), returned };
}

function removeFacility(corp, building) {
  const leases = corp.miningLeases || [];
  const lease = (building.leaseId && leases.find((l) => l?.id === building.leaseId))
    || leases.find((l) => Array.isArray(l?.facilities) && l.facilities.includes(building.name));
  if (!lease || !Array.isArray(lease.facilities)) return { lease: null };
  const at = lease.facilities.indexOf(building.name);
  if (at >= 0) lease.facilities.splice(at, 1);
  return { lease: lease.id };
}

/**
 * Remove the building `buildingId` from `corp`, with whatever is paired with it, at `now`. Returns
 * { outcome: "ok", name, costBasis, assetValue, ...what was taken with it } after the change, or { outcome } having
 * changed nothing: "unknown-building" when the corporation has no such building, "unknown-type" when the catalogue does
 * not know it (fails closed: nothing is removed half-understood).
 */
export function removeBuilding(corp, buildingId, now = Date.now()) {
  const building = (corp?.buildings || []).find((b) => typeof b?.id === "string" && b.id === buildingId);
  if (!building) return { outcome: "unknown-building" };
  if (NEVER_REMOVED.includes(building.name)) return { outcome: "not-removable", name: building.name };
  const type = catalogueEntryFor(building);
  if (!type || type.slot === "upgrade") return { outcome: "unknown-type", name: building.name };
  const costBasis = buildingCostBasis(building);
  const assetValue = buildingAssetValue(building);

  let taken = {};
  if (building.name === EXTRACTOR_YARD) taken = removeExtractor(corp, building);
  else if (building.name === REFINERY) taken = removeRefinery(corp, building, now);
  else if (type.slot === "corporation+lease") taken = removeFacility(corp, building);
  // Every other building (an Assembly Facility, a Ferric Mining Complex, an Orbital Shipyard) is its record alone:
  // what it does is read from whether it stands, so removing the record is removing the effect.

  corp.buildings = corp.buildings.filter((b) => b !== building);
  if (!corp.finances || typeof corp.finances !== "object") corp.finances = {};
  corp.finances.assets = Math.max(0, (Number(corp.finances.assets) || 0) - assetValue);
  return { outcome: "ok", name: building.name, costBasis, assetValue, ...taken };
}

/** The next number for a record id like `ext-basic-N` or `ref-N`: one past the highest in use, so never one in use. */
export function nextFreeIndex(records, prefix) {
  let max = 0;
  for (const r of records || []) {
    const m = String(r?.id || "").match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Math.max(max, (records || []).length) + 1;
}
