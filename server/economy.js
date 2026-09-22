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

/** What an extractor yard or refinery costs to build, with the Supply Forecast discount when it is researched. */
export function buildCostFor(baseCost, hasSupplyForecast) {
  return hasSupplyForecast ? Math.round(baseCost * ECONOMY.buildings.supplyForecastCostMultiplier) : baseCost;
}

/** A mining operation's hourly running cost for a throughput, and what it costs to start. */
export function operationCostPerHourFor(throughputPerHour) {
  return Math.max(ECONOMY.operations.minCostPerHour, Math.round(throughputPerHour * ECONOMY.operations.costPerThroughputUnit));
}

export function startupCostFor(operationCostPerHour) {
  return Math.max(ECONOMY.operations.minStartupCost, Math.round(operationCostPerHour * ECONOMY.operations.startupShareOfHourlyCost));
}
