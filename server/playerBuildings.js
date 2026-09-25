// The buildings a corporation can build, read once at startup from data/player-buildings.json (AB#783, ISP-93; the
// shape is docs/design/buildings.md, AB#782). Each build route reads its building's cost, asset value, research gates
// and cap from here. A building's price stays in data/economy.json, the one file the balance pass edits (AB#726,
// ECONOMY.md): an entry names it by `price` ("extractorYard" is buildings.extractorYardCost and ...AssetValue), and
// the loaded entry carries it as cost and assetValue. What a building does stays in its route's code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ECONOMY } from "./economy.js";

const CATALOGUE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "player-buildings.json");
const SLOTS = new Set(["corporation", "corporation+lease", "upgrade"]);

/** The problems with a catalogue, as sentences; empty when it is sound. Cross-file checks are the schema test's. */
export function playerBuildingProblems(catalogue, economy = ECONOMY) {
  const buildings = catalogue?.buildings;
  if (!Array.isArray(buildings) || buildings.length === 0) return ["data/player-buildings.json must list its buildings."];
  const problems = [];
  const seen = new Set();
  for (const [i, b] of buildings.entries()) {
    const at = `buildings.${i}${typeof b?.id === "string" ? ` (${b.id})` : ""}`;
    for (const key of ["id", "name", "price", "effect", "since"]) {
      if (typeof b?.[key] !== "string" || !b[key].trim()) problems.push(`${at}.${key} must be a non-empty string.`);
    }
    for (const suffix of ["Cost", "AssetValue"]) {
      const value = economy?.buildings?.[`${b?.price}${suffix}`];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) problems.push(`${at}.price names no buildings.${b?.price}${suffix} in data/economy.json.`);
    }
    if (!SLOTS.has(b?.slot)) problems.push(`${at}.slot must be one of ${[...SLOTS].join(", ")}.`);
    if (!Array.isArray(b?.researchGates) || b.researchGates.some((g) => typeof g !== "string" || !g)) problems.push(`${at}.researchGates must be a list of research ids.`);
    if (!b?.cap || typeof b.cap !== "object" || Array.isArray(b.cap) || Object.values(b.cap).some((n) => !Number.isInteger(n) || n < 1)) {
      problems.push(`${at}.cap must be an object of whole numbers of at least 1.`);
    }
    for (const key of ["id", "name"]) {
      if (seen.has(`${key}:${b?.[key]}`)) problems.push(`${at}.${key} ${JSON.stringify(b[key])} appears twice.`);
      seen.add(`${key}:${b?.[key]}`);
    }
  }
  return problems;
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export function loadPlayerBuildings(file = CATALOGUE_FILE, economy = ECONOMY) {
  const catalogue = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = playerBuildingProblems(catalogue, economy);
  if (problems.length) throw new Error(`data/player-buildings.json is not usable: ${problems.join(" ")}`);
  return deepFreeze(catalogue.buildings.map((b) => ({
    ...b,
    cost: economy.buildings[`${b.price}Cost`],
    assetValue: economy.buildings[`${b.price}AssetValue`]
  })));
}

/** Every player building with its cost and asset value, frozen, in the file's order. Served read-only in /api/bootstrap. */
export const PLAYER_BUILDING_CATALOGUE = loadPlayerBuildings();

/** One building by id; a missing id is a programming error, so it throws rather than returning a default. */
export function playerBuilding(id) {
  const building = PLAYER_BUILDING_CATALOGUE.find((b) => b.id === id);
  if (!building) throw new Error(`No player building "${id}" in data/player-buildings.json.`);
  return building;
}

/** Whether a corporation has every research a building needs. */
export function hasResearchFor(building, corp) {
  const unlocked = corp?.unlockedTech || [];
  return building.researchGates.every((id) => unlocked.includes(id));
}

/** How many of this building the corporation has. */
export function countBuilt(building, corp) {
  return (corp?.buildings || []).filter((b) => b.name === building.name).length;
}

/**
 * Why the catalogue says a corporation cannot build this yet, before slots and money: "missing-research", "at-cap",
 * or null. Every build route asks, so a research gate or cap added to the file is enforced without a code change.
 */
export function catalogueRefusal(building, corp) {
  if (!hasResearchFor(building, corp)) return "missing-research";
  const cap = building.cap.perCorporation;
  if (cap !== undefined && countBuilt(building, corp) >= cap) return "at-cap";
  return null;
}
