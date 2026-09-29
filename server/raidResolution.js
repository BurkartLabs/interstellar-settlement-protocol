// ISP-179 (AB#873): resolving a raid when its fleet arrives, and bringing the fleet home.
//
// docs/design/v0.10-raids-mercenaries.md, sections 2, 3, 5 and 6, on the Board's answer to D-0.10-1 (AB#705): "In a
// raid, buildings can be damaged (costs money to repair), units destroyed, resources taken."
//
//   Arrival    the target is checked again: one in its post-raid cooldown turns the raid back, nothing lost. Otherwise
//              the combat resolver (server/game/combat.js) fights the attacking fleet against everything the defender
//              has at the station: its garrison, its own fleets there, and fleets it has hired whose contract permits
//              defense and which stand there. Each side fights at its commander's modifiers and readiness (a hired
//              fleet at its owner's readiness, design section 7).
//   Losses     each side's losses per unit type are shared across the groups that fought, by largest remainder, and
//              leave them; a hired fleet's losses are recorded on its contract (recordContractLosses, AB#870), which
//              takes them from the owner's fleet and pays for them from the collateral when the term ends.
//   Attacker   loot: 20% of the value of the defender's goods at the station above a floor of 10,000, limited by what
//   wins       the survivors carry (1,500 a supply), taken from every valued stack in the same proportion, rounded
//              down; it moves defender -> escrow through settleItems (credits are never taken). Buildings standing at
//              the station lose min(20, 4 x surviving siege engines) condition, never below 50.
//   Always     a private report to each side (never a feed), and the target's 24-hour post-raid cooldown.
//   Return     the survivors fly home on the travel time; when they arrive the loot moves escrow -> the attacker's
//              inventory at the origin station, and the raid is completed. A fleet with no survivors ends there.
//
// Every step is keyed by the raid, so a tick that runs twice, or a restart between steps, moves nothing twice.
// Time is passed in (P-TEST-TIME).

import { addAccountNotification, getAccountById, getAllAccountIds, getState, mutateAccountState, mutateState } from "./gameState.js";
import { emitToAccount } from "./realtime.js";
import { accountIdOfCorp } from "./playerLoans.js";
import { UNITS, ensureCorpMilitary } from "./game/units.js";
import { combatModifiersFor, resolveBattle } from "./game/combat.js";
import { FLEET_UNIT_IDS, settleFleets } from "./fleets.js";
import { postureAt, settleGarrisonMoves, troopsArrivedAfter, withPosture } from "./garrison.js"; // ISP-180 (AB#874)
import { stationById } from "./game/stations.js"; // ISP-209 (AB#904)
import { mercenaryUseAllowed, recordContractLosses } from "./mercenaries.js";
import { buildingsAtStation } from "./raids.js";
import { buildingCostBasis } from "./buildingRemoval.js"; // ISP-181 (AB#875): the repair price the report shows
import { conditionOf } from "./game/buildingCondition.js"; // ISP-287 (AB#994)
import { settleItems, itemEscrowOf } from "./itemSettlement.js";

const HOUR = 3_600_000;
/** The design's assumed numbers (sections 3 and 4), each a Board veto point. */
export const RAID_OUTCOME = Object.freeze({
  lootPct: 20, lootFloor: 10_000, holdPerSupply: 1_500,
  damagePerSiegeEngine: 4, maxDamage: 20, conditionFloor: 50,
  cooldownHours: 24,
  repairPctOfCost: 25, // the design's repair price: (100 - condition)% of the building's cost basis x 25% (ISP-287 repairs)
  reportsKept: 20
});
const UNIT_IDS = [...FLEET_UNIT_IDS, "dt"];
const n = (x) => Math.max(0, Math.floor(Number(x) || 0));
const corpOf = (accountId) => getAccountById(accountId)?.state?.corp ?? null;
const allRaids = () => (Array.isArray(getState()?.market?.raids) ? getState().market.raids : []);
const setRaid = (id, patch) => mutateState((draft) => { const r = (draft.market?.raids || []).find((x) => x.id === id); if (r) Object.assign(r, patch); });
const escrowOf = (id) => `escrow:${id}`;

/** The live NPC standing bid for an item (what goods are worth for loot), 0 when nobody bids. */
function bidFor(item) {
  let best = 0;
  for (const o of getState()?.market?.npcBuyOrders || []) if (o?.item === item) best = Math.max(best, Math.floor(Number(o.unitPrice) || 0));
  return best;
}

/**
 * The loot a win takes (section 3): { value, takeable, carried, lootValue, items } from the defender's goods at the
 * station and the attacker's survivors. Pure apart from reading the bids. Only goods with a bid have a value, and only
 * they are taken; each valued stack gives the same fraction, rounded down, so what is taken is worth at most lootValue.
 */
export function lootFor(stock, survivors) {
  const valued = Object.entries(stock || {}).map(([item, q]) => ({ item, q: n(q), bid: bidFor(item) })).filter((s) => s.q > 0 && s.bid > 0);
  const value = valued.reduce((a, s) => a + s.q * s.bid, 0);
  const takeable = Math.floor((RAID_OUTCOME.lootPct / 100) * Math.max(0, value - RAID_OUTCOME.lootFloor));
  const carried = FLEET_UNIT_IDS.reduce((a, id) => a + n(survivors?.[id]) * UNITS[id].supply * RAID_OUTCOME.holdPerSupply, 0);
  const lootValue = Math.min(takeable, carried);
  const f = value > 0 ? lootValue / value : 0;
  const items = Object.fromEntries(valued.map((s) => [s.item, Math.floor(s.q * f)]).filter(([, q]) => q > 0));
  return { value, takeable, carried, lootValue, items };
}

/**
 * ISP-287 (AB#994): what repairing a building to full condition costs, the price the defender's report quotes and the
 * repair route charges: (100 - condition)% of its cost basis x repairPctOfCost%.
 */
export const repairCostFor = (building) => Math.round(((100 - conditionOf(building)) / 100) * buildingCostBasis(building) * (RAID_OUTCOME.repairPctOfCost / 100));

/** Condition points a win takes from each building at the station: min(20, 4 x surviving siege engines). */
export const damageFor = (survivors) => Math.min(RAID_OUTCOME.maxDamage, RAID_OUTCOME.damagePerSiegeEngine * n(survivors?.se));

/** Split `total` whole units over groups by their counts, largest remainder, never above a group's count. */
function shareLosses(total, groups) {
  const sum = groups.reduce((a, g) => a + g.count, 0);
  if (!(total > 0) || !(sum > 0)) return groups.map(() => 0);
  const exact = groups.map((g) => (total * g.count) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), groups[i].count, i]).sort((a, b) => b[0] - a[0] || b[1] - a[1] || a[2] - b[2]);
  for (let k = 0; left > 0; k = (k + 1) % order.length) { const i = order[k][2]; if (parts[i] < groups[i].count) { parts[i]++; left--; } }
  return parts;
}

/**
 * What the defender has at the station: groups of units that fight together. { garrison: dt }, its own fleets there
 * (stationed, not under contract), and fleets it has hired for defense that stand there.
 */
function defendersAt(defenderAccountId, stationId, at) {
  const corp = corpOf(defenderAccountId);
  const groups = [];
  // ISP-180 (AB#874): only what had arrived by the raid's arrival fights, however late the tick that resolves it
  const came = (f) => !(Number(f?.arrivedAt) > at);
  const dt = Math.max(0, n(corp?.military?.garrisons?.[stationId]) - troopsArrivedAfter(corp, stationId, at)); // a count of defense troops (ISP-172)
  if (dt > 0) groups.push({ kind: "garrison", units: { dt } });
  for (const f of corp?.military?.fleets || []) {
    if (f.stationId === stationId && !f.transit && !f.contract && came(f)) groups.push({ kind: "fleet", fleetId: f.id, units: { ...f.units } });
  }
  for (const o of getState()?.market?.mercenaryOffers || []) {
    if (o.state !== "hired" || o.renterCorpId !== corp?.publicId || !mercenaryUseAllowed(o, "defense")) continue;
    const ownerFleet = corpOf(accountIdOfCorp(o.ownerCorpId))?.military?.fleets?.find((f) => f.id === o.fleetId);
    if (ownerFleet?.stationId === stationId && !ownerFleet.transit && came(ownerFleet)) {
      const lost = o.lost || {};
      groups.push({ kind: "hired", contractId: o.id, units: Object.fromEntries(FLEET_UNIT_IDS.map((id) => [id, n(ownerFleet.units[id]) - n(lost[id])])) });
    }
  }
  return groups;
}

const total = (groups) => Object.fromEntries(UNIT_IDS.map((id) => [id, groups.reduce((a, g) => a + n(g.units[id]), 0)]));
/** Each group's share of a side's losses, by type. */
function lossesByGroup(groups, lost) {
  const out = groups.map(() => ({}));
  for (const id of UNIT_IDS) {
    const parts = shareLosses(n(lost[id]), groups.map((g) => ({ count: n(g.units[id]) })));
    parts.forEach((p, i) => { if (p) out[i][id] = p; });
  }
  return out;
}

/** Take a side's losses from where they stood: its garrison, its own fleets, or a hired fleet's contract. */
function applyLosses(accountId, groups, byGroup) {
  mutateAccountState(accountId, (state) => {
    const c = state.corp;
    ensureCorpMilitary(c);
    groups.forEach((g, i) => {
      const lost = byGroup[i];
      if (g.kind === "hired" || !Object.keys(lost).length) return;
      for (const [id, q] of Object.entries(lost)) c.military.units[id] = Math.max(0, n(c.military.units[id]) - q);
      if (g.kind === "garrison") {
        c.military.garrisons[g.stationId] = Math.max(0, n(c.military.garrisons[g.stationId]) - n(lost.dt));
      } else {
        const f = c.military.fleets.find((x) => x.id === g.fleetId);
        if (f) for (const [id, q] of Object.entries(lost)) f.units[id] = Math.max(0, n(f.units[id]) - q);
      }
    });
    ensureCorpMilitary(c);
  }, { sanitize: false });
  groups.forEach((g, i) => { if (g.kind === "hired" && Object.keys(byGroup[i]).length) recordContractLosses(g.contractId, byGroup[i]); });
}

const round2 = (o) => Object.fromEntries(UNIT_IDS.map((id) => [id, Math.round((Number(o?.[id]) || 0) * 100) / 100]));
function tell(accountId, title, body) {
  const x = accountId ? addAccountNotification(accountId, { type: "military", title, body }) : null;
  if (x) emitToAccount(accountId, "notifications:new", { accountId, notification: x });
}
function keepReport(accountId, report) {
  mutateAccountState(accountId, (state) => {
    const list = Array.isArray(state.corp.raidReports) ? state.corp.raidReports : [];
    state.corp.raidReports = [report, ...list.filter((r) => r.raidId !== report.raidId)].slice(0, RAID_OUTCOME.reportsKept);
  }, { sanitize: false, settleMining: false });
}

/** Resolve one raid that has arrived (or turn it back). Returns the raid's new state. */
export function resolveRaid(raid, now) {
  const attackerAccountId = accountIdOfCorp(raid.attackerCorpId);
  const defenderAccountId = accountIdOfCorp(raid.targetCorpId);
  const ownerAccountId = accountIdOfCorp(raid.fleet.ownerCorpId);
  const at = raid.arrivesAt;
  const fleetOf = () => corpOf(ownerAccountId)?.military?.fleets?.find((f) => f.id === raid.fleet.fleetId) ?? null;
  const flyHome = (from) => {
    const returnsAt = from + Math.max(raid.travelMs || 0, 60_000);
    mutateAccountState(ownerAccountId, (state) => {
      const f = (state.corp.military?.fleets || []).find((x) => x.id === raid.fleet.fleetId);
      if (f) f.transit = { fromStationId: raid.targetStationId, toStationId: raid.originStationId, toSystemId: stationById(raid.originStationId)?.systemId ?? "sol", departedAt: from, arrivesAt: returnsAt, raidId: raid.id };
    }, { sanitize: false });
    return returnsAt;
  };

  // turned back: the target was raided by someone else meanwhile
  const defender = corpOf(defenderAccountId);
  if (!defender || Number(defender.raidCooldownUntil) > at) {
    const returnsAt = flyHome(at);
    setRaid(raid.id, { state: "recalled", turnedBackAt: at, returnsAt });
    tell(attackerAccountId, "Raid turned back", `Your fleet reached ${stationById(raid.targetStationId)?.name ?? "the station"} after ${raid.targetName ?? "the target"} had just been raided, and turned back without a fight.`);
    return "recalled";
  }

  // ISP-180 (AB#874): reinforcements that have arrived by the raid's arrival join the defense, and none later: the
  // defender's fleets and troop moves, and the fleets it has hired, are settled up to that moment
  mutateAccountState(defenderAccountId, (state) => { settleFleets(state.corp, at); settleGarrisonMoves(state.corp, at); }, { sanitize: false });
  for (const o of getState()?.market?.mercenaryOffers || []) {
    if (o.state === "hired" && o.renterCorpId === raid.targetCorpId) mutateAccountState(accountIdOfCorp(o.ownerCorpId), (state) => { settleFleets(state.corp, at); }, { sanitize: false });
  }
  const posture = postureAt(corpOf(defenderAccountId), raid.targetStationId);

  // the battle
  const fleet = fleetOf();
  const attackers = Object.fromEntries(FLEET_UNIT_IDS.map((id) => [id, n(fleet?.units?.[id]) - n(raid.fleet.contractId ? (getState()?.market?.mercenaryOffers || []).find((o) => o.id === raid.fleet.contractId)?.lost?.[id] : 0)]));
  const groups = defendersAt(defenderAccountId, raid.targetStationId, at).map((g) => (g.kind === "garrison" ? { ...g, stationId: raid.targetStationId } : g));
  const defending = total(groups);
  const battle = resolveBattle(attackers, defending, { attacker: combatModifiersFor(corpOf(ownerAccountId)), defender: withPosture(combatModifiersFor(corpOf(defenderAccountId)), posture) });
  const lostA = Object.fromEntries(FLEET_UNIT_IDS.map((id) => [id, Math.max(0, attackers[id] - n(battle.survivors.attacker[id]))]));
  const lostD = Object.fromEntries(UNIT_IDS.map((id) => [id, Math.max(0, defending[id] - n(battle.survivors.defender[id]))]));

  // attacker's losses: from its fleet, or recorded on its contract
  if (raid.fleet.contractId) recordContractLosses(raid.fleet.contractId, lostA);
  else applyLosses(ownerAccountId, [{ kind: "fleet", fleetId: raid.fleet.fleetId, units: attackers }], [lostA]);
  applyLosses(defenderAccountId, groups, lossesByGroup(groups, lostD));

  // a win: loot and damage
  let loot = { value: 0, takeable: 0, carried: 0, lootValue: 0, items: {} };
  const damage = [];
  if (battle.winner === "attacker") {
    loot = lootFor(corpOf(defenderAccountId)?.inventory?.[raid.targetStationId], battle.survivors.attacker);
    if (Object.keys(loot.items).length) {
      const moved = settleItems({ from: { accountId: defenderAccountId, stationId: raid.targetStationId }, to: escrowOf(raid.id), items: loot.items, reason: "raid-loot", idempotencyKey: `raid:${raid.id}:loot` }, at);
      if (!moved.ok) loot = { ...loot, items: {}, lootValue: 0 };
    }
    const points = damageFor(battle.survivors.attacker);
    if (points > 0) {
      mutateAccountState(defenderAccountId, (state) => {
        for (const b of buildingsAtStation(state.corp, raid.targetStationId)) {
          const before = Math.min(100, Math.max(RAID_OUTCOME.conditionFloor, Number(b.condition ?? 100)));
          b.condition = Math.max(RAID_OUTCOME.conditionFloor, before - points);
          const repairCost = repairCostFor(b); // ISP-287 (AB#994): the price the repair route charges
          damage.push({ name: b.name, before, after: b.condition, repairCost });
        }
      }, { sanitize: false, settleMining: false });
    }
  }
  mutateAccountState(defenderAccountId, (state) => { state.corp.raidCooldownUntil = at + RAID_OUTCOME.cooldownHours * HOUR; }, { sanitize: false, settleMining: false });

  // the reports: each side's own, never a feed
  const station = stationById(raid.targetStationId)?.name ?? raid.targetStationId;
  const rounds = battle.rounds.map((r) => ({ round: r.round, attacker: { lost: round2(r.attacker.lost), remaining: round2(r.attacker.remaining) }, defender: { lost: round2(r.defender.lost), remaining: round2(r.defender.remaining) } }));
  const common = { raidId: raid.id, at, stationId: raid.targetStationId, station, winner: battle.winner, posture, rounds, attacker: { name: raid.attackerName, before: attackers, lost: lostA, survivors: battle.survivors.attacker }, defender: { name: raid.targetName, before: defending, lost: lostD, survivors: battle.survivors.defender }, loot: loot.items };
  keepReport(attackerAccountId, { ...common, side: "attacker", buildingsDamaged: damage.map(({ name, after, before }) => ({ name, points: before - after })) }); // not the defender's repair bill
  keepReport(defenderAccountId, { ...common, side: "defender", buildingsDamaged: damage });

  const survivors = FLEET_UNIT_IDS.reduce((a, id) => a + n(battle.survivors.attacker[id]), 0);
  const outcome = battle.winner === "attacker" ? "won" : battle.winner === "defender" ? "was beaten off" : "ended in a draw";
  const lootText = Object.entries(loot.items).map(([i, q]) => `${q.toLocaleString("en-US")} ${i}`).join(", ") || "nothing";
  tell(attackerAccountId, "Raid resolved", `Your raid on ${raid.targetName ?? "the target"} at ${station} ${outcome}. Taken: ${lootText}. The report is in your raids.`);
  tell(defenderAccountId, "Your holdings were raided", `${raid.attackerName ?? "A corporation"} raided your holdings at ${station}: the raid ${outcome}. Lost: ${lootText}. The report is in your raids.`);

  if (survivors === 0 && !raid.fleet.contractId) {
    // nobody flies home: the empty fleet is gone and the raid is over (no loot can have been taken: a win needs survivors)
    mutateAccountState(ownerAccountId, (state) => {
      state.corp.military.fleets = (state.corp.military.fleets || []).filter((f) => f.id !== raid.fleet.fleetId || FLEET_UNIT_IDS.some((id) => n(f.units[id]) > 0));
    }, { sanitize: false });
    setRaid(raid.id, { state: "completed", resolvedAt: at, completedAt: at, result: { winner: battle.winner, loot: loot.items, lootValue: loot.lootValue } });
    return "completed";
  }
  const returnsAt = flyHome(at);
  setRaid(raid.id, { state: "resolved", resolvedAt: at, returnsAt, result: { winner: battle.winner, loot: loot.items, lootValue: loot.lootValue } });
  return "resolved";
}

/** The fleet is home: deliver the loot to the attacker at the origin, station the fleet, and complete the raid. */
export function completeRaid(raid, now) {
  const attackerAccountId = accountIdOfCorp(raid.attackerCorpId);
  const ownerAccountId = accountIdOfCorp(raid.fleet.ownerCorpId);
  const held = itemEscrowOf(escrowOf(raid.id));
  if (Object.keys(held).length) {
    const moved = settleItems({ from: escrowOf(raid.id), to: { accountId: attackerAccountId, stationId: raid.originStationId }, items: held, reason: "raid-loot-delivery", idempotencyKey: `raid:${raid.id}:delivery` }, raid.returnsAt);
    if (!moved.ok) return "resolved"; // tried again on the next tick
  }
  mutateAccountState(ownerAccountId, (state) => {
    const f = (state.corp.military?.fleets || []).find((x) => x.id === raid.fleet.fleetId);
    if (f?.transit?.raidId === raid.id) { f.stationId = raid.originStationId; f.transit = null; }
  }, { sanitize: false });
  setRaid(raid.id, { state: "completed", completedAt: raid.returnsAt });
  return "completed";
}

/** The raid tick: resolve every raid that has arrived, and complete every one whose fleet is home. */
export function raidTick(now) {
  for (const r of allRaids()) {
    if (r.state === "inbound" && r.arrivesAt <= now) resolveRaid(r, now);
  }
  for (const r of allRaids()) {
    if ((r.state === "resolved" || (r.state === "recalled" && r.turnedBackAt)) && r.returnsAt <= now) completeRaid(r, now);
  }
  // ISP-180 (AB#874): troops sent between stations join their garrison when they arrive (after the raids above, which
  // settled their own defenders only up to each raid's arrival)
  for (const id of getAllAccountIds()) {
    const moves = corpOf(id)?.garrisonMoves;
    if (Array.isArray(moves) && moves.some((m) => m.arrivesAt <= now)) mutateAccountState(id, (state) => { settleGarrisonMoves(state.corp, now); }, { sanitize: false });
  }
}

/** The caller's own report of a raid, or null: only the attacker and the defender have one. */
export function raidReportFor(accountId, raidId) {
  return (corpOf(accountId)?.raidReports || []).find((r) => r.raidId === raidId) ?? null;
}
