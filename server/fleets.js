// server/fleets.js: fleets on the server (ISP-174, AB#868). A fleet is a named group of a corporation's units with a
// place: a station it is stationed at, or a trip it is on. The Fleet tab (ISP-175) reads this; raids (ISP-178) will
// send a fleet from where it stands.
//
// Units are counted once. corp.military.units holds how many of each type the corporation has (production, upkeep and
// power all read it); a fleet holds some of them, and what no fleet holds is the corporation's reserve. Forming,
// splitting, merging and disbanding only move units between fleets and the reserve, so the totals by type never
// change. Ships and Attack Troops go into fleets; Defense Troops stand in garrisons (ISP-172) and do not.
//
// A fleet forms, and disbands, at the station the corporation is docked at. It deploys to another station on the
// corporation's own travel times (server/travel.js) and research gates (public/scripts/navigation.js), and while it
// is in transit it cannot be split, merged, redeployed or disbanded.

import { NAVIGATION } from "./game/catalog.js";
import { ensureCorpMilitary } from "./game/units.js";
import { STATION_REGISTRY, getTravelTimeMs } from "./travel.js";

/** The unit types a fleet may hold. */
export const FLEET_UNIT_IDS = Object.freeze(["lf", "ds", "se", "at"]);
/** Fleet names come from this list, never from free text (all-ages play, and nothing to moderate). */
export const FLEET_NAMES = Object.freeze(["Vanguard", "Aegis", "Bastion", "Corsair", "Halberd", "Lancer", "Meridian", "Nomad",
  "Paladin", "Rampart", "Sentinel", "Talon", "Tempest", "Valkyrie", "Warden", "Zenith"]);
export const MAX_FLEETS = FLEET_NAMES.length;

const fleetsOf = (corp) => {
  ensureCorpMilitary(corp);
  if (!Array.isArray(corp.military.fleets)) corp.military.fleets = [];
  return corp.military.fleets;
};
const count = (units, id) => Math.max(0, Math.floor(Number(units?.[id]) || 0));
const sizeOf = (units) => FLEET_UNIT_IDS.reduce((sum, id) => sum + count(units, id), 0);
const inTransit = (fleet, now) => Boolean(fleet.transit) && now < fleet.transit.arrivesAt;
/** ISP-176 (AB#870): a fleet offered or hired out takes no order from its owner until the contract ends. */
const contracted = (fleet) => Boolean(fleet?.contract);

/** What no fleet holds: the corporation's units of each fleet type, less every fleet's. */
export function reserveOf(corp) {
  const fleets = corp?.military?.fleets || [];
  return Object.fromEntries(FLEET_UNIT_IDS.map((id) => [id, count(corp?.military?.units, id) - fleets.reduce((s, f) => s + count(f.units, id), 0)]));
}

/** A request's units, as whole counts of the fleet types; null when it names none. */
export function unitsFrom(input) {
  const units = Object.fromEntries(FLEET_UNIT_IDS.map((id) => [id, count(input, id)]));
  return sizeOf(units) > 0 ? units : null;
}

/** Fleets whose trip has ended are stationed where they were going. Returns the fleets that arrived. */
export function settleFleets(corp, now = Date.now()) {
  const arrived = [];
  for (const fleet of corp?.military?.fleets || []) {
    // ISP-178 (AB#872): a fleet out on a raid is not stationed at its target when it arrives; the raid resolves it
    if (fleet.transit && !fleet.transit.raidId && now >= fleet.transit.arrivesAt) {
      fleet.stationId = fleet.transit.toStationId;
      fleet.transit = null;
      arrived.push(fleet);
    }
  }
  return arrived;
}

function nameFor(corp, asked) {
  const taken = new Set((corp.military.fleets || []).map((f) => f.name));
  if (asked == null || asked === "") return FLEET_NAMES.find((n) => !taken.has(n)) || null;
  if (!FLEET_NAMES.includes(asked)) return { refused: "bad-name" };
  return taken.has(asked) ? { refused: "name-taken" } : asked;
}
function newFleet(corp, name, units, stationId, now) {
  return { id: `flt-${now}-${Math.random().toString(36).slice(2, 8)}`, name, units: { ...units }, stationId, transit: null, formedAt: now };
}
const owned = (corp, fleetId) => (corp?.military?.fleets || []).find((f) => f.id === fleetId) || null;

/** Form a fleet from the reserve at the station the corporation is docked at. */
export function formFleet(corp, { units: input, name } = {}, now = Date.now()) {
  const fleets = fleetsOf(corp);
  settleFleets(corp, now);
  const units = unitsFrom(input);
  if (!units) return { outcome: "no-units" };
  if (!corp.currentStationId) return { outcome: "not-docked" };
  if (fleets.length >= MAX_FLEETS) return { outcome: "too-many-fleets" };
  const reserve = reserveOf(corp);
  const short = FLEET_UNIT_IDS.find((id) => units[id] > reserve[id]);
  if (short) return { outcome: "not-in-reserve", unitId: short, have: reserve[short] };
  const chosen = nameFor(corp, name);
  if (chosen === null) return { outcome: "too-many-fleets" };
  if (chosen.refused) return { outcome: chosen.refused };
  const fleet = newFleet(corp, chosen, units, corp.currentStationId, now);
  fleets.push(fleet);
  return { outcome: "ok", fleet };
}

/** Split `units` off a fleet into a new one at the same station. */
export function splitFleet(corp, fleetId, { units: input, name } = {}, now = Date.now()) {
  fleetsOf(corp);
  settleFleets(corp, now);
  const fleet = owned(corp, fleetId);
  if (!fleet) return { outcome: "no-fleet" };
  if (contracted(fleet)) return { outcome: "under-contract" };
  if (inTransit(fleet, now)) return { outcome: "in-transit" };
  const units = unitsFrom(input);
  if (!units) return { outcome: "no-units" };
  const short = FLEET_UNIT_IDS.find((id) => units[id] > count(fleet.units, id));
  if (short) return { outcome: "not-in-fleet", unitId: short, have: count(fleet.units, short) };
  if (sizeOf(units) === sizeOf(fleet.units)) return { outcome: "split-everything" };
  if (corp.military.fleets.length >= MAX_FLEETS) return { outcome: "too-many-fleets" };
  const chosen = nameFor(corp, name);
  if (chosen === null) return { outcome: "too-many-fleets" };
  if (chosen.refused) return { outcome: chosen.refused };
  for (const id of FLEET_UNIT_IDS) fleet.units[id] = count(fleet.units, id) - units[id];
  const part = newFleet(corp, chosen, units, fleet.stationId, now);
  corp.military.fleets.push(part);
  return { outcome: "ok", fleet, part };
}

/** Merge a fleet into another at the same station; the first is gone afterwards. */
export function mergeFleets(corp, fleetId, intoFleetId, now = Date.now()) {
  fleetsOf(corp);
  settleFleets(corp, now);
  const from = owned(corp, fleetId), into = owned(corp, intoFleetId);
  if (!from || !into) return { outcome: "no-fleet" };
  if (contracted(from) || contracted(into)) return { outcome: "under-contract" };
  if (from === into) return { outcome: "same-fleet" };
  if (inTransit(from, now) || inTransit(into, now)) return { outcome: "in-transit" };
  if (from.stationId !== into.stationId) return { outcome: "not-together" };
  for (const id of FLEET_UNIT_IDS) into.units[id] = count(into.units, id) + count(from.units, id);
  corp.military.fleets = corp.military.fleets.filter((f) => f !== from);
  return { outcome: "ok", fleet: into, merged: from };
}

/** Disband a fleet at the station the corporation is docked at: its units go back to the reserve. */
export function disbandFleet(corp, fleetId, now = Date.now()) {
  fleetsOf(corp);
  settleFleets(corp, now);
  const fleet = owned(corp, fleetId);
  if (!fleet) return { outcome: "no-fleet" };
  if (contracted(fleet)) return { outcome: "under-contract" };
  if (inTransit(fleet, now)) return { outcome: "in-transit" };
  if (fleet.stationId !== corp.currentStationId) return { outcome: "not-here", stationId: fleet.stationId };
  corp.military.fleets = corp.military.fleets.filter((f) => f !== fleet);
  return { outcome: "ok", fleet };
}

/**
 * Send a fleet to another station, on the travel times the corporation's own ship keeps (server/travel.js) and behind
 * the same research gates (navigation.js canReachSystem, and a charted route).
 */
export function deployFleet(corp, fleetId, toStationId, now = Date.now()) {
  fleetsOf(corp);
  settleFleets(corp, now);
  const fleet = owned(corp, fleetId);
  if (!fleet) return { outcome: "no-fleet" };
  if (contracted(fleet)) return { outcome: "under-contract" };
  if (inTransit(fleet, now)) return { outcome: "in-transit" };
  const from = STATION_REGISTRY[fleet.stationId], to = STATION_REGISTRY[toStationId];
  if (!to) return { outcome: "no-station" };
  if (fleet.stationId === toStationId) return { outcome: "already-there" };
  const fromSystemId = from?.systemId || "sol";
  if (to.systemId !== fromSystemId) {
    if (!NAVIGATION.canReachSystem(corp.unlockedTech, fromSystemId, to.systemId)) return { outcome: "missing-research", fromSystemId, toSystemId: to.systemId };
    if (NAVIGATION.systemHops(fromSystemId, to.systemId) === null && to.systemId !== "sol") return { outcome: "no-route" };
  }
  const durationMs = getTravelTimeMs(fleet.stationId, toStationId);
  fleet.transit = { fromStationId: fleet.stationId, toStationId, toSystemId: to.systemId, departedAt: now, arrivesAt: now + durationMs };
  fleet.stationId = null;
  return { outcome: "ok", fleet, durationMs };
}

/**
 * ISP-175 (AB#869): where a stationed fleet can be sent, for the Fleet tab's destination picker: every other station,
 * with the trip's length by the same rule deployFleet uses and whether its research gate is open. Null for a fleet
 * that is not the corporation's; [] for one in transit.
 */
export function fleetDestinations(corp, fleetId, now = Date.now()) {
  settleFleets(corp, now);
  const fleet = owned(corp, fleetId);
  if (!fleet) return null;
  if (inTransit(fleet, now) || !fleet.stationId) return [];
  const fromSystemId = STATION_REGISTRY[fleet.stationId]?.systemId || "sol";
  return Object.values(STATION_REGISTRY).filter((st) => st.id !== fleet.stationId).map((st) => {
    const same = st.systemId === fromSystemId;
    const researched = same || NAVIGATION.canReachSystem(corp.unlockedTech, fromSystemId, st.systemId);
    const charted = same || NAVIGATION.systemHops(fromSystemId, st.systemId) !== null || st.systemId === "sol";
    return { stationId: st.id, name: st.name, systemId: st.systemId, travelMs: getTravelTimeMs(fleet.stationId, st.id), reachable: researched && charted, blocked: researched ? (charted ? null : "no-route") : "missing-research" };
  }).sort((a, b) => (b.reachable - a.reachable) || (a.travelMs - b.travelMs));
}
