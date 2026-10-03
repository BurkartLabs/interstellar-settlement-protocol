// public/scripts/bureauStanding.js: Bureau Standing as points (AB#4689 slice 4, docs/design/desk-work.md section 4), for
// the server and the page alike. A corporation's standing with an agent was a count of completed contracts; it is now
// points, fed by contracts (desk.contractPoints each) and, from slice 5, by desk packets. The reputation tiers'
// thresholds are multiplied by desk.reputationThresholdMultiplier, and a save's count becomes points by the same factor,
// so every grade stays where it was.
//
// Slice 8: what a grade gives (design section 4, the perks table). Each perk is named by the grade that opens it, and
// the grade's level is read from the tiers' own titles, so the thresholds stay data/missions.json's.

import { ASSIGNED_COORDINATOR } from "./liaison.js";

/** The grade `points` reach in `tiers`: { level, title }, Unknown below the first threshold. */
export function gradeOf(points, tiers) {
  const thresholds = tiers?.thresholds || [0];
  let level = 0;
  for (let i = thresholds.length - 1; i >= 0; i -= 1) {
    if (points >= thresholds[i]) { level = i; break; }
  }
  return { level, title: (tiers?.titles || [])[level] || "Unknown" };
}

/** Bureau Standing: the points a corporation holds with the coordinator, from a save of either shape. */
export function bureauPoints(corp, multiplier) {
  return migrateStanding(corp?.agentReputation?.[ASSIGNED_COORDINATOR.id], multiplier).points;
}

/** Design section 4's perks, each by the grade that opens it. */
export const GRADE_PERKS = Object.freeze({
  deskTier2: "Recognized", thirdContract: "Recognized",
  deskTier3: "Trusted", hourlyBoard: "Trusted",
  priorityProcessing: "Valued",
  fourthContract: "Distinguished"
});

/** Whether `points` hold the grade that opens `perk`. */
export function hasPerk(points, tiers, perk) {
  const at = (tiers?.titles || []).indexOf(GRADE_PERKS[perk]);
  return at >= 0 && gradeOf(points, tiers).level >= at;
}

/** The Desk tiers open at these points: 1, 2 from Recognized, 3 from Trusted. */
export const deskTiersFor = (points, tiers) => [1, ...(hasPerk(points, tiers, "deskTier2") ? [2] : []), ...(hasPerk(points, tiers, "deskTier3") ? [3] : [])];

/** Contracts on the Bureau's board: the base, one more at Recognized, another at Distinguished. */
export const contractsOfferedFor = (points, tiers, base) => base + (hasPerk(points, tiers, "thirdContract") ? 1 : 0) + (hasPerk(points, tiers, "fourthContract") ? 1 : 0);

/** How often the board refreshes: the base, or hourly from Trusted. */
export const contractRefreshMsFor = (points, tiers, base) => (hasPerk(points, tiers, "hourlyBoard") ? 3_600_000 : base);

/** An ISA fee (a lease purchase, office rent) with priority processing: priorityProcessingPct off from Valued. */
export function priorityPrice(price, points, tiers, pct) {
  return hasPerk(points, tiers, "priorityProcessing") ? Math.round((price * (100 - pct)) / 100) : price;
}

/** The thresholds of `tiers` ({ thresholds, titles }) in points: each multiplied by `multiplier`. */
export function tiersInPoints(tiers, multiplier) {
  return { ...tiers, thresholds: (tiers?.thresholds || [0]).map((t) => t * multiplier) };
}

/**
 * A reputation record in points, from a save of either shape: one with points keeps them; one saved before points had
 * only completedCount, which becomes points at `multiplier` each. Idempotent: run on a migrated record, it changes nothing.
 */
export function migrateStanding(rep, multiplier) {
  if (rep && Number.isFinite(rep.points)) return rep;
  const count = Math.max(0, Math.floor(Number(rep?.completedCount) || 0));
  return { ...(rep || {}), points: count * multiplier };
}

/**
 * Add `gain` points to a reputation record, in place. Points are whole; a fraction (Bureaucratic Persuasion's 15% of 10
 * is 11.5) is carried in `pointsCarry` to the next gain, so its contracts earn 11 and 12 in turn and nothing is rounded
 * away or invented. Returns the whole points added.
 */
export function addStandingPoints(rep, gain) {
  const total = (Number(rep.pointsCarry) || 0) + Math.max(0, Number(gain) || 0);
  const whole = Math.floor(total + 1e-9);
  rep.points = (Number(rep.points) || 0) + whole;
  rep.pointsCarry = Math.max(0, total - whole);
  return whole;
}
