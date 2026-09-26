// What a refinery's run delivers of one output (ISP-97, AB#787): the chain's quantityPerCycle times the batches, and
// 1.5 times that, rounded down to whole units, from a refinery upgraded to a Refinery Complex (tier 2). One rule for
// the server's tick (server/game/refining.js), the start receipt and the Refinery page, so what is quoted is what
// arrives. `multiplier` is data/economy.json's buildings.refineryComplexOutputMultiplier. Pure, so it loads in node.

/**
 * ISP-102 (AB#794): a Refinery's output multiplier at `tier`, from data/economy.json's buildings (sent to the page by
 * GET /api/bootstrap): 1 at tier 1, the Refinery Complex's multiplier at tier 2, and the refineryUpgrades row's above.
 * A tier the data does not have multiplies by 1.
 */
export function refineryMultiplierFor(tier, buildings) {
  const n = Number(tier) || 1;
  if (n <= 1) return 1;
  if (n === 2) return Number(buildings?.refineryComplexOutputMultiplier) || 1;
  return Number((buildings?.refineryUpgrades || []).find((u) => u.toTier === n)?.outputMultiplier) || 1;
}

export function refineryOutput(quantityPerCycle, scale = 1, tier = 1, multiplier = 1) {
  const base = (Number(quantityPerCycle) || 0) * Math.max(1, Number(scale) || 1);
  const m = Number(tier) >= 2 && Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1;
  return Math.floor(base * m);
}
