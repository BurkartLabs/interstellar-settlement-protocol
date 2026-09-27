// server/production.js: the one authoritative production queue for units (ISP-171, AB#865; ISP-172, AB#866). A line is a
// place units come from - the Orbital Shipyard for ships, Headquarters for troops - and says which units it makes, where
// its queue lives, what it books to the ledger, and what else must be true before it takes an order. The rules are the
// same on every line: the cost is the catalog's (data/units.json), taken when a job is queued, in credits and in goods
// from the station the corporation is docked at; a job is timed from the catalog's build minutes behind the jobs ahead
// of it, and the fabrication tick (server/ticks.js) delivers it once. The client names a unit, a quantity and a job;
// nothing else it sends is read.

import { applyCredits } from "./finances.js";
import { UNITS, ensureCorpMilitary } from "./game/units.js";

/** The most of one unit a single job may hold, and the most jobs a queue may hold. */
export const MAX_JOB_QUANTITY = 100;
export const MAX_QUEUED_JOBS = 10;
/**
 * What cancelling returns (docs/design/v0.10-combat.md section 1): all of a job not yet started, since nothing was
 * used; half of a job already under way, credits and goods alike.
 */
export const REFUND_UNSTARTED = 1;
export const REFUND_STARTED = 0.5;

const queueOf = (corp, line) => {
  if (!corp[line.key] || typeof corp[line.key] !== "object") corp[line.key] = {};
  if (!Array.isArray(corp[line.key].queue)) corp[line.key].queue = [];
  return corp[line.key].queue;
};
const jobMs = (unitId, quantity) => UNITS[unitId].buildMinutes * 60_000 * quantity;

/** What a job of `quantity` unitId costs: the catalog's credits and goods, times the quantity. */
export function jobCost(unitId, quantity) {
  const unit = UNITS[unitId];
  return {
    credits: unit.credits * quantity,
    goods: Object.fromEntries(Object.entries(unit.goods).map(([item, qty]) => [item, qty * quantity]))
  };
}

/**
 * Queue `quantity` of `unitId` on `line`: every check before the first write, so a refusal changes nothing. Returns
 * { outcome: "ok", job } or { outcome, ...detail } naming the first thing in the way. `line.refuse(corp, unitId,
 * quantity)` adds the line's own checks (a building to build at, the Fleet Cap), after the unit's research.
 */
export function queueUnits(line, corp, unitId, quantity, now = Date.now()) {
  if (!line.unitIds.includes(unitId)) return { outcome: "wrong-unit" };
  if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_JOB_QUANTITY)) return { outcome: "bad-quantity" };
  const site = line.siteRefusal(corp);
  if (site) return { outcome: site };
  const missing = UNITS[unitId].research.find((id) => !(corp.unlockedTech || []).includes(id));
  if (missing) return { outcome: "missing-research", research: missing };
  const queue = corp?.[line.key]?.queue || [];
  if (queue.length >= MAX_QUEUED_JOBS) return { outcome: "queue-full" };
  const own = line.refuse?.(corp, unitId, quantity);
  if (own) return own;
  const cost = jobCost(unitId, quantity);
  if ((corp.finances?.credits || 0) < cost.credits) return { outcome: "insufficient-credits", cost };
  const stationId = corp.currentStationId;
  const stock = corp.inventory?.[stationId] || {};
  const short = Object.entries(cost.goods).find(([item, qty]) => (Number(stock[item]) || 0) < qty);
  if (short) return { outcome: "insufficient-goods", item: short[0], needed: short[1], have: Number(stock[short[0]]) || 0, stationId };

  applyCredits(corp, -cost.credits, line.ledger, now);
  for (const [item, qty] of Object.entries(cost.goods)) stock[item] -= qty;
  const last = queue.at(-1);
  const startsAt = Math.max(now, Number(last?.completesAt) || 0);
  const job = {
    id: `${line.jobPrefix}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    unitId, quantity, stationId, // where the goods came from, go back to on a cancel, and a garrison stands (ISP-172)
    credits: cost.credits, goods: cost.goods,
    queuedAt: now, startsAt, completesAt: startsAt + jobMs(unitId, quantity)
  };
  queueOf(corp, line).push(job);
  return { outcome: "ok", job };
}

/**
 * Deliver every job on `line` whose time is up: its units join corp.military.units (and `line.deliver`, when it has
 * one, places them), and it leaves the queue, so a second run finds nothing to deliver. Returns the jobs delivered.
 */
export function completeJobs(line, corp, now = Date.now()) {
  const queue = corp?.[line.key]?.queue;
  if (!Array.isArray(queue) || !queue.length) return [];
  const done = queue.filter((job) => now >= job.completesAt);
  if (!done.length) return [];
  ensureCorpMilitary(corp);
  for (const job of done) {
    corp.military.units[job.unitId] = (corp.military.units[job.unitId] || 0) + job.quantity;
    line.deliver?.(corp, job);
  }
  corp[line.key].queue = queue.filter((job) => now < job.completesAt);
  ensureCorpMilitary(corp); // power follows the units
  return done;
}

/**
 * Cancel one job on `line`: the refund goes back to the corporation's credits and to the station its goods came from,
 * and every job behind it that has not started moves up. Returns { outcome: "ok", job, refund } or { outcome: "no-job" }.
 */
export function cancelJob(line, corp, jobId, now = Date.now()) {
  const queue = corp?.[line.key]?.queue || [];
  const at = queue.findIndex((job) => job.id === jobId);
  if (at < 0) return { outcome: "no-job" };
  const job = queue[at];
  const share = now >= job.startsAt ? REFUND_STARTED : REFUND_UNSTARTED;
  const refund = {
    share,
    credits: Math.floor(job.credits * share),
    goods: Object.fromEntries(Object.entries(job.goods).map(([item, qty]) => [item, Math.floor(qty * share)]))
  };
  if (refund.credits > 0) applyCredits(corp, refund.credits, line.refundLedger, now);
  if (!corp.inventory || typeof corp.inventory !== "object") corp.inventory = {};
  const stock = (corp.inventory[job.stationId] ||= {});
  for (const [item, qty] of Object.entries(refund.goods)) if (qty > 0) stock[item] = (Number(stock[item]) || 0) + qty;
  queue.splice(at, 1);
  for (let i = at; i < queue.length; i += 1) {
    const j = queue[i];
    if (j.startsAt <= now) continue;
    j.startsAt = Math.max(now, i > 0 ? queue[i - 1].completesAt : now);
    j.completesAt = j.startsAt + jobMs(j.unitId, j.quantity);
  }
  return { outcome: "ok", job, refund };
}
