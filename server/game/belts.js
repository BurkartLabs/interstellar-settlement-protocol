// server/game/belts.js: asteroid belts as world state (AB#2329, docs/design/belts.md, AB#1050). Each belt slot (a
// Field body in data/systems.json) holds a belt: its generation, its rarity, its composition, its reserve and what
// remains. A slot whose belt was mined out draws on the hour (UTC) and spawns a new belt with the design's chance, its
// rarity from its system's distribution and its composition its tier's template, jittered. The numbers are
// data/economy.json's `belts`. Expeditions mine a belt out of its reserve and call markBeltEmpty on the unit that
// empties it (applyAsteroidExpeditions, AB#2330).

import { ECONOMY } from "../economy.js";
import { SYSTEMS_DATA } from "./catalog.js";
import { BELT_TIERS, beltReserve, drawTier, jitterComposition, nextHourAfter, rarityDistribution, tierTemplates } from "./beltRules.js";

const HOUR = 3_600_000;

/** Every belt slot: its key ("<system id>:<body id>", as scouting and expeditions name it), system, label and today's belt. */
export const BELT_SLOTS = Object.freeze(SYSTEMS_DATA.flatMap((system) => (system.bodies || [])
  .filter((b) => b.composition)
  .map((b) => Object.freeze({ key: `${system.id}:${b.id}`, systemId: system.id, bodyId: b.id, label: system.rarity, composition: b.composition }))));

/** Each tier's composition template, from today's belts (beltRules.tierTemplates). */
export const TIER_TEMPLATES = Object.freeze(tierTemplates(SYSTEMS_DATA));

/** The tiers a belt can be drawn at: those with a template. */
const DRAWABLE_TIERS = BELT_TIERS.filter((t) => TIER_TEMPLATES[t]);

/** A slot's first belt: today's composition and its system's label, full. What an install saved before AB#2329 gets. */
function firstGeneration(slot, now, rules) {
  const reserve = beltReserve(slot.label, rules.reserveStandardExpeditions);
  return { key: slot.key, generation: 1, rarity: slot.label, composition: { ...slot.composition }, reserve, remaining: reserve, spawnedAt: now, emptiedAt: null, lastDrawAt: null };
}

/** Give the global state a belt for every slot it lacks. Keeps what exists. Idempotent. */
export function ensureBeltState(globalState, now = Date.now(), rules = ECONOMY.belts) {
  if (!globalState.belts || typeof globalState.belts !== "object" || Array.isArray(globalState.belts)) globalState.belts = {};
  for (const slot of BELT_SLOTS) {
    if (!globalState.belts[slot.key]) globalState.belts[slot.key] = firstGeneration(slot, now, rules);
  }
  return globalState;
}

/** A new belt in `slot`, generation `generation`, spawned at `at`: rarity from its system's distribution, then its composition and reserve. */
export function spawnBelt(slot, generation, at, rng = Math.random, rules = ECONOMY.belts) {
  const rarity = drawTier(rarityDistribution(slot.label, rules.rarityStepWeight), rng, DRAWABLE_TIERS);
  const composition = jitterComposition(TIER_TEMPLATES[rarity], rules.compositionJitter, rng);
  const reserve = beltReserve(rarity, rules.reserveStandardExpeditions);
  return { key: slot.key, generation, rarity, composition, reserve, remaining: reserve, spawnedAt: at, emptiedAt: null, lastDrawAt: null };
}

/** Whether a slot has a belt in it now. */
export function isBeltPresent(belt) {
  return Boolean(belt) && Number(belt.remaining) > 0;
}

/** The belt in a slot, or null for a key with no slot. */
export function beltAt(globalState, key) {
  return globalState?.belts?.[key] || null;
}

/** AB#2330: when an empty slot next draws: the hour after its last draw, or the first hour after it emptied. */
export function nextBeltDrawAt(belt) {
  if (!belt || isBeltPresent(belt)) return null;
  return belt.lastDrawAt ? belt.lastDrawAt + HOUR : nextHourAfter(Number(belt.emptiedAt) || 0);
}

/** A belt mined out at `now` (the expedition tick calls this when its reserve runs out, AB#2330): nothing remains; the next draw is at the next hour. */
export function markBeltEmpty(globalState, key, now = Date.now()) {
  const belt = beltAt(globalState, key);
  if (!belt) return null;
  belt.remaining = 0;
  belt.emptiedAt = now;
  belt.lastDrawAt = null;
  return belt;
}

/**
 * The hourly draw: for every empty slot, each hour boundary since it emptied (or since its last draw) and up to `now`
 * draws once, and the first that comes up spawns a new belt, dated that hour. Hours missed while the server was down are
 * drawn when it next runs, so a slot's wait does not depend on uptime. Returns the belts that spawned.
 */
export function beltRespawnTick(globalState, now = Date.now(), rng = Math.random, rules = ECONOMY.belts) {
  ensureBeltState(globalState, now, rules);
  const spawned = [];
  for (const slot of BELT_SLOTS) {
    const belt = globalState.belts[slot.key];
    if (isBeltPresent(belt)) continue;
    let hour = belt.lastDrawAt ? belt.lastDrawAt + HOUR : nextHourAfter(Number(belt.emptiedAt) || now);
    for (; hour <= now; hour += HOUR) {
      belt.lastDrawAt = hour;
      if (rng() < rules.respawnChancePerHour) {
        globalState.belts[slot.key] = spawnBelt(slot, (Number(belt.generation) || 0) + 1, hour, rng, rules);
        spawned.push(globalState.belts[slot.key]);
        break;
      }
    }
  }
  return spawned;
}
