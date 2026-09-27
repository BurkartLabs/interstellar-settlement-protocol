// server/shipyard.js: ship production at the Orbital Shipyard (ISP-171, AB#865). The same authoritative queue pattern as
// research: the server takes the unit's cost from data/units.json when a job is queued, times it from the catalog's
// build minutes, and delivers it on the fabrication tick (server/ticks.js) once its time is up. Nothing the client sends
// but a unit id, a quantity and a job id is read, so neither a cost nor a completion can be forged.
//
// The fleet a ship counts against is the Fleet Cap the sidebar shows (server/game/progression.js fleetStatus), with
// the probes: a job counts from the moment it is queued, as a probe in fabrication does.

import { applyCredits } from "./finances.js";
import { countBuilt, playerBuilding } from "./playerBuildings.js";
import { fleetStatus } from "./game/progression.js";
import { SHIP_UNIT_IDS, UNITS, ensureCorpMilitary } from "./game/units.js";

export const SHIPYARD = playerBuilding("orbital-shipyard");
/** The units built at the shipyard: every catalog unit whose build site is the Orbital Shipyard. */
export const SHIP_IDS = SHIP_UNIT_IDS;
/** The most of one ship a single job may hold, and the most jobs a queue may hold. */
export const MAX_JOB_QUANTITY = 100;
export const MAX_QUEUED_JOBS = 10;
/**
 * What cancelling returns (docs/design/v0.10-combat.md section 1): all of a job not yet started, since nothing was
 * used; half of a job already on the slips, credits and goods alike, since the yard has worked the materials.
 */
export const REFUND_UNSTARTED = 1;
export const REFUND_STARTED = 0.5;

const queueOf = (corp) => {
  if (!corp.shipyard || typeof corp.shipyard !== "object") corp.shipyard = {};
  if (!Array.isArray(corp.shipyard.queue)) corp.shipyard.queue = [];
  return corp.shipyard.queue;
};
const jobMs = (unitId, quantity) => UNITS[unitId].buildMinutes * 60_000 * quantity;
/** Ships a queue still owes: every queued job's quantity. */
export const queuedShips = (corp) => (corp?.shipyard?.queue || []).reduce((sum, job) => sum + (Number(job.quantity) || 0), 0);

/** The ships a job of `quantity` unitId costs: the catalog's credits and goods, times the quantity. */
export function shipJobCost(unitId, quantity) {
  const unit = UNITS[unitId];
  return {
    credits: unit.credits * quantity,
    goods: Object.fromEntries(Object.entries(unit.goods).map(([item, qty]) => [item, qty * quantity]))
  };
}

/**
 * Queue `quantity` of `unitId` at the shipyard: every check before the first write, so a refusal changes nothing.
 * Returns { outcome: "ok", job } or { outcome, ...detail } naming the first thing in the way.
 */
export function queueShips(corp, unitId, quantity, now = Date.now()) {
  if (!SHIP_IDS.includes(unitId)) return { outcome: "not-a-ship" };
  if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_JOB_QUANTITY)) return { outcome: "bad-quantity" };
  if (countBuilt(SHIPYARD, corp) === 0) return { outcome: "no-shipyard" };
  const unit = UNITS[unitId];
  const missing = unit.research.find((id) => !(corp.unlockedTech || []).includes(id));
  if (missing) return { outcome: "missing-research", research: missing };
  const queue = corp?.shipyard?.queue || [];
  if (queue.length >= MAX_QUEUED_JOBS) return { outcome: "queue-full" };
  const fleet = fleetStatus(corp); // probes, ships and every ship already queued
  if (fleet.vessels + quantity > fleet.cap) return { outcome: "fleet-cap", fleet };
  const cost = shipJobCost(unitId, quantity);
  if ((corp.finances?.credits || 0) < cost.credits) return { outcome: "insufficient-credits", cost };
  const stationId = corp.currentStationId;
  const stock = corp.inventory?.[stationId] || {};
  const short = Object.entries(cost.goods).find(([item, qty]) => (Number(stock[item]) || 0) < qty);
  if (short) return { outcome: "insufficient-goods", item: short[0], needed: short[1], have: Number(stock[short[0]]) || 0, stationId };

  applyCredits(corp, -cost.credits, "ship-production", now);
  for (const [item, qty] of Object.entries(cost.goods)) stock[item] -= qty;
  const last = queue.at(-1);
  const startsAt = Math.max(now, Number(last?.completesAt) || 0);
  const job = {
    id: `ship-${now}-${Math.random().toString(36).slice(2, 8)}`,
    unitId, quantity, stationId, // where the goods came from, and go back to on a cancel
    credits: cost.credits, goods: cost.goods,
    queuedAt: now, startsAt, completesAt: startsAt + jobMs(unitId, quantity)
  };
  queueOf(corp).push(job);
  return { outcome: "ok", job };
}

/**
 * Deliver every job whose time is up: its ships join corp.military.units and it leaves the queue, so a second run
 * finds nothing to deliver. Returns the jobs delivered.
 */
export function completeShipJobs(corp, now = Date.now()) {
  const queue = corp?.shipyard?.queue;
  if (!Array.isArray(queue) || !queue.length) return [];
  const done = queue.filter((job) => now >= job.completesAt);
  if (!done.length) return [];
  ensureCorpMilitary(corp);
  for (const job of done) corp.military.units[job.unitId] = (corp.military.units[job.unitId] || 0) + job.quantity;
  corp.shipyard.queue = queue.filter((job) => now < job.completesAt);
  ensureCorpMilitary(corp); // power follows the units
  return done;
}

/**
 * Cancel one queued job: the refund goes back to the corporation's credits and to the station its goods came from,
 * and every job behind it moves up. Returns { outcome: "ok", job, refund } or { outcome: "no-job" }.
 */
export function cancelShipJob(corp, jobId, now = Date.now()) {
  const queue = corp?.shipyard?.queue || [];
  const at = queue.findIndex((job) => job.id === jobId);
  if (at < 0) return { outcome: "no-job" };
  const job = queue[at];
  const share = now >= job.startsAt ? REFUND_STARTED : REFUND_UNSTARTED;
  const refund = {
    share,
    credits: Math.floor(job.credits * share),
    goods: Object.fromEntries(Object.entries(job.goods).map(([item, qty]) => [item, Math.floor(qty * share)]))
  };
  if (refund.credits > 0) applyCredits(corp, refund.credits, "ship-production-refund", now);
  if (!corp.inventory || typeof corp.inventory !== "object") corp.inventory = {};
  const stock = (corp.inventory[job.stationId] ||= {});
  for (const [item, qty] of Object.entries(refund.goods)) if (qty > 0) stock[item] = (Number(stock[item]) || 0) + qty;
  queue.splice(at, 1);
  // the jobs behind it that have not started move up: each starts when the one ahead of it finishes, or now
  for (let i = at; i < queue.length; i += 1) {
    const j = queue[i];
    if (j.startsAt <= now) continue;
    j.startsAt = Math.max(now, i > 0 ? queue[i - 1].completesAt : now);
    j.completesAt = j.startsAt + jobMs(j.unitId, j.quantity);
  }
  return { outcome: "ok", job, refund };
}
