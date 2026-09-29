// server/game/shape.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { ensureFinanceTracking } from "../finances.js";
import { MAX_DEFINED_LEVEL, REFINERY_CHAINS_DATA, SYSTEMS_BY_ID, SYSTEMS_DATA, deepClone } from "./catalog.js";
import { stationById } from "./stations.js"; // ISP-209 (AB#904)
import { refreshExchangeTax } from "./progression.js";
import { ensureCorpMiningModel } from "./mining.js";
import { ensureCorpRefineryModel } from "./refining.js";
import { ensureCorpAsteroidMiningModel } from "./asteroids.js";
import { ensureCorpMilitary } from "./units.js";

// AB#742, Bug #2112: how a body is drawn, and which planet a moon orbits, are catalogue, not state. A saved world keeps
// the bodies it was created with, so a style or parentId added to data/systems.json later would never reach an existing
// install; both are taken from the catalogue on every load.
const CATALOG_FIELDS = ["style", "parentId"];
const CATALOG_BODIES = new Map(SYSTEMS_DATA.flatMap((system) => (system.bodies || []).map((b) => [b.id, b])));
function withCatalogStyles(system) {
  if (!Array.isArray(system.bodies)) return system;
  return {
    ...system,
    bodies: system.bodies.map((body) => {
      const catalog = CATALOG_BODIES.get(body.id);
      if (!catalog) return body;
      const merged = { ...body };
      for (const field of CATALOG_FIELDS) if (catalog[field] !== undefined) merged[field] = catalog[field];
      return merged;
    })
  };
}

// ISP-114 (AB#806): every per-system fact is the catalog's on every load (data/systems.json, the one source since
// AB#804), and a system added to the catalog joins a saved world. Before, a saved world kept the systems, positions
// and lanes it was created with, so an install would never see a new system or a moved one. A saved system keeps
// its own bodies, as normalizeSystemBodies always has; a system the catalog no longer has is kept, after the rest.
const CATALOG_SYSTEM_FIELDS = ["name", "gdpIndex", "pirateDensity", "activityLevel", "ownerRule", "accessResearch", "rarity", "mapPosition", "adjacent"];

export function normalizeSystems(systems = []) {
  const saved = new Map((systems || []).map((system) => [system.id, system]));
  const fromCatalog = SYSTEMS_DATA.map((catalog) => {
    const system = saved.has(catalog.id) ? normalizeSystemBodies(saved.get(catalog.id)) : deepClone(catalog);
    const merged = { ...system };
    for (const field of CATALOG_SYSTEM_FIELDS) if (catalog[field] !== undefined) merged[field] = deepClone(catalog[field]);
    return withCatalogStyles(merged);
  });
  const retired = (systems || []).filter((system) => !SYSTEMS_BY_ID.has(system.id)).map((system) => withCatalogStyles(system));
  return [...fromCatalog, ...retired];
}

function normalizeSystemBodies(system) {
  const defaults = SYSTEMS_BY_ID.get(system.id); // ISP-112 (AB#804): the catalog, data/systems.json
  if (!defaults) {
    return system;
  }

  const isOutdatedSolCatalog =
    system.id === "sol" && (!Array.isArray(system.bodies) || system.bodies.length < 10);

  return {
    ...system,
    ownerRule: system.ownerRule || defaults.ownerRule,
    bodies: isOutdatedSolCatalog
      ? defaults.bodies
      : Array.isArray(system.bodies) && system.bodies.length
        ? system.bodies
        : defaults.bodies
  };
}

export function normalizeStateShape(rawState) {
  if (rawState.world) {
    rawState.world.systems = normalizeSystems(rawState.world.systems || []);
    // Always rebuild refineryChains from the canonical data file so that
    // older persisted shapes (e.g. outputs as plain strings) are upgraded.
    rawState.world.resourceCatalog = [...REFINERY_CHAINS_DATA.resourceCatalog]; // AB#2353: the page's Resource catalog
    rawState.world.refineryChains = REFINERY_CHAINS_DATA.chains.map((c) => ({
      id: c.id,
      inputs: c.inputs, // AB#825: [{ item, quantityPerCycle }], one or several
      outputs: c.outputs,
      cycleDurationHours: c.cycleDurationHours,
      requiresResearch: c.requiresResearch,
      requiresTechIds: c.requiresTechIds,
      stage: c.stage, // AB#825: tier3-recipes.md's stage; the old `tier` was not an item tier
      category: c.category,
      building: c.building || "refinery" // ISP-189 (AB#883): where it runs, a Refinery or the Synthesis Array
    }));
  }

  if (!rawState.corp) {
    rawState.corp = {};
  }

  ensureCorpMiningModel(rawState.corp);
  ensureCorpMilitary(rawState.corp); // AB#861: the unit catalog's shape, with its power

  if (!rawState.corp.inventory || typeof rawState.corp.inventory !== "object") {
    rawState.corp.inventory = {};
  }

  // Migrate flat inventory { item: qty } → per-station { stationId: { item: qty } }
  const invKeys = Object.keys(rawState.corp.inventory);
  const isFlat = invKeys.length > 0 && invKeys.some((k) => typeof rawState.corp.inventory[k] === "number");
  if (isFlat) {
    const stationId = rawState.corp.currentStationId || "earth-station-prime";
    rawState.corp.inventory = { [stationId]: { ...rawState.corp.inventory } };
  }

  if (!Array.isArray(rawState.corp.unlockedTech)) {
    rawState.corp.unlockedTech = [];
  }

  if (!rawState.playerProfile) {
    rawState.playerProfile = {
      isNewPlayer: true,
      registeredAt: Date.now(),
      walkthroughCompleted: false
    };
  }

  if (typeof rawState.playerProfile.walkthroughCompleted !== "boolean") {
    rawState.playerProfile.walkthroughCompleted = false;
  }

  if (!rawState.corp.location) {
    rawState.corp.location = "Earth";
  }
  // Bug #4856: an interstellar arrival once wrote the system's id ("sol", "epsilon-eridani") as the location; a save that
  // still holds one reads the system's name until the corporation next docks
  if (SYSTEMS_BY_ID.has(rawState.corp.location)) {
    rawState.corp.location = SYSTEMS_BY_ID.get(rawState.corp.location).name;
  }

  if (!rawState.corp.currentStationId) {
    rawState.corp.currentStationId = "earth-station-prime";
  }

  if (!rawState.corp.currentSystemId) {
    // Derive from current station if possible
    const stationId = rawState.corp.currentStationId;
    if (stationId) {
      const station = stationById(stationId);
      rawState.corp.currentSystemId = station?.systemId || "sol";
    } else {
      rawState.corp.currentSystemId = "sol";
    }
  }

  if (rawState.corp.travel === undefined) {
    rawState.corp.travel = null;
  }

  rawState.corp.levelCap = MAX_DEFINED_LEVEL; // Bug #424
  if (!Array.isArray(rawState.corp.milestonesCompleted)) {
    rawState.corp.milestonesCompleted = [];
  }

  if (!Array.isArray(rawState.corp.offices)) {
    rawState.corp.offices = [];
  }

  if (!Array.isArray(rawState.corp.miningLeases)) {
    rawState.corp.miningLeases = [];
  }

  if (!Array.isArray(rawState.corp.tradeHistory)) {
    rawState.corp.tradeHistory = [];
  }

  if (!Array.isArray(rawState.corp.activeMissions)) {
    rawState.corp.activeMissions = [];
  }

  if (!Array.isArray(rawState.corp.completedMissions)) {
    rawState.corp.completedMissions = [];
  }

  if (!rawState.corp.agentReputation || typeof rawState.corp.agentReputation !== "object") {
    rawState.corp.agentReputation = {};
  }

  if (!rawState.corp.contractOfferings || typeof rawState.corp.contractOfferings !== "object") {
    rawState.corp.contractOfferings = { missions: [], nextRefreshAt: 0 };
  }

  if (!rawState.corp.finances) rawState.corp.finances = {};
  ensureFinanceTracking(rawState.corp);
  if (!Array.isArray(rawState.corp.completedInsights)) {
    rawState.corp.completedInsights = [];
  }

  // Always reconcile the tax rate and its breakdown from insights and leases held (ISP-302, AB#2285)
  refreshExchangeTax(rawState);

  if (!rawState.queues) rawState.queues = {};
  if (!Array.isArray(rawState.queues.ceoInsight)) {
    rawState.queues.ceoInsight = [];
  }

  // Normalize each lease: ensure extractorIds array exists
  rawState.corp.miningLeases = rawState.corp.miningLeases.map((l) => ({
    ...l,
    extractorIds: Array.isArray(l.extractorIds) ? l.extractorIds : []
  }));

  ensureCorpRefineryModel(rawState.corp);
  ensureCorpAsteroidMiningModel(rawState.corp);

  return rawState;
}

