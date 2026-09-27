// ISP-178 (AB#872): declaring a raid, recalling it, and the defender's warning.
//
// docs/design/v0.10-raids-mercenaries.md, sections 1, 2 and 4, on the Board's answer to D-0.10-1 (AB#705): "14 day
// new player protection. No offline protection." A raid is one fleet sent against one corporation's holdings at one
// station. Declaring it checks, on the server and in this order, that:
//   - the attacker is past its own 14 days (assumed: a protected corporation cannot raid either);
//   - the target is a corporation that exists, is not the attacker, and is past its 14 days (server time, from the
//     account's creation);
//   - the target is not in its post-raid cooldown (set when a raid on it resolves, ISP-179);
//   - the attacker has declared fewer than 2 raids on this target in the last 7 days, and fewer than 6 in the last hour;
//   - the target has holdings at the station (a garrison, a fleet, goods, or a building standing there);
//   - the fleet is the attacker's own, at its origin, not in transit and not under contract, or a fleet it has hired
//     whose contract permits raids; and the target station is reachable on the attacker's research.
// Nothing reads whether the defender is online (DEPTH: nothing may punish absence; the Board: no offline protection).
// On success the fleet leaves at once and arrives at declaredAt + max(travel time, 4 hours); the defender is told who,
// where, when, and what is coming (unit counts). Resolution at arrival is ISP-179's; until then the attacker may recall.
//
// A raid is a record in world state (`market.raids`), driven by stored times, so it survives a restart mid-flight.
// No account id is stored: both sides are corporation publicIds. Time is passed in (P-TEST-TIME).

import { addAccountNotification, getAccountById, getState, mutateAccountState, mutateState } from "./gameState.js";
import { emitToAccount } from "./realtime.js";
import { accountIdOfCorp } from "./playerLoans.js";
import { NAVIGATION } from "./game/catalog.js";
import { UNITS, ensureCorpMilitary } from "./game/units.js";
import { FLEET_UNIT_IDS } from "./fleets.js";
import { getTravelTimeMs } from "./travel.js";
import { stationById } from "./game/stations.js"; // ISP-209 (AB#904)
import { mercenaryUseAllowed } from "./mercenaries.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The design's numbers (sections 2 to 4); each marked assumed there is one the Board may change. */
export const RAID_RULES = Object.freeze({
  protectionDays: 14,
  warningFloorHours: 4,
  repeat: { max: 2, days: 7 },
  rate: { max: 6, hours: 1 },
  homeStationId: "earth-station-prime" // every corporation is founded here; buildings not on a lease stand here
});

const corpOf = (accountId) => getAccountById(accountId)?.state?.corp ?? null;
const unitCount = (units, id) => Math.max(0, Math.floor(Number(units?.[id]) || 0));
const allRaids = () => (Array.isArray(getState()?.market?.raids) ? getState().market.raids : []);
function raidsDraft(draft) {
  if (!draft.market || typeof draft.market !== "object") draft.market = {};
  if (!Array.isArray(draft.market.raids)) draft.market.raids = [];
  return draft.market.raids;
}
let seq = 0;

/** Whether a corporation is still inside its new-player protection at `now`, from its account's creation. */
export function protectedUntil(accountId) {
  const createdAt = Number(getAccountById(accountId)?.createdAt);
  return Number.isFinite(createdAt) ? createdAt + RAID_RULES.protectionDays * DAY : Infinity;
}

/**
 * The buildings that stand at a station, as the raid design places them (section 1): one on a lease stands at the
 * station whose body is the lease's body; every other building stands at the corporation's home station. The
 * Headquarters is never a target. Returns the corp.buildings entries themselves (the caller may change them in a draft).
 */
export function buildingsAtStation(corp, stationId) {
  const station = stationById(stationId);
  if (!corp || !station) return [];
  const leaseBody = new Map((corp.miningLeases || []).map((l) => [l.id, l.body]));
  const home = stationId === (corp.homeStationId || RAID_RULES.homeStationId);
  return (corp.buildings || []).filter((b) => b?.name && b.name !== "Headquarters" && (b.leaseId ? leaseBody.get(b.leaseId) === station.body : home));
}

/**
 * What a corporation holds at a station, as the raid design counts it (section 1): its defense troops there, its fleets
 * stationed there, its goods there, and the buildings standing there (on a lease whose body the station serves, or, for
 * any other building, at its home station). Pure.
 */
export function holdingsAt(corp, stationId) {
  const station = stationById(stationId);
  if (!corp || !station) return { any: false };
  const garrison = unitCount(corp.military?.garrisons?.[stationId], "dt");
  const fleets = (corp.military?.fleets || []).filter((f) => f.stationId === stationId && !f.transit).length;
  const goods = Object.values(corp.inventory?.[stationId] || {}).reduce((a, q) => a + Math.max(0, Number(q) || 0), 0);
  const buildings = buildingsAtStation(corp, stationId).length;
  return { any: garrison + fleets + goods + buildings > 0, garrison, fleets, goods, buildings };
}

/** The fleet a raid would send: the attacker's own, or one it has hired for raids. { fleet, ownerAccountId, contractId } or { error }. */
function fleetFor(attackerAccountId, attacker, { fleetId, contractId }, now) {
  if (contractId) {
    const hired = (attacker.military?.hired || []).find((h) => h.contractId === contractId);
    if (!hired) return { status: 404, error: "No such hired fleet." };
    if (!mercenaryUseAllowed(hired, "raids")) return { status: 409, error: "That contract does not permit raids." };
    const offer = (getState()?.market?.mercenaryOffers || []).find((o) => o.id === contractId && o.state === "hired");
    const ownerAccountId = offer ? accountIdOfCorp(offer.ownerCorpId) : null;
    const owner = ownerAccountId ? corpOf(ownerAccountId) : null;
    const fleet = owner?.military?.fleets?.find((f) => f.id === offer.fleetId);
    if (!fleet) return { status: 404, error: "No such hired fleet." };
    if (fleet.transit) return { status: 409, error: "That fleet is travelling." };
    return { fleet, ownerAccountId, contractId, ownerCorpId: offer.ownerCorpId };
  }
  const fleet = (attacker.military?.fleets || []).find((f) => f.id === fleetId);
  if (!fleet) return { status: 404, error: "No such fleet." };
  if (fleet.contract) return { status: 409, error: "That fleet is offered or hired out, and takes no order from you until its contract ends." };
  if (fleet.transit && now < fleet.transit.arrivesAt) return { status: 409, error: "That fleet is travelling." };
  if (!fleet.stationId) return { status: 409, error: "That fleet is not at a station." };
  return { fleet, ownerAccountId: attackerAccountId, contractId: null, ownerCorpId: attacker.publicId };
}

/** Whether the attacker's research reaches `toStationId` from `fromStationId` (the same gate a deployment uses). */
export function reachable(unlockedTech, fromStationId, toStationId) {
  const fromSystemId = stationById(fromStationId)?.systemId || "sol";
  const toSystemId = stationById(toStationId)?.systemId;
  if (!toSystemId) return false;
  if (toSystemId === fromSystemId) return true;
  return NAVIGATION.canReachSystem(unlockedTech, fromSystemId, toSystemId) && (NAVIGATION.systemHops(fromSystemId, toSystemId) !== null || toSystemId === "sol");
}

const unitsText = (units) => FLEET_UNIT_IDS.filter((id) => unitCount(units, id) > 0).map((id) => `${unitCount(units, id)} ${UNITS[id].name}`).join(", ");
const utc = (t) => new Date(t).toUTCString().replace(/:\d\d GMT$/, " UTC");
function tell(accountId, title, body) {
  const n = accountId ? addAccountNotification(accountId, { type: "military", title, body }) : null;
  if (n) emitToAccount(accountId, "notifications:new", { accountId, notification: n });
}

/** A raid as either side may see it: corporation names and public ids, stations, times and the attacking units. */
export function raidView(r) {
  const { id, attackerCorpId, attackerName, targetCorpId, targetName, originStationId, targetStationId, units, declaredAt, arrivesAt, returnsAt, state, hired } = r;
  return { id, attackerCorpId, attackerName, targetCorpId, targetName, originStationId, targetStationId, units, declaredAt, arrivesAt, returnsAt: returnsAt ?? null, state, hired: Boolean(hired) };
}

/**
 * Declare a raid: { ok: true, raid } or { ok: false, status, error }, with nothing changed on a refusal.
 * `input`: { fleetId } for an own fleet or { contractId } for a hired one, and { targetCorpId, targetStationId }.
 */
export function declareRaid(accountId, input = {}, now = Date.now()) {
  const attacker = corpOf(accountId);
  if (!attacker?.publicId) return { ok: false, status: 404, error: "No such corporation." };
  if (now < protectedUntil(accountId)) return { ok: false, status: 409, error: `Your corporation cannot raid until its first ${RAID_RULES.protectionDays} days are over.` };

  const targetCorpId = typeof input.targetCorpId === "string" ? input.targetCorpId : "";
  const targetAccountId = targetCorpId ? accountIdOfCorp(targetCorpId) : null;
  const target = targetAccountId ? corpOf(targetAccountId) : null;
  if (!target) return { ok: false, status: 404, error: "No such corporation." };
  if (targetAccountId === accountId) return { ok: false, status: 400, error: "A corporation cannot raid itself." };
  if (now < protectedUntil(targetAccountId)) return { ok: false, status: 409, error: `That corporation is under new-player protection for its first ${RAID_RULES.protectionDays} days.` };
  if (Number(target.raidCooldownUntil) > now) return { ok: false, status: 409, error: "That corporation was raided recently and is protected until its cooldown ends." };

  const mine = allRaids().filter((r) => r.attackerCorpId === attacker.publicId);
  if (mine.filter((r) => r.declaredAt > now - RAID_RULES.rate.hours * HOUR).length >= RAID_RULES.rate.max) return { ok: false, status: 429, error: `At most ${RAID_RULES.rate.max} raids may be declared in an hour.` };
  if (mine.filter((r) => r.targetCorpId === targetCorpId && r.declaredAt > now - RAID_RULES.repeat.days * DAY).length >= RAID_RULES.repeat.max) {
    return { ok: false, status: 409, error: `At most ${RAID_RULES.repeat.max} raids on the same corporation in ${RAID_RULES.repeat.days} days.` };
  }

  const targetStationId = typeof input.targetStationId === "string" ? input.targetStationId : "";
  if (!stationById(targetStationId)) return { ok: false, status: 404, error: "No such station." };
  if (!holdingsAt(target, targetStationId).any) return { ok: false, status: 409, error: "That corporation holds nothing at that station." };

  const pick = fleetFor(accountId, attacker, { fleetId: typeof input.fleetId === "string" ? input.fleetId : "", contractId: typeof input.contractId === "string" ? input.contractId : "" }, now);
  if (pick.error) return { ok: false, status: pick.status, error: pick.error };
  if (pick.ownerCorpId === targetCorpId) return { ok: false, status: 400, error: "A hired fleet cannot raid its own owner." };
  const originStationId = pick.fleet.stationId;
  if (!reachable(attacker.unlockedTech, originStationId, targetStationId)) return { ok: false, status: 409, error: "Your research does not reach that station yet." };
  const units = Object.fromEntries(FLEET_UNIT_IDS.map((id) => [id, unitCount(pick.fleet.units, id)]));
  if (!FLEET_UNIT_IDS.some((id) => units[id] > 0)) return { ok: false, status: 409, error: "That fleet has no units." };

  const travelMs = getTravelTimeMs(originStationId, targetStationId);
  const arrivesAt = now + Math.max(travelMs, RAID_RULES.warningFloorHours * HOUR);
  const raid = {
    id: `raid-${now.toString(36)}-${(++seq).toString(36)}`,
    attackerCorpId: attacker.publicId, attackerName: attacker.corporationName ?? null,
    targetCorpId, targetName: target.corporationName ?? null,
    originStationId, targetStationId,
    fleet: { ownerCorpId: pick.ownerCorpId, fleetId: pick.fleet.id, contractId: pick.contractId },
    hired: Boolean(pick.contractId),
    units, declaredAt: now, travelMs, arrivesAt, returnsAt: null, state: "inbound"
  };
  // the fleet leaves now: in transit to the target, marked as on this raid, so no other order and no settleFleets stationing
  mutateAccountState(pick.ownerAccountId, (state) => {
    ensureCorpMilitary(state.corp);
    const f = state.corp.military.fleets.find((x) => x.id === pick.fleet.id);
    f.transit = { fromStationId: originStationId, toStationId: targetStationId, toSystemId: stationById(targetStationId).systemId, departedAt: now, arrivesAt, raidId: raid.id };
    f.stationId = null;
  }, { sanitize: false });
  mutateState((draft) => { raidsDraft(draft).push(raid); });

  const station = stationById(targetStationId).name;
  tell(targetAccountId, "Raid incoming", `${raid.attackerName ?? "A corporation"} has declared a raid on your holdings at ${station}. Its fleet arrives ${utc(arrivesAt)}: ${unitsText(units)}. Whatever stands at ${station} then defends automatically; you can reinforce before it arrives.`);
  return { ok: true, raid: raidView(raid) };
}

/**
 * Recall an inbound raid before it arrives: the fleet turns round and is home after the time it had flown. The raid
 * still counts against the repeat and rate limits. { ok, raid } or { ok: false, status, error }.
 */
export function recallRaid(accountId, raidId, now = Date.now()) {
  const attacker = corpOf(accountId);
  const raid = allRaids().find((r) => r.id === raidId && r.attackerCorpId === attacker?.publicId);
  if (!raid) return { ok: false, status: 404, error: "No such raid." };
  if (raid.state !== "inbound" || now >= raid.arrivesAt) return { ok: false, status: 409, error: "That raid can no longer be recalled." };
  const ownerAccountId = accountIdOfCorp(raid.fleet.ownerCorpId);
  const returnsAt = now + (now - raid.declaredAt);
  mutateAccountState(ownerAccountId, (state) => {
    const f = (state.corp.military?.fleets || []).find((x) => x.id === raid.fleet.fleetId);
    if (f) f.transit = { fromStationId: raid.targetStationId, toStationId: raid.originStationId, toSystemId: stationById(raid.originStationId)?.systemId ?? "sol", departedAt: now, arrivesAt: returnsAt };
  }, { sanitize: false });
  mutateState((draft) => { Object.assign(raidsDraft(draft).find((r) => r.id === raid.id), { state: "recalled", recalledAt: now, returnsAt }); });
  tell(accountIdOfCorp(raid.targetCorpId), "Raid called off", `${raid.attackerName ?? "The attacking corporation"} has recalled its raid on your holdings at ${stationById(raid.targetStationId)?.name ?? "the station"}.`);
  return { ok: true, raid: raidView({ ...raid, state: "recalled", returnsAt }) };
}

/** The caller's raids: those it declared, and those on it that have not resolved. No account ids. */
export function raidsFor(accountId) {
  const me = corpOf(accountId)?.publicId;
  if (!me) return null;
  return {
    outgoing: allRaids().filter((r) => r.attackerCorpId === me).map(raidView),
    incoming: allRaids().filter((r) => r.targetCorpId === me && r.state === "inbound").map(raidView)
  };
}

/** Whether a fleet is out on a raid (its contract's end waits for it: design section 7). */
export const fleetOnRaid = (fleet) => Boolean(fleet?.transit?.raidId);
