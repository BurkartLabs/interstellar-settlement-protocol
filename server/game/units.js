// server/game/units.js: the v0.10 unit catalog (ISP-167, AB#861), data/units.json, from docs/design/v0.10-combat.md.
//
// T-019: a catalog that names something in another catalog stops silently when the other drops it, so this one is
// checked against the item catalog, the research tree and the build sites when it loads, and the server does not
// start while it names something they lack (tests/schema/units.test.js says the same thing in a test).

import fs from "node:fs";
import path from "node:path";
import { RESEARCH_LIBRARY, catalogueDir } from "./catalog.js";
import { ITEMS } from "./items.js";

/** The fields every unit has, and the type each holds. */
export const UNIT_FIELDS = Object.freeze({
  id: "string", name: "string", credits: "number", goods: "object", buildMinutes: "number", builtAt: "string",
  research: "array", supply: "number", upkeepPerDay: "number", attack: "number", hp: "number", accuracy: "number",
  evasion: "number", strongAgainst: "string"
});

/**
 * Where a unit can be built, besides a building in data/player-buildings.json. Headquarters is not a catalogue
 * building: every corporation starts with one (server/game/corporation.js) and nothing builds it.
 */
export const BUILD_SITES_OUTSIDE_CATALOGUE = Object.freeze({ headquarters: "every corporation's Headquarters" });
/**
 * Build sites the design names that no catalogue has yet, each with the story that adds it. Empty since ISP-170 (AB#864)
 * made the Orbital Shipyard a player building. A site here that a catalogue has gained fails tests/schema/units.test.js,
 * so this list only shrinks.
 */
export const PENDING_BUILD_SITES = Object.freeze({}); // ISP-170 (AB#864) catalogued the Orbital Shipyard

const playerBuildingIds = () =>
  JSON.parse(fs.readFileSync(path.join(catalogueDir, "player-buildings.json"), "utf8")).buildings.map((b) => b.id);

/** Every build site a unit may name: the player buildings, Headquarters, and the pending ones. */
export function knownBuildSites(buildingIds = playerBuildingIds()) {
  return new Set([...buildingIds, ...Object.keys(BUILD_SITES_OUTSIDE_CATALOGUE), ...Object.keys(PENDING_BUILD_SITES)]);
}

/**
 * Everything wrong with a unit catalog, as sentences; [] when it is sound. `research` is the research tree's ids,
 * `items` the item catalog's names, `sites` the build sites (knownBuildSites()).
 */
export function unitCatalogProblems(file, { research = new Set(Object.keys(RESEARCH_LIBRARY)), items = new Set(ITEMS.map((i) => i.name)), sites = knownBuildSites() } = {}) {
  const problems = [];
  const units = Array.isArray(file?.units) ? file.units : [];
  if (!units.length) return ["data/units.json has no units."];
  const ids = units.map((u) => u?.id);
  if (new Set(ids).size !== ids.length) problems.push(`unit ids repeat: ${ids.join(", ")}.`);
  for (const u of units) {
    const who = u?.id ?? "a unit with no id";
    for (const [field, type] of Object.entries(UNIT_FIELDS)) {
      const v = u?.[field];
      const ok = type === "array" ? Array.isArray(v) : type === "object" ? v && typeof v === "object" && !Array.isArray(v) : typeof v === type;
      if (!ok) problems.push(`${who}: ${field} should be ${type === "array" ? "a list" : `a ${type}`}.`);
      else if (type === "number" && !(Number.isFinite(v) && v > 0)) problems.push(`${who}: ${field} should be a number above 0.`);
    }
    for (const [good, qty] of Object.entries(u?.goods || {})) {
      if (!items.has(good)) problems.push(`${who} costs "${good}", which data/items.json does not have.`);
      if (!(Number.isInteger(qty) && qty > 0)) problems.push(`${who}: ${good} should be a whole number above 0.`);
    }
    for (const id of u?.research || []) if (!research.has(id)) problems.push(`${who} needs research "${id}", which data/research.json does not have.`);
    if (typeof u?.builtAt === "string" && !sites.has(u.builtAt)) problems.push(`${who} is built at "${u.builtAt}", which no catalogue has.`);
  }
  // The counters: each unit strong against exactly one other and weak against exactly one, in one cycle through all of
  // them (docs/design/v0.10-combat.md section 2). Two smaller cycles would leave a composition with no answer.
  const byId = new Map(units.map((u) => [u.id, u]));
  const targets = units.map((u) => u.strongAgainst);
  for (const u of units) {
    if (!byId.has(u.strongAgainst) || u.strongAgainst === u.id) problems.push(`${u.id} is strong against "${u.strongAgainst}", which is not another unit.`);
  }
  if (new Set(targets).size !== units.length) problems.push("each unit must be the prey of exactly one other: strongAgainst repeats a target.");
  if (!problems.length) {
    const seen = new Set();
    for (let at = units[0].id; !seen.has(at); at = byId.get(at).strongAgainst) seen.add(at);
    if (seen.size !== units.length) problems.push(`the counters make more than one cycle (one of them is ${[...seen].join(" > ")}).`);
  }
  const c = file?.counters;
  if (!(c && c.strong > 1 && c.weak > 0 && c.weak < 1 && Math.abs(c.strong * c.weak - 1) < 1e-9)) {
    problems.push("counters should be { strong, weak } with strong above 1 and weak its reciprocal.");
  }
  return problems;
}

export const unitsPath = path.join(catalogueDir, "units.json");
export const UNITS_DATA = JSON.parse(fs.readFileSync(unitsPath, "utf8"));
{
  const problems = unitCatalogProblems(UNITS_DATA);
  if (problems.length) throw new Error(`data/units.json (AB#861): ${problems.join(" ")}`);
}
/** Each unit by id. */
export const UNITS = Object.freeze(Object.fromEntries(UNITS_DATA.units.map((u) => [u.id, Object.freeze({ ...u })])));
export const UNIT_IDS = Object.freeze(UNITS_DATA.units.map((u) => u.id));

/** The legacy corp.military counters (before v0.10) and the unit each one is. */
export const LEGACY_MILITARY_FIELDS = Object.freeze({ lightFighters: "lf", destroyers: "ds", siegeEngines: "se" });

/** A corporation's units in the catalog's terms: attack is what they deal a round, defense the damage they absorb. */
export function militaryPower(units = {}) {
  let attack = 0, defense = 0;
  for (const id of UNIT_IDS) {
    const n = Math.max(0, Math.floor(Number(units[id]) || 0));
    attack += n * UNITS[id].attack;
    defense += n * UNITS[id].hp;
  }
  return { attack, defense };
}

/**
 * The shape corp.military has since AB#861: { units: { lf, ds, se, at, dt }, modifiers, power }. A save from before
 * keeps its fighters, destroyers and siege engines as units; its attackValue and defenseValue were figures typed into
 * the seed, not derived from anything, so they go, and power is worked out from the units every time. Returns true
 * when it changed something; running it on its own output changes nothing.
 */
export function ensureCorpMilitary(corp) {
  if (!corp || typeof corp !== "object") return false;
  const before = JSON.stringify(corp.military ?? null);
  const m = corp.military && typeof corp.military === "object" ? corp.military : {};
  const units = m.units && typeof m.units === "object" ? { ...m.units } : {};
  for (const [legacy, id] of Object.entries(LEGACY_MILITARY_FIELDS)) {
    if (legacy in m && units[id] == null) units[id] = m[legacy];
  }
  const clean = Object.fromEntries(UNIT_IDS.map((id) => [id, Math.max(0, Math.floor(Number(units[id]) || 0))]));
  const modifiers = { rdBonusPct: 0, ceoLeadershipPct: 0, ...(m.modifiers || {}) };
  corp.military = { units: clean, modifiers, power: militaryPower(clean) };
  return JSON.stringify(corp.military) !== before;
}

/** The load-time migration: ensureCorpMilitary for every corporation in the store. Returns how many changed. */
export function backfillCorpMilitary(accounts, log = console.warn) {
  let migrated = 0, failed = 0;
  for (const account of Object.values(accounts || {})) {
    const corp = account?.state?.corp;
    if (!corp) continue;
    try { if (ensureCorpMilitary(corp)) migrated += 1; } catch { failed += 1; }
  }
  if (failed) log(`[military] ${failed} corporation(s) could not be given the unit catalog's shape (AB#861); left unchanged.`);
  return { migrated, failed };
}
