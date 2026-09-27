// server/shipyard.js: ship production at the Orbital Shipyard (ISP-171, AB#865), one line of the production queue
// (server/production.js). The fleet a ship counts against is the Fleet Cap the sidebar shows
// (server/game/progression.js fleetStatus), with the probes: a job counts from the moment it is queued, as a probe in
// fabrication does.

import { countBuilt, playerBuilding } from "./playerBuildings.js";
import { fleetStatus } from "./game/progression.js";
import { SHIP_UNIT_IDS } from "./game/units.js";
import { MAX_JOB_QUANTITY, MAX_QUEUED_JOBS, REFUND_STARTED, REFUND_UNSTARTED, cancelJob, completeJobs, jobCost, queueUnits } from "./production.js";

export { MAX_JOB_QUANTITY, MAX_QUEUED_JOBS, REFUND_STARTED, REFUND_UNSTARTED };
export const SHIPYARD = playerBuilding("orbital-shipyard");
/** The units built at the shipyard: every catalog unit whose build site is the Orbital Shipyard. */
export const SHIP_IDS = SHIP_UNIT_IDS;

export const SHIPYARD_LINE = Object.freeze({
  key: "shipyard", jobPrefix: "ship", unitIds: SHIP_IDS,
  ledger: "ship-production", refundLedger: "ship-production-refund",
  siteRefusal: (corp) => (countBuilt(SHIPYARD, corp) === 0 ? "no-shipyard" : null),
  refuse(corp, unitId, quantity) {
    const fleet = fleetStatus(corp); // probes, ships and every ship already queued
    return fleet.vessels + quantity > fleet.cap ? { outcome: "fleet-cap", fleet } : null;
  }
});

/** Ships a queue still owes: every queued job's quantity. */
export const queuedShips = (corp) => (corp?.shipyard?.queue || []).reduce((sum, job) => sum + (Number(job.quantity) || 0), 0);
export const shipJobCost = jobCost;

/** Queue `quantity` of a ship. "not-a-ship" when it is not one; otherwise the line's outcomes (server/production.js). */
export function queueShips(corp, unitId, quantity, now = Date.now()) {
  const result = queueUnits(SHIPYARD_LINE, corp, unitId, quantity, now);
  return result.outcome === "wrong-unit" ? { outcome: "not-a-ship" } : result;
}
export const completeShipJobs = (corp, now = Date.now()) => completeJobs(SHIPYARD_LINE, corp, now);
export const cancelShipJob = (corp, jobId, now = Date.now()) => cancelJob(SHIPYARD_LINE, corp, jobId, now);
