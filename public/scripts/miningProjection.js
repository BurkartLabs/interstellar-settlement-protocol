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

/**
 * ISP-301 (AB#2284): the upkeep an extractor yard pays per running hour, 0 for the corporation's first
 * extractorYardsInStartingKit (two since ISP-308, AB#2304). The server's yardUpkeepPerHourFor, from the same bootstrap
 * constants; tests/unit/miningProjection.test.js holds the two equal.
 */
export function yardUpkeepPerHourFor(yardIndex, buildings) {
  const freeYards = Number(buildings?.extractorYardsInStartingKit) || 1;
  if (!(Number(yardIndex) >= freeYards)) return 0;
  const perHour = (Number(buildings?.extractorYardCost) || 0) * (Number(buildings?.extractorYardUpkeepPctPerDay) || 0) / 100 / 24;
  return Math.round(perHour * 100) / 100;
}

/**
 * ISP-101 (AB#793): what a yard's tier sets, from the bootstrap constants: its running cost's reference throughput and
 * its cap. The server's yardTierFor (server/economy.js); tests/unit/miningProjection.test.js holds the two equal. An
 * unknown tier runs as tier 1, as on the server.
 */
export function yardTierFor(tier, operations, buildings) {
  const row = (buildings?.extractorYardUpgrades || []).find((u) => u.toTier === Number(tier));
  if (Number(tier) > 1 && row) return { tier: Number(tier), throughputReferencePerHour: row.throughputReferencePerHour, throughputCap: row.throughputCap };
  return { tier: 1, throughputReferencePerHour: Number(operations?.throughputReferencePerHour) || 0, throughputCap: 250 };
}

/** The operations constants with a tier's reference throughput in place of tier 1's, for costPerHourFor. */
export function operationsForTier(tier, operations, buildings) {
  return { ...operations, throughputReferencePerHour: yardTierFor(tier, operations, buildings).throughputReferencePerHour };
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
export function miningProjection(throughputPerHour, { operations, unitPrice, taxPct, efficiency = 1, upkeepPerHour = 0 }) {
  const rate = Math.max(0, Number(throughputPerHour) || 0);
  const revenuePerHour = Math.round(rate * efficiency * (Number(unitPrice) || 0) * (1 - (Number(taxPct) || 0) / 100));
  const baseCostPerHour = costPerHourFor(rate, operations);
  // AB#2284: upkeep is charged by the hour and not in the startup, as on the server.
  const costPerHour = baseCostPerHour + (Number(upkeepPerHour) || 0);
  return {
    throughputPerHour: rate,
    revenuePerHour,
    costPerHour,
    upkeepPerHour: Number(upkeepPerHour) || 0,
    profitPerHour: Math.round((revenuePerHour - costPerHour) * 100) / 100,
    startupCost: startupCostFor(baseCostPerHour, operations)
  };
}

/** The rate that pays best, walked across the range the rules allow. */
export function bestThroughput({ operations, unitPrice, taxPct, efficiency = 1, upkeepPerHour = 0, min = 10, max = 250 }) {
  let best = { throughputPerHour: min, profitPerHour: -Infinity };
  for (let t = min; t <= max; t += 1) {
    const at = miningProjection(t, { operations, unitPrice, taxPct, efficiency, upkeepPerHour });
    if (at.profitPerHour > best.profitPerHour) best = at;
  }
  return best;
}
