// What an hour of mining is worth at a chosen rate (ISP-86, AB#775): the numbers the extractor panel shows before
// the player commits to a cycle, so the cost curve is visible rather than something they discover afterwards.
//
// The rule lives on the server (server/economy.js, operationCostPerHourFor). This is the client's copy of the same
// arithmetic, fed the server's own constants through /api/bootstrap, and tests/unit/miningProjection.test.js walks
// every throughput from 10 to 250 asserting the two agree. A copy that cannot drift is worth more than a fetch per
// keystroke.

/** The running cost of an hour at this rate: base x T x (1 + (T / T_ref)^2), never below the floor. */
export function costPerHourFor(throughputPerHour, operations) {
  const rate = Math.max(0, Number(throughputPerHour) || 0);
  const base = Number(operations?.costPerThroughputUnit) || 0;
  const ref = Number(operations?.throughputReferencePerHour) || 0;
  const floor = Number(operations?.minCostPerHour) || 0;
  if (!ref) return Math.max(floor, Math.round(rate * base));
  return Math.max(floor, Math.round(rate * base * (1 + (rate / ref) ** 2)));
}

/** What starting a cycle costs up front. */
export function startupCostFor(costPerHour, operations) {
  const share = Number(operations?.startupShareOfHourlyCost) || 0;
  const floor = Number(operations?.minStartupCost) || 0;
  return Math.max(floor, Math.round(Number(costPerHour || 0) * share));
}

/**
 * Revenue, cost and the difference for one hour at a rate. `efficiency` is what the corporation's research has
 * earned it; `unitPrice` and `taxPct` are what the ore fetches and what the sale is taxed.
 */
export function miningProjection(throughputPerHour, { operations, unitPrice, taxPct, efficiency = 1 }) {
  const rate = Math.max(0, Number(throughputPerHour) || 0);
  const revenuePerHour = Math.round(rate * efficiency * (Number(unitPrice) || 0) * (1 - (Number(taxPct) || 0) / 100));
  const costPerHour = costPerHourFor(rate, operations);
  return {
    throughputPerHour: rate,
    revenuePerHour,
    costPerHour,
    profitPerHour: revenuePerHour - costPerHour,
    startupCost: startupCostFor(costPerHour, operations)
  };
}

/** The rate that pays best, walked across the range the rules allow. */
export function bestThroughput({ operations, unitPrice, taxPct, efficiency = 1, min = 10, max = 250 }) {
  let best = { throughputPerHour: min, profitPerHour: -Infinity };
  for (let t = min; t <= max; t += 1) {
    const at = miningProjection(t, { operations, unitPrice, taxPct, efficiency });
    if (at.profitPerHour > best.profitPerHour) best = at;
  }
  return best;
}
