// What to do when a contract's delivery falls short (Bug #1058). Shared by the complete-mission route's refusal and
// the contract window's quota, which is where a player sees the shortfall: the page hides Complete until it is met.
//
// The page completes a contract only at the agent's station (openMissionModal), so the advice never says "travel
// somewhere else and complete it there": it names Logistics transfers, which bring stock to where you are, and the
// ways to get more. (The route does not check the agent's station: Bug #1203.)

/**
 * `inventory` is corp.inventory ({ stationId: { item: qty } }); `stationName(id)` names a station.
 * Returns the full message: what is needed where, what is here, and the next step.
 */
export function missionShortMessage({ resource, required, stationId, inventory, stationName }) {
  const here = Number(inventory?.[stationId]?.[resource] || 0);
  const head = `This contract needs ${required.toLocaleString("en-US")} ${resource} delivered where you are docked, ${stationName(stationId)}; you have ${here.toLocaleString("en-US")} here.`;
  return `${head} ${missionShortAdvice({ resource, stationId, inventory, stationName })}`;
}

/** The next step alone, for the contract window, which already shows the counts. */
export function missionShortAdvice({ resource, stationId, inventory, stationName }) {
  const elsewhere = Object.entries(inventory || {})
    .filter(([id, items]) => id !== stationId && Number(items?.[resource]) > 0)
    .map(([id, items]) => ({ id, qty: Number(items[resource]) }))
    .sort((a, b) => b.qty - a.qty);
  if (elsewhere.length) {
    const best = elsewhere[0];
    return `You hold ${best.qty.toLocaleString("en-US")} at ${stationName(best.id)}: move it here with a Logistics transfer.`;
  }
  return "Mine, refine or buy the rest on the Galactic Exchange.";
}
