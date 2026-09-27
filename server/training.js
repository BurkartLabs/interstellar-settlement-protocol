// server/training.js: troop training at Headquarters (ISP-172, AB#866), one line of the production queue
// (server/production.js). docs/design/v0.10-combat.md section 1: troops train at the corporation's Headquarters, cost
// credits and goods like every unit, and take no employees, so payroll and each lease's staffing (5 per lease,
// public/scripts/leaseStaffing.js) are untouched. Troops are not vessels and do not count against the Fleet Cap.
//
// Defense troops stand in a station's garrison: a job's troops join the garrison of the station the corporation was
// docked at when it queued them (corp.military.garrisons, by station id). Attack troops travel with the fleet.

import { TROOP_UNIT_IDS } from "./game/units.js";
import { MAX_JOB_QUANTITY, MAX_QUEUED_JOBS, REFUND_STARTED, REFUND_UNSTARTED, cancelJob, completeJobs, queueUnits } from "./production.js";

export { MAX_JOB_QUANTITY, MAX_QUEUED_JOBS, REFUND_STARTED, REFUND_UNSTARTED };
export const TROOP_IDS = TROOP_UNIT_IDS;
export const HEADQUARTERS = "Headquarters";

export const TRAINING_LINE = Object.freeze({
  key: "training", jobPrefix: "troop", unitIds: TROOP_IDS,
  ledger: "troop-training", refundLedger: "troop-training-refund",
  // every corporation starts with one and nothing removes it; a save without one cannot train rather than guess
  siteRefusal: (corp) => ((corp.buildings || []).some((b) => b?.name === HEADQUARTERS) ? null : "no-headquarters"),
  deliver(corp, job) {
    if (job.unitId !== "dt") return;
    const garrisons = corp.military.garrisons || (corp.military.garrisons = {});
    garrisons[job.stationId] = (Number(garrisons[job.stationId]) || 0) + job.quantity;
  }
});

/** Queue `quantity` troops. "not-a-troop" when the unit is not one; otherwise the line's outcomes (server/production.js). */
export function queueTroops(corp, unitId, quantity, now = Date.now()) {
  const result = queueUnits(TRAINING_LINE, corp, unitId, quantity, now);
  return result.outcome === "wrong-unit" ? { outcome: "not-a-troop" } : result;
}
export const completeTroopJobs = (corp, now = Date.now()) => completeJobs(TRAINING_LINE, corp, now);
export const cancelTroopJob = (corp, jobId, now = Date.now()) => cancelJob(TRAINING_LINE, corp, jobId, now);
