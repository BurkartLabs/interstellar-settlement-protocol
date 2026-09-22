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
 * A running cycle's figures at `now`: { pct, hrs, mins, mined, fees }. `mined` is the server's minedThisCycle
 * (Bug #575: the per-cycle count, not the lifetime total); fees are estimated from the time elapsed.
 */
export function activeCycleFigures(ex, now = Date.now()) {
  const remaining = Math.max(0, (ex.endsAt || 0) - now);
  const cycleDuration = (ex.endsAt || 0) - (ex.startedAt || 0);
  const elapsed = Math.min(now - (ex.startedAt || 0), cycleDuration);
  const pct = cycleDuration > 0 ? Math.max(0, Math.min(100, Math.round((elapsed / cycleDuration) * 100))) : 0;
  return {
    pct,
    hrs: Math.floor(remaining / 3_600_000),
    mins: Math.floor((remaining % 3_600_000) / 60_000),
    mined: Number(ex.minedThisCycle || 0),
    fees: Math.round((Math.max(0, elapsed) / 3_600_000) * (ex.operationCostPerHour || 0))
  };
}
