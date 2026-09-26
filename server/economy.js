// server/economy.js
// The economy's numbers, read once at startup from data/economy.json (AB#726, ISP-40): what things cost, what they
// pay and what they are taxed. The balance pass is a diff of that one file. A file that is missing, malformed or
// holds anything but finite positive numbers stops the server at startup rather than running with a wrong price.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ECONOMY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "economy.json");

const TEXT_KEYS = new Set(["item", "buyer"]);

/** Every number in the file, with its dotted path: ["employees.hireCost", 2000], ["office.termDays.0", 7], ... */
export function economyNumbers(value, prefix = "") {
  if (typeof value === "number") return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => economyNumbers(v, `${prefix}.${i}`));
  if (value && typeof value === "object") {
    // A buyer's item and name are the only words in the file; everything else is a number.
    return Object.entries(value).flatMap(([k, v]) => (TEXT_KEYS.has(k) ? [] : economyNumbers(v, prefix ? `${prefix}.${k}` : k)));
  }
  return [[prefix, value]];
}

/** The problems with an economy object, as sentences; empty when it is sound. */
export function economyProblems(economy) {
  const problems = [];
  if (!economy || typeof economy !== "object" || Array.isArray(economy)) return ["data/economy.json must hold an object."];
  for (const [key, value] of economyNumbers(economy)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) problems.push(`${key} must be a finite positive number, not ${JSON.stringify(value)}.`);
  }
  for (const [i, seed] of (Array.isArray(economy.npcBuyers) ? economy.npcBuyers : []).entries()) {
    if (typeof seed?.item !== "string" || !seed.item.trim() || typeof seed?.buyer !== "string" || !seed.buyer.trim()) problems.push(`npcBuyers.${i} needs an item and a buyer.`);
  }
  if (!Array.isArray(economy.npcBuyers) || economy.npcBuyers.length === 0) problems.push("npcBuyers must list at least one buyer.");
  return problems;
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export function loadEconomy(file = ECONOMY_FILE) {
  const economy = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = economyProblems(economy);
  if (problems.length) throw new Error(`data/economy.json is not usable: ${problems.join(" ")}`);
  return deepFreeze(economy);
}

/** The economy, frozen: nothing at run time can change a price by accident. */
export const ECONOMY = loadEconomy();

// ─── The standing bid (ISP-87, AB#777) ───────────────────────────────────────
//
// A standing buy order used to be a fixed price with a million units a day behind it: no corporation ever reached
// the quota, so the bid absorbed everything anyone could mine and there was never a reason to trade with another
// player (Depth Critique #426 epic 3, and the BRIEF's second measure). It is a floor now, not a ceiling:
//
//   - the quota is a day's work for a working extractor, not a day's work for a planet;
//   - the more is sold into it today, the lower it goes, down to a stated floor and never below;
//   - overnight it recovers most of the way back towards the base price.
//
// A seller dumping volume therefore moves the price against themselves and cannot stall the market for anyone
// else: the floor is what a new corporation is always guaranteed.

/** The bid for an item after `soldToday` units have gone into today's quota. Never below the floor. */
export function npcBidFor(basePrice, soldToday, bid = ECONOMY.npcBid) {
  const base = Math.max(0, Number(basePrice) || 0);
  const quota = Math.max(1, Number(bid?.quotaPerDay) || 1);
  const drift = Math.max(0, Number(bid?.driftAtFullQuotaPct) || 0) / 100;
  const floor = base * (Math.max(0, Number(bid?.floorPct) || 0) / 100);
  const filled = Math.min(1, Math.max(0, Number(soldToday) || 0) / quota);
  return Math.max(Math.round(floor), Math.round(base * (1 - drift * filled)));
}

/**
 * Where a bid sits after a night: most of the way back to the base price. The recovery is of the gap, so a bid
 * that fell hard comes back hard, and one that barely moved barely moves.
 */
export function npcBidAfterRecovery(basePrice, currentBid, bid = ECONOMY.npcBid) {
  const base = Math.max(0, Number(basePrice) || 0);
  const now = Math.max(0, Number(currentBid) || 0);
  const recovery = Math.min(1, Math.max(0, Number(bid?.recoveryPerDayPct) || 0) / 100);
  return Math.round(now + (base - now) * recovery);
}

/** What an extractor yard or refinery costs to build, with the Supply Forecast discount when it is researched. */
export function buildCostFor(baseCost, hasSupplyForecast) {
  return hasSupplyForecast ? Math.round(baseCost * ECONOMY.buildings.supplyForecastCostMultiplier) : baseCost;
}

/**
 * A mining operation's hourly running cost for a throughput (ISP-86, AB#775).
 *
 * The cost rises faster than the rate: `base x T x (1 + (T / T_ref)^2)`. When it was linear, revenue and cost were
 * both straight lines through the origin and the best throughput was always the highest one the rules allowed, so
 * the core verb of the game held no decision at all (Depth Critique #426, T-018). Curved, the profit per hour has
 * a maximum inside the range, and where that maximum sits depends on the price the ore fetches and on the
 * research the corporation owns — which is the decision.
 *
 * It is a tax on rate and never on access: every throughput the rules allow stays startable, and the floor
 * (`minCostPerHour`) is what makes a very low rate a poor deal rather than a free one.
 */
// Every function below takes the live economy's numbers by default (`ECONOMY.operations`), and an optional
// `operations` override so a caller can ask "what would this be under a different economy" — scripts/economy-model.mjs
// uses the override to price the numbers ECONOMY.md quotes from the same file it reads, rather than re-deriving them
// (AB#1754: it used to reimplement this formula from before AB#775 and silently fell out of step with it).
export function operationCostPerHourFor(throughputPerHour, operations = ECONOMY.operations, { yardIndex = 0, buildings = ECONOMY.buildings } = {}) {
  const { minCostPerHour, costPerThroughputUnit, throughputReferencePerHour } = operations;
  const rate = Math.max(0, Number(throughputPerHour) || 0);
  const curved = rate * costPerThroughputUnit * (1 + (rate / throughputReferencePerHour) ** 2);
  return Math.max(minCostPerHour, Math.round(curved)) + yardUpkeepPerHourFor(yardIndex, buildings);
}

/**
 * ISP-301 (AB#2284), ECONOMY.md "Sinks that scale with income" sink 1: every extractor yard after the corporation's
 * first pays an upkeep of extractorYardUpkeepPctPerDay of the yard's price per running day, added to its hourly cost
 * after the floor: 50,000 x 2% / 24 = 41.67. `yardIndex` is the yard's place in corp.mining.silicateExtractors (build
 * order); the first, index 0, pays none. It is charged only while the yard runs, as part of the running cost, so a
 * corporation that cannot pay it mines less (applyMiningOperations' affordabilityRatio) and never owes it.
 * The Board has not seen this number: chosen, not derived (AB#778).
 */
export function yardUpkeepPerHourFor(yardIndex, buildings = ECONOMY.buildings) {
  if (!(Number(yardIndex) > 0)) return 0;
  const perHour = (Number(buildings?.extractorYardCost) || 0) * (Number(buildings?.extractorYardUpkeepPctPerDay) || 0) / 100 / 24;
  return Math.round(perHour * 100) / 100;
}

/**
 * What an hour of mining at this throughput is worth, before and after its running cost: the number the extractor
 * panel shows so the curve is visible rather than hidden. `unitPrice` is what the ore sells for and `taxPct` the
 * sales tax the corporation pays on it; `efficiency` is the multiplier its research has earned.
 */
export function miningProfitPerHourFor(throughputPerHour, { unitPrice, taxPct, efficiency = 1 }, operations = ECONOMY.operations) {
  const rate = Math.max(0, Number(throughputPerHour) || 0);
  const revenue = rate * efficiency * Number(unitPrice || 0) * (1 - Number(taxPct || 0) / 100);
  const cost = operationCostPerHourFor(rate, operations);
  return { revenuePerHour: Math.round(revenue), costPerHour: cost, profitPerHour: Math.round(revenue - cost) };
}

/**
 * The throughput that pays best for a price and a research multiplier, to the nearest whole unit inside the
 * range the rules allow. Walked rather than solved: the floor makes the curve piecewise, and a walk of 241 points
 * is cheaper than being clever about it.
 */
export function bestThroughputFor({ unitPrice, taxPct, efficiency = 1, min = 10, max = 250 }, operations = ECONOMY.operations) {
  let best = { throughput: min, profitPerHour: -Infinity };
  for (let t = min; t <= max; t += 1) {
    const { profitPerHour } = miningProfitPerHourFor(t, { unitPrice, taxPct, efficiency }, operations);
    if (profitPerHour > best.profitPerHour) best = { throughput: t, profitPerHour };
  }
  return best;
}

export function startupCostFor(operationCostPerHour, operations = ECONOMY.operations) {
  return Math.max(operations.minStartupCost, Math.round(operationCostPerHour * operations.startupShareOfHourlyCost));
}
