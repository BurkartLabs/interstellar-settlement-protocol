// server/game/shape.js: part of the game state, split out of server/gameState.js by system (AB#737).

import { ensureFinanceTracking } from "../finances.js";
import { MAX_DEFINED_LEVEL, REFINERY_CHAINS_DATA, STATION_REGISTRY_CACHE, SYSTEMS_BY_ID, SYSTEMS_DATA } from "./catalog.js";
import { refreshExchangeTax } from "./progression.js";
import { ensureCorpMiningModel } from "./mining.js";
import { ensureCorpRefineryModel } from "./refining.js";
import { ensureCorpAsteroidMiningModel } from "./asteroids.js";

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

export function normalizeSystems(systems = []) {
  return systems.map((system) => withCatalogStyles(normalizeSystemBodies(system)));
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
    rawState.world.refineryChains = REFINERY_CHAINS_DATA.chains.map((c) => ({
      id: c.id,
      input: c.input,
      inputQuantityPerCycle: c.inputQuantityPerCycle,
      outputs: c.outputs,
      cycleDurationHours: c.cycleDurationHours,
      requiresResearch: c.requiresResearch,
      requiresTechIds: c.requiresTechIds,
      tier: c.tier,
      category: c.category
    }));
  }

  if (!rawState.corp) {
    rawState.corp = {};
  }

  ensureCorpMiningModel(rawState.corp);

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

  if (!rawState.corp.currentStationId) {
    rawState.corp.currentStationId = "earth-station-prime";
  }

  if (!rawState.corp.currentSystemId) {
    // Derive from current station if possible
    const stationId = rawState.corp.currentStationId;
    if (stationId && STATION_REGISTRY_CACHE) {
      const station = STATION_REGISTRY_CACHE[stationId];
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

