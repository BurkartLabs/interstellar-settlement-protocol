// The figures a running extractor shows on the open lease view (Bug #1091). The server sends mining:updated as the
// cycle runs, and the view used to keep the figures it was drawn with: Mined this cycle, the progress and the fees
// stood still until the player left and came back. The lease view draws them with these functions, and the
// mining:updated handler refreshes them in place with the same ones, so the two cannot disagree.

/** "active", "downtime" or "idle": when this changes, the row's layout changes and the view is redrawn instead. */
export function extractorState(ex) {
  if (ex?.downtimeActive) return "downtime";
  if (ex?.active) return "active";
  return "idle";
}

/**
 * A running cycle's figures at `now`: { pct, hrs, mins, mined, spent, spentEstimated, rate }. `mined` is the server's
 * minedThisCycle (Bug #575: the per-cycle count, not the lifetime total) and `spent` its spentThisCycle (AB#746: the
 * startup cost plus what each tick charged). A cycle started before spentThisCycle existed has none, so `spent` is
 * estimated from the time elapsed and `spentEstimated` says so. `pct` is the elapsed fraction of the cycle's own
 * start and end, so it is the same after a reload. The lease view and the Active Mining Cycles panel both draw these.
 */
/** A cycle's spend as a player reads it: an estimate says so (AB#746). */
export function spentText(figures, formatCredits) {
  return figures.spentEstimated ? `~${formatCredits(figures.spent)} (est.)` : formatCredits(figures.spent);
}

export function activeCycleFigures(ex, now = Date.now()) {
  const remaining = Math.max(0, (ex.endsAt || 0) - now);
  const cycleDuration = (ex.endsAt || 0) - (ex.startedAt || 0);
  const elapsed = Math.min(now - (ex.startedAt || 0), cycleDuration);
  const spentEstimated = ex.spentThisCycle == null;
  const pct = cycleDuration > 0 ? Math.max(0, Math.min(100, Math.round((elapsed / cycleDuration) * 100))) : 0;
  return {
    pct,
    // AB#746: the unrounded elapsed percentage, for bar widths: a minute into a 4-hour cycle is 0.4%, which a rounded
    // pct draws as an empty track, the "flat bar at 0%" this story is about. pctText says "<1%" rather than "0%".
    fill: cycleDuration > 0 ? Math.max(0, Math.min(100, (elapsed / cycleDuration) * 100)) : 0,
    pctText: pct === 0 && elapsed > 0 ? "<1%" : `${pct}%`,
    hrs: Math.floor(remaining / 3_600_000),
    mins: Math.floor((remaining % 3_600_000) / 60_000),
    mined: Number(ex.minedThisCycle || 0),
    spent: spentEstimated ? Math.round((Math.max(0, elapsed) / 3_600_000) * (ex.operationCostPerHour || 0)) : Number(ex.spentThisCycle),
    spentEstimated,
    rate: Number(ex.throughputPerHour || 0)
  };
}
