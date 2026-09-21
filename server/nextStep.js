// What a refused gameplay action should tell the player to do next (Bug #1058): the employee cap, a mining cycle's
// start-up cost and a contract's delivery. Each names only actions the game has (Bug #1057's lesson): the level
// requirements on the Overview, the throughput field on the lease page, the Galactic Exchange's standing buy orders,
// travel between stations and Logistics transfers.

/**
 * The next corporation level whose `key` unlock is higher than `have`, as { level, value }, or null. Levels apply
 * their unlocks as a maximum (evaluateLevelProgress), so a level that is not higher changes nothing.
 */
export function nextLevelRaising(levels, corp, key, have) {
  return [...(levels || [])]
    .filter((l) => l.level > (corp?.level || 0) && Number(l.unlocks?.[key]) > have)
    .sort((a, b) => a.level - b.level)
    .map((l) => ({ level: l.level, value: l.unlocks[key] }))[0] || null;
}

/** The employee cap is reached. */
export function employeeCapMessage(corp, levels) {
  const cap = corp?.employeeCap || 0;
  const head = `Employee cap reached: ${corp?.employeeCount || 0}/${cap} on payroll.`;
  const next = nextLevelRaising(levels, corp, "employeeCap", cap);
  if (!next) return `${head} That is the highest cap in the game.`;
  return `${head} Reaching corporation level ${next.level} raises the cap to ${next.value}; the Overview lists what the next level needs.`;
}

/** The throughput at or below which a mining cycle starts for the minimum cost. Mirrors start-mining's formula. */
export const MINING_MIN_STARTUP = 500;
export const MINING_CHEAPEST_THROUGHPUT = Math.floor(MINING_MIN_STARTUP / (16 * 0.35));

/** What to add to "Starting this mining cycle requires N credits." */
export function miningCreditsAdvice(startupCost) {
  const cheaper = startupCost > MINING_MIN_STARTUP
    ? `A throughput of ${MINING_CHEAPEST_THROUGHPUT} t/h or less starts for ${MINING_MIN_STARTUP} credits. `
    : "";
  return `${cheaper}Selling stock to the standing buy orders on the Galactic Exchange raises credits.`;
}

/**
 * A contract's delivery falls short at the station the corporation is docked at. `inventory` is corp.inventory
 * ({ stationId: { item: qty } }); `stationName(id)` names a station.
 */
export function missionShortMessage({ resource, required, stationId, inventory, stationName }) {
  const here = Number(inventory?.[stationId]?.[resource] || 0);
  const head = `This contract needs ${required.toLocaleString("en-US")} ${resource} delivered where you are docked, ${stationName(stationId)}; you have ${here.toLocaleString("en-US")} here.`;
  const elsewhere = Object.entries(inventory || {})
    .filter(([id, items]) => id !== stationId && Number(items?.[resource]) > 0)
    .map(([id, items]) => ({ id, qty: Number(items[resource]) }))
    .sort((a, b) => b.qty - a.qty);
  if (elsewhere.length) {
    const best = elsewhere[0];
    return `${head} You hold ${best.qty.toLocaleString("en-US")} at ${stationName(best.id)}: move it here with a Logistics transfer, or travel there and complete the contract from that station.`;
  }
  return `${head} Mine, refine or buy the rest on the Galactic Exchange.`;
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/** data/milestones.json's levels, read here so the routes need no other import. */
export const LEVELS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "milestones.json"), "utf8")).levels;
