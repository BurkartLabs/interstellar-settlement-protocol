// Bug #4848: whether a ticker has anything to do for one account, read without changing it.
//
// Each 5- and 10-second ticker (server/ticks.js) used to call mutateAccountState for every account on every run, and
// mutateAccountState does the whole account's work (settles mining, closes days, refreshes the exchange tax, evaluates
// the level) and schedules a snapshot write, even when the ticker's own mutator then found nothing due and returned.
// At 200 corporations that was 82-93 ms a run each, about a tenth of the run together (AB#963's profile). These
// predicates let a ticker skip an account whose mutator would provably change nothing: each one is the mutator's own
// early-return condition, inverted, and errs towards "due" whenever the record is not in the shape the mutator
// expects. miningTick is not guarded: it is the one ticker that settles every account.
//
// Pure: they read a corporation (peekCorp) or an account state (peekState) and never write to it.

import { rndItemEndsAt } from "../../public/scripts/rndQueue.js";
import { FACILITY_LISTS } from "./refining.js";

const due = (at, now) => Number.isFinite(Number(at)) && now >= Number(at);

/** travelTick: a journey whose arrival time has come. */
export function travelDue(corp, now) {
  return Boolean(corp?.travel?.arrivesAt) && now >= corp.travel.arrivesAt;
}

/** shipmentTick: a shipment in transit whose arrival time has come. */
export function shipmentsDue(corp, now) {
  return Array.isArray(corp?.shipments) && corp.shipments.some((s) => s?.status === "in-transit" && !(now < s.arrivesAt));
}

/**
 * processRndCompletions: the queue still needs putting in sequence (an item with no start, or one starting before the
 * item ahead ends: scheduleRndQueue would move it), or its first item has finished.
 */
export function rndDue(state, now) {
  const queue = state?.queues?.corporateRnD;
  if (!Array.isArray(queue) || queue.length === 0) return false;
  let previousEnd = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    if (!item || typeof item !== "object") return true; // not what the scheduler expects: let the mutator see it
    const start = Math.max(Number(item.startedAt || 0) || now, previousEnd);
    if (start !== item.startedAt) return true;
    previousEnd = rndItemEndsAt(item);
    if (i === 0 && !(now < previousEnd)) return true;
  }
  return false;
}

/** processCeoInsightCompletions: an item whose programme has run its hours (the mutator's own test). */
export function ceoDue(state, now) {
  const queue = state?.queues?.ceoInsight;
  if (!Array.isArray(queue) || queue.length === 0) return false;
  return queue.some((item) => {
    const startedAt = Number(item?.startedAt || 0);
    const hours = Number(item?.durationHours ?? NaN);
    return Boolean(startedAt) && Number.isFinite(hours) && hours >= 0 && now >= startedAt + hours * 3_600_000;
  });
}

/** fabricationTick: a probe, a ship or a squad whose job is complete, or a fleet at the end of a trip (not a raid). */
export function fabricationDue(corp, now) {
  if (!corp) return false;
  const jobDone = (queue) => Array.isArray(queue) && queue.some((j) => !(now < j?.completesAt));
  if (jobDone(corp.asteroidMining?.fabricationQueue)) return true;
  if (jobDone(corp.shipyard?.queue) || jobDone(corp.training?.queue)) return true;
  return (corp.military?.fleets || []).some((f) => f?.transit && !f.transit.raidId && !(now < f.transit.arrivesAt));
}

/**
 * refineryTick: a run that has ended (or whose record the mutator would correct), or a facility record the model has
 * not made yet for a building that exists (applyRefineryOperations first brings the records in line with the buildings).
 */
export function refineryDue(corp, now) {
  if (!corp) return false;
  const built = (name) => (corp.buildings || []).filter((b) => b?.name === name).length;
  for (const [kind, list] of Object.entries(FACILITY_LISTS)) {
    const records = corp[list];
    const name = kind === "refinery" ? "Refinery" : "Synthesis Array";
    if (!Array.isArray(records)) { if (built(name) > 0) return true; continue; }
    if (records.length < built(name)) return true;
    if (records.some((r) => r?.active && r.chainId && (!Number(r.endsAt) || due(r.endsAt, now)))) return true;
  }
  return false;
}

/** asteroidExpeditionTick: an expedition out, which mines its belt on every run until it is home. */
export function expeditionsActive(corp) {
  return (corp?.asteroidMining?.activeExpeditions || []).some((e) => e?.status === "active");
}

/** asteroidExpeditionTick's second pass: the corporation scouted one of the belts this run emptied. */
export function scoutedAnyOf(corp, keys) {
  const scouted = corp?.asteroidMining?.scoutedBelts;
  return Array.isArray(scouted) && keys.some((k) => scouted.includes(k));
}
