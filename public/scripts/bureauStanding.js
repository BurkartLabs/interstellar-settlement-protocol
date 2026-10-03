// public/scripts/bureauStanding.js: Bureau Standing as points (AB#4689 slice 4, docs/design/desk-work.md section 4), for
// the server and the page alike. A corporation's standing with an agent was a count of completed contracts; it is now
// points, fed by contracts (desk.contractPoints each) and, from slice 5, by desk packets. The reputation tiers'
// thresholds are multiplied by desk.reputationThresholdMultiplier, and a save's count becomes points by the same factor,
// so every grade stays where it was.

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
