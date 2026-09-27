// ISP-180 (AB#874): defending: a garrison's posture, moving defense troops between stations, and deploying a hired
// fleet to the renter's own holdings, so a warned defender can reinforce before a raid arrives.
//
// docs/design/v0.10-raids-mercenaries.md, section 2a. Nothing here is required: an offline defender's garrison fights
// at arrival with whatever stands there, at its posture (balanced unless the player chose another). A reinforcement
// counts if it has arrived by the raid's arrival time, and not otherwise; raid resolution settles arrivals up to that
// moment, never later (server/raidResolution.js).
//
//   Postures (per station, for everything defending there): balanced, fortified (harder to hit, hits back less) and
//   aggressive (hits harder, easier to hit). They multiply the defending side's attack and evasion after research,
//   leadership and readiness (server/game/combat.js combatModifiersFor). Neither is always best: against the combat
//   design's worked raid with 12 defense troops, fortified holds the station and keeps more troops, and aggressive
//   kills more raiders but loses it.
//
// Every field is a number, an enum or an id checked against what exists. Time is passed in (P-TEST-TIME).

import { getAccountById, getState, mutateAccountState } from "./gameState.js";
import { accountIdOfCorp } from "./playerLoans.js";
import { ensureCorpMilitary } from "./game/units.js";
import { getTravelTimeMs } from "./travel.js";
import { stationById } from "./game/stations.js"; // ISP-209 (AB#904)
import { holdingsAt, reachable } from "./raids.js";

/** The postures and what each multiplies (the design's table, section 2a). */
export const POSTURES = Object.freeze({
  balanced: Object.freeze({ attack: 1, evasion: 1 }),
  fortified: Object.freeze({ attack: 0.8, evasion: 1.2 }),
  aggressive: Object.freeze({ attack: 1.2, evasion: 0.8 })
});
export const POSTURE_IDS = Object.freeze(Object.keys(POSTURES));

const corpOf = (accountId) => getAccountById(accountId)?.state?.corp ?? null;
const n = (x) => Math.max(0, Math.floor(Number(x) || 0));
let seq = 0;

/** A corporation's posture at a station: balanced unless it chose another. */
export const postureAt = (corp, stationId) => (POSTURE_IDS.includes(corp?.garrisonPostures?.[stationId]) ? corp.garrisonPostures[stationId] : "balanced");

/** The defending side's modifiers at a station: its own (research, leadership, readiness) times its posture's. */
export function withPosture(modifiers, posture) {
  const p = POSTURES[posture] || POSTURES.balanced;
  return { ...modifiers, attack: modifiers.attack * p.attack, evasion: modifiers.evasion * p.evasion };
}

/** Set the posture at a station where the corporation holds something. { ok, posture } or { ok: false, status, error }. */
export function setPosture(accountId, stationId, posture) {
  const corp = corpOf(accountId);
  if (!corp) return { ok: false, status: 404, error: "No such corporation." };
  if (!stationById(stationId)) return { ok: false, status: 404, error: "No such station." };
  if (!POSTURE_IDS.includes(posture)) return { ok: false, status: 400, error: `Choose a posture: ${POSTURE_IDS.join(", ")}.` };
  if (!holdingsAt(corp, stationId).any) return { ok: false, status: 409, error: "You hold nothing at that station to defend." };
  mutateAccountState(accountId, (state) => {
    if (!state.corp.garrisonPostures || typeof state.corp.garrisonPostures !== "object") state.corp.garrisonPostures = {};
    state.corp.garrisonPostures[stationId] = posture;
  }, { sanitize: false, settleMining: false });
  return { ok: true, stationId, posture };
}

/** How long troop arrivals are remembered: longer than any raid's warning, so resolution can tell what came late. */
const ARRIVALS_KEPT_MS = 2 * 86_400_000;

/**
 * Defense troops that have arrived by `now` join their station's garrison. Each arrival is remembered with its time
 * for two days (corp.garrisonArrivals), so a raid resolved late still counts only what had arrived by its own arrival
 * (troopsArrivedAfter). Changes `corp`. Returns how many arrived.
 */
export function settleGarrisonMoves(corp, now) {
  const moves = Array.isArray(corp?.garrisonMoves) ? corp.garrisonMoves : [];
  if (!moves.length) return 0;
  ensureCorpMilitary(corp);
  let arrived = 0;
  const arrivals = (Array.isArray(corp.garrisonArrivals) ? corp.garrisonArrivals : []).filter((a) => a.arrivedAt > now - ARRIVALS_KEPT_MS);
  corp.garrisonMoves = moves.filter((m) => {
    if (m.arrivesAt > now) return true;
    corp.military.garrisons[m.toStationId] = n(corp.military.garrisons[m.toStationId]) + n(m.quantity);
    arrivals.push({ stationId: m.toStationId, quantity: n(m.quantity), arrivedAt: m.arrivesAt });
    arrived += n(m.quantity);
    return false;
  });
  corp.garrisonArrivals = arrivals;
  return arrived;
}

/** Troops that joined `stationId`'s garrison after `at` (and so were not there when a raid arrived at `at`). */
export const troopsArrivedAfter = (corp, stationId, at) =>
  (Array.isArray(corp?.garrisonArrivals) ? corp.garrisonArrivals : []).filter((a) => a.stationId === stationId && a.arrivedAt > at).reduce((s, a) => s + n(a.quantity), 0);

/**
 * Send defense troops from one station's garrison to another, on the travel time between them and behind the same
 * research gates as a fleet. They leave at once and join on arrival. { ok, move } or { ok: false, status, error }.
 */
export function moveTroops(accountId, { fromStationId, toStationId, quantity } = {}, now = Date.now()) {
  const corp = corpOf(accountId);
  if (!corp) return { ok: false, status: 404, error: "No such corporation." };
  if (!stationById(fromStationId) || !stationById(toStationId)) return { ok: false, status: 404, error: "No such station." };
  if (fromStationId === toStationId) return { ok: false, status: 400, error: "Choose a different station to send them to." };
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, status: 400, error: "Send a whole number of troops, at least 1." };
  const here = n(corp.military?.garrisons?.[fromStationId]);
  if (quantity > here) return { ok: false, status: 409, error: `Only ${here} defense troops stand at that station.` };
  if (!reachable(corp.unlockedTech, fromStationId, toStationId)) return { ok: false, status: 409, error: "Your research does not reach that station yet." };
  const move = { id: `gm-${now.toString(36)}-${(++seq).toString(36)}`, fromStationId, toStationId, quantity, departedAt: now, arrivesAt: now + getTravelTimeMs(fromStationId, toStationId) };
  mutateAccountState(accountId, (state) => {
    const c = state.corp;
    settleGarrisonMoves(c, now);
    ensureCorpMilitary(c);
    c.military.garrisons[fromStationId] = n(c.military.garrisons[fromStationId]) - quantity;
    c.garrisonMoves = [...(Array.isArray(c.garrisonMoves) ? c.garrisonMoves : []), move];
    ensureCorpMilitary(c);
  }, { sanitize: false });
  return { ok: true, move };
}

/**
 * The renter sends a fleet it has hired to one of its own stations (the raid design, section 7: a defense contract
 * only helps where the renter holds something). The fleet travels on the usual time; it takes no order from its owner
 * meanwhile, as it takes none under contract. { ok, arrivesAt } or { ok: false, status, error }.
 */
export function deployHiredFleet(accountId, contractId, toStationId, now = Date.now()) {
  const renter = corpOf(accountId);
  const hired = (renter?.military?.hired || []).find((h) => h.contractId === contractId);
  const offer = (getState()?.market?.mercenaryOffers || []).find((o) => o.id === contractId && o.state === "hired" && o.renterCorpId === renter?.publicId);
  if (!hired || !offer) return { ok: false, status: 404, error: "No such hired fleet." };
  if (!stationById(toStationId)) return { ok: false, status: 404, error: "No such station." };
  if (!holdingsAt(renter, toStationId).any) return { ok: false, status: 409, error: "A hired fleet can only be sent to a station where you hold something." };
  const ownerAccountId = accountIdOfCorp(offer.ownerCorpId);
  const fleet = corpOf(ownerAccountId)?.military?.fleets?.find((f) => f.id === offer.fleetId);
  if (!fleet) return { ok: false, status: 404, error: "No such hired fleet." };
  if (fleet.transit && now < fleet.transit.arrivesAt) return { ok: false, status: 409, error: "That fleet is travelling." };
  const from = fleet.stationId || fleet.transit?.toStationId;
  if (from === toStationId) return { ok: false, status: 409, error: "That fleet is already there." };
  if (!reachable(renter.unlockedTech, from, toStationId)) return { ok: false, status: 409, error: "Your research does not reach that station yet." };
  const arrivesAt = now + getTravelTimeMs(from, toStationId);
  mutateAccountState(ownerAccountId, (state) => {
    const f = (state.corp.military?.fleets || []).find((x) => x.id === offer.fleetId);
    f.transit = { fromStationId: from, toStationId, toSystemId: stationById(toStationId).systemId, departedAt: now, arrivesAt };
    f.stationId = null;
  }, { sanitize: false });
  mutateAccountState(accountId, (state) => {
    const h = (state.corp.military?.hired || []).find((x) => x.contractId === contractId);
    if (h) h.stationId = toStationId;
  }, { sanitize: false });
  return { ok: true, contractId, toStationId, arrivesAt };
}
