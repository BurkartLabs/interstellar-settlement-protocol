import "./loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { welcomeLetter } from "../public/scripts/liaison.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Bug #578: two directories. The game's catalogues (stations, systems, research and the rest) ship with the code in
// data/. What the server writes, state.json and accounts-snapshot.json, goes to ISP_DATA_DIR: a mounted volume in the
// container, data/ when it is not set. The test process points it at an empty directory of its own, so every run
// starts from the seed and never reads what a local server last wrote (Bug #588).
const catalogueDir = path.join(__dirname, "..", "data");
export const dataDir = process.env.ISP_DATA_DIR ? path.resolve(process.env.ISP_DATA_DIR) : catalogueDir;
const statePath = path.join(dataDir, "state.json");
const accountsSnapshotPath = path.join(dataDir, "accounts-snapshot.json");
const milestonesPath = path.join(catalogueDir, "milestones.json");
const PASSWORD_SALT_ROUNDS = 10;

import { recordExpense, ensureFinanceTracking } from "./finances.js";
import { unknownLeaseBodies } from "./leases.js";
import { directInvestmentRecords } from "./legacyInvestments.js";
import { validateCorporationName, SYSTEM_SENDERS, CORPORATION_NAME_MAX_LENGTH } from "./corporationName.js";

// Load station data for body→station mapping
const STATIONS_RAW = JSON.parse(fs.readFileSync(path.join(catalogueDir, "stations.json"), "utf8"));
const BODY_TO_STATION = {};
const STATION_REGISTRY_CACHE = {};
for (const station of STATIONS_RAW.stations) {
  BODY_TO_STATION[station.body] = station.id;
  STATION_REGISTRY_CACHE[station.id] = station;
}

// The data directory may be a new, empty volume. Clean up any leftover .tmp files from interrupted atomic writes.
fs.mkdirSync(dataDir, { recursive: true });
for (const file of fs.readdirSync(dataDir)) {
  if (file.endsWith(".tmp")) {
    try { fs.unlinkSync(path.join(dataDir, file)); } catch {}
  }
}

function safeWriteFile(filePath, data) {
  {
    // Atomic write: write to a temp file then rename, so a mid-write kill
    // (e.g. double Ctrl+C or node --watch termination) never truncates the real file.
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, data, "utf8");
    // On Windows + OneDrive, the destination is occasionally locked by the sync
    // client which triggers EPERM/EBUSY on rename. Retry briefly, then fall back
    // to a direct in-place write so we don't lose the snapshot entirely.
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        return true;
      } catch (err) {
        lastErr = err;
        if (err?.code !== "EPERM" && err?.code !== "EBUSY" && err?.code !== "EACCES") break;
        // Tight retry — OneDrive's destination lock usually clears in a few ms.
      }
    }
    // Final fallback: direct overwrite (non-atomic but better than nothing).
    try {
      fs.writeFileSync(filePath, data, "utf8");
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      return true;
    } catch (writeErr) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      throw lastErr || writeErr;
    }
  }
}

// ─── Milestones: single source of truth from data/milestones.json ──────────
const MILESTONES_DATA = JSON.parse(fs.readFileSync(milestonesPath, "utf8"));
const MILESTONE_LEVELS = MILESTONES_DATA.levels;
// The top of the ladder is the highest level the data defines (Bug #424: the cap shown to players was a literal 40).
export const MAX_DEFINED_LEVEL = Math.max(...MILESTONE_LEVELS.map((l) => l.level));           // [{level, requirements, unlocks}, ...]
const MILESTONE_ROADMAP = MILESTONES_DATA.roadmap;          // ["Rent an Office", ...]

// ─── CEO Insight programs ────────────────────────────────────────────────────
const ceoInsightPath = path.join(catalogueDir, "ceo-insight.json");
const CEO_INSIGHT_DATA = JSON.parse(fs.readFileSync(ceoInsightPath, "utf8"));
const CEO_INSIGHT_LIBRARY = {};
for (const prog of CEO_INSIGHT_DATA.programs) {
  CEO_INSIGHT_LIBRARY[prog.id] = prog;
}

// ─── Systems: single source of truth from data/systems.json ────────────────
const SYSTEMS_DATA = JSON.parse(fs.readFileSync(path.join(catalogueDir, "systems.json"), "utf8"));

// ─── Refinery chains ────────────────────────────────────────────────────────
const refineryChainsPath = path.join(catalogueDir, "refinery-chains.json");
const REFINERY_CHAINS_DATA = JSON.parse(fs.readFileSync(refineryChainsPath, "utf8"));
const REFINERY_CHAINS = {};
for (const chain of REFINERY_CHAINS_DATA.chains) {
  REFINERY_CHAINS[chain.id] = chain;
}

// Build a lookup from requirement id → display title (for milestonesCompleted tracking)
const REQ_ID_TO_TITLE = {};
for (const lvl of MILESTONE_LEVELS) {
  for (const req of lvl.requirements) {
    REQ_ID_TO_TITLE[req.id] = req.title;
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
/* TODO(AB#804): This should be fetched from systems.json, see SYSTEMS_DATA */
const SYSTEM_DETAILS = {
  sol: {
    ownerRule: "No direct ownership. Mining rights are leased.",
    bodies: [
      { id: "mercury", name: "Mercury", type: "Planet", x: 58, y: 0, radius: 4 },
      { id: "venus", name: "Venus", type: "Planet", x: 90, y: 0, radius: 6 },
      { id: "earth", name: "Earth", type: "Planet", x: 122, y: 0, radius: 7 },
      { id: "mars", name: "Mars", type: "Planet", x: 156, y: 0, radius: 5 },
      { id: "belt", name: "Asteroid Belt", type: "Field", x: 196, y: 0, radius: 13 },
      { id: "jupiter", name: "Jupiter", type: "Planet", x: 238, y: 0, radius: 12 },
      { id: "saturn", name: "Saturn", type: "Planet", x: 284, y: 0, radius: 11 },
      { id: "uranus", name: "Uranus", type: "Planet", x: 326, y: 0, radius: 9 },
      { id: "neptune", name: "Neptune", type: "Planet", x: 366, y: 0, radius: 9 },
      { id: "luna", name: "Luna", type: "Moon", parentId: "earth", x: 0, y: 0, radius: 2 },
      { id: "phobos", name: "Phobos", type: "Moon", parentId: "mars", x: 0, y: 0, radius: 2 },
      { id: "deimos", name: "Deimos", type: "Moon", parentId: "mars", x: 0, y: 0, radius: 2 },
      { id: "io", name: "Io", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 2 },
      { id: "europa", name: "Europa", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 2 },
      { id: "ganymede", name: "Ganymede", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 3 },
      { id: "callisto", name: "Callisto", type: "Moon", parentId: "jupiter", x: 0, y: 0, radius: 3 },
      { id: "titan", name: "Titan", type: "Moon", parentId: "saturn", x: 0, y: 0, radius: 3 },
      { id: "enceladus", name: "Enceladus", type: "Moon", parentId: "saturn", x: 0, y: 0, radius: 2 }
    ]
  },
  "alpha-centauri": {
    ownerRule: "Neutral authority oversight with corporate lease competition.",
    bodies: [
      { id: "ac-prime", name: "Centauri Prime", type: "Planet", x: 50, y: 0, radius: 7 },
      { id: "ac-ii", name: "Centauri II", type: "Planet", x: 86, y: 0, radius: 5 },
      { id: "ac-haven", name: "Haven", type: "Moon", x: 102, y: 0, radius: 3 },
      { id: "ac-belt", name: "Centauri Belt", type: "Field", x: 126, y: 0, radius: 10 }
    ]
  },
  "barnards-star": {
    ownerRule: "Frontier charter system with low-regulation extraction rights.",
    bodies: [
      { id: "bn-iron", name: "Ironwell", type: "Planet", x: 48, y: 0, radius: 6 },
      { id: "bn-cinder", name: "Cinder", type: "Planet", x: 82, y: 0, radius: 4 },
      { id: "bn-arc", name: "Arcadia", type: "Moon", x: 103, y: 0, radius: 3 },
      { id: "bn-rift", name: "Rift Debris Ring", type: "Field", x: 132, y: 0, radius: 11 }
    ]
  },
  "wolf-359": {
    ownerRule: "High-risk conflict zone with arbitration-based claims.",
    bodies: [
      { id: "wf-halo", name: "Halo", type: "Planet", x: 44, y: 0, radius: 5 },
      { id: "wf-garnet", name: "Garnet", type: "Planet", x: 77, y: 0, radius: 6 },
      { id: "wf-veil", name: "Veil", type: "Moon", x: 92, y: 0, radius: 3 },
      { id: "wf-shards", name: "Shard Belt", type: "Field", x: 126, y: 0, radius: 10 }
    ]
  },
  "tau-ceti": {
    ownerRule: "Treaty-governed commercial corridor with tariff controls.",
    bodies: [
      { id: "tc-verde", name: "Verde", type: "Planet", x: 47, y: 0, radius: 7 },
      { id: "tc-lumen", name: "Lumen", type: "Planet", x: 84, y: 0, radius: 5 },
      { id: "tc-aqua", name: "Aqua Minor", type: "Moon", x: 101, y: 0, radius: 3 },
      { id: "tc-cloud", name: "Tau Ice Cloud", type: "Field", x: 128, y: 0, radius: 11 }
    ]
  },
  "epsilon-eridani": {
    ownerRule: "Semi-private jurisdiction with licensed station authorities.",
    bodies: [
      { id: "ee-kestrel", name: "Kestrel", type: "Planet", x: 46, y: 0, radius: 6 },
      { id: "ee-orion", name: "Orion Reach", type: "Planet", x: 78, y: 0, radius: 5 },
      { id: "ee-lyra", name: "Lyra", type: "Moon", x: 95, y: 0, radius: 3 },
      { id: "ee-crown", name: "Crown Belt", type: "Field", x: 124, y: 0, radius: 10 }
    ]
  }
};

function normalizeSystems(systems = []) {
  return systems.map((system) => {
    const defaults = SYSTEM_DETAILS[system.id]; // TODO(AB#804): Update to use SYSTEMS_DATA
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
  });
}

function normalizeStateShape(rawState) {
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

  // Always reconcile tax rate from completedInsights (authoritative source)
  rawState.corp.finances.exchangeSalesTaxPct = getEffectiveExchangeTaxRate(rawState);

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

function ensureCorpMiningModel(corp) {
  if (!corp.mining || typeof corp.mining !== "object") {
    corp.mining = {};
  }

  if (!Array.isArray(corp.mining.silicateExtractors)) {
    corp.mining.silicateExtractors = [];
  }

  // Migrate legacy single extractor model into the multi-extractor array only if it has real data.
  // TODO(AB#737): Is this still needed?
  const legacyExtractor = corp.mining.silicateExtractor;
  const legacyHasData = Boolean(
    legacyExtractor &&
      (legacyExtractor.active ||
        Number(legacyExtractor.totalMined || 0) > 0 ||
        Number(legacyExtractor.totalSpent || 0) > 0 ||
        Number(legacyExtractor.throughputPerHour || 0) > 0 ||
        legacyExtractor.startedAt ||
        legacyExtractor.endsAt)
  );

  if (legacyHasData && !corp.mining.silicateExtractors.length) {
    corp.mining.silicateExtractors.push({
      id: "ext-basic-1",
      name: "Basic Extractor Yard #1",
      tier: 1,
      ...legacyExtractor
    });
  }

  const builtExtractorCount = (corp.buildings || []).filter((b) => b.name === "Basic Extractor Yard").length;
  while (corp.mining.silicateExtractors.length < builtExtractorCount) {
    const nextIndex = corp.mining.silicateExtractors.length + 1;
    corp.mining.silicateExtractors.push({
      id: `ext-basic-${nextIndex}`,
      name: `Basic Extractor Yard #${nextIndex}`,
      tier: 1,
      active: false,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      throughputPerHour: 0,
      operationCostPerHour: 0,
      totalMined: 0,
      minedRemainder: 0,
      totalSpent: 0,
      lastCompletedAt: null,
      downtimeActive: false,
      downtimeStartedAt: null,
      downtimeRecoveredAt: null
    });
  }

  corp.mining.silicateExtractors = corp.mining.silicateExtractors.map((extractor, index) => {
    // Bulletproof downtime: if downtimeActive is true and downtimeStartedAt is missing, set it to now
    let downtimeStartedAt = extractor.downtimeStartedAt;
    if (extractor.downtimeActive && (!downtimeStartedAt || downtimeStartedAt === 0)) {
      downtimeStartedAt = Date.now();
    }
    let throughput = Number(extractor.throughputPerHour || 0);
    let operationCost = Number(extractor.operationCostPerHour || 0);
    // Only auto-fix throughput/cost if NOT active
    if (!extractor.active) {
      if (throughput <= 0) throughput = 40;
      if (operationCost <= 0) operationCost = Math.max(600, Math.round(throughput * 16));
    }
    const normalized = {
      id: String(extractor.id || `ext-basic-${index + 1}`),
      name: String(extractor.name || `Basic Extractor Yard #${index + 1}`),
      tier: Number(extractor.tier || 1),
      active: Boolean(extractor.active),
      startedAt: extractor.startedAt ?? null,
      lastTickAt: extractor.lastTickAt ?? null,
      endsAt: extractor.endsAt ?? null,
      throughputPerHour: throughput,
      operationCostPerHour: operationCost,
      totalMined: Number(extractor.totalMined || 0),
      // AB#575: this cycle's output, zeroed by startExtractorCycle; totalMined is the lifetime.
      minedThisCycle: Math.max(0, Number(extractor.minedThisCycle || 0)),
      minedRemainder: Math.max(0, Number(extractor.minedRemainder || 0)),
      totalSpent: Number(extractor.totalSpent || 0),
      lastCompletedAt: extractor.lastCompletedAt ?? null,
      leaseId: extractor.leaseId ?? null,
      // Authoritative location string (planet/moon name). Persisted on the
      // extractor row directly so we don't have to chase leaseId references
      // across hydrations to know where the yard physically lives.
      body: extractor.body ?? null,
      downtimeActive: Boolean(extractor.downtimeActive),
      downtimeStartedAt: downtimeStartedAt ?? null,
      downtimeRecoveredAt: (extractor.downtimeRecoveredAt !== undefined ? extractor.downtimeRecoveredAt : null)
    };
    return normalized;
  });

  // Legacy compatibility surface for existing frontend code paths.
  corp.mining.silicateExtractor = corp.mining.silicateExtractors[0] || {
    id: "ext-basic-0",
    name: "Basic Extractor Yard #0",
    tier: 1,
    active: false,
    startedAt: null,
    lastTickAt: null,
    endsAt: null,
    throughputPerHour: 0,
    operationCostPerHour: 0,
    totalMined: 0,
    minedRemainder: 0,
    totalSpent: 0,
    lastCompletedAt: null
  };

  if (!corp.unlocks || typeof corp.unlocks !== "object") {
    corp.unlocks = {};
  }
  if (typeof corp.unlocks.maxBasicExtractorYards !== "number") {
    corp.unlocks.maxBasicExtractorYards = 1;
  }

  // Backfill leaseId/body for legacy extractors built before location was
  // tracked on the row itself.
  // Strategy:
  //   1. If a lease references the extractor in extractorIds, link it.
  //   2. If a leaseId points to a lease whose id only differs by an `accountId::`
  //      namespace prefix (legacy hydration mismatch), rewire to the unwrapped id.
  //   3. If there's exactly one lease, assume the extractor lives there.
  //   4. Otherwise leave it unassigned — the UI will surface "Unassigned" so
  //      the player can tell which yards still need to be placed, instead of
  //      silently defaulting them all to whichever lease happens to be first.
  const leases = Array.isArray(corp.miningLeases) ? corp.miningLeases : [];
  if (leases.length) {
    for (const ex of corp.mining.silicateExtractors) {
      if (ex.leaseId) {
        const direct = leases.find((l) => l.id === ex.leaseId);
        if (direct) {
          if (!ex.body) ex.body = direct.body || null;
          continue;
        }
        // Try matching by raw suffix in case of stale namespace prefixes.
        const stripped = String(ex.leaseId).split("::").pop();
        const fuzzy = leases.find((l) => String(l.id).split("::").pop() === stripped);
        if (fuzzy) {
          ex.leaseId = fuzzy.id;
          if (!ex.body) ex.body = fuzzy.body || null;
          continue;
        }
        // leaseId points nowhere; fall through to reassignment.
      }
      const owning = leases.find((l) => Array.isArray(l.extractorIds) && l.extractorIds.includes(ex.id));
      if (owning) {
        ex.leaseId = owning.id;
        if (!ex.body) ex.body = owning.body || null;
        continue;
      }
      // Single-lease shortcut: only one lease means there's only one place
      // the yard could be — safe to attach without ambiguity.
      if (leases.length === 1) {
        const target = leases[0];
        ex.leaseId = target.id;
        if (!ex.body) ex.body = target.body || null;
        if (!Array.isArray(target.extractorIds)) target.extractorIds = [];
        if (!target.extractorIds.includes(ex.id)) target.extractorIds.push(ex.id);
      }
      // Multiple leases + no link → leave unassigned (ex.leaseId stays null).
    }
    // Rebuild extractorIds lists from the now-authoritative leaseId pointers.
    for (const lease of leases) {
      lease.extractorIds = corp.mining.silicateExtractors
        .filter((ex) => ex.leaseId === lease.id)
        .map((ex) => ex.id);
    }
  }
}

// TODO(AB#1052): Add force-stop functionality
function stopExtractorCycle(extractor, timestamp) {
  extractor.active = false;
  extractor.endsAt = timestamp;
  extractor.lastTickAt = timestamp;
  extractor.lastCompletedAt = timestamp;
}

/**
 * Start a mining cycle on an extractor: the one place both start routes go through (AB#575). It zeroes the
 * per-cycle count the extractor panel shows as "Mined this cycle"; totalMined stays the lifetime figure.
 */
export function startExtractorCycle(extractor, { now, hours, throughputPerHour, operationCostPerHour, startupCost }) {
  extractor.active = true;
  extractor.startedAt = now;
  extractor.lastTickAt = now;
  extractor.endsAt = now + hours * 60 * 60 * 1000;
  extractor.throughputPerHour = throughputPerHour;
  extractor.operationCostPerHour = operationCostPerHour;
  extractor.totalSpent = Number(extractor.totalSpent || 0) + startupCost;
  extractor.minedThisCycle = 0;
}

/**
 * An extractor's chance of breaking down per second: 0.005%, 8% less with Industrial Safety research and 12% less
 * again with the Risk Assessment Framework CEO program (Bug #983: that program used to change nothing).
 */
export function extractorDowntimeProbPerSec(corp) {
  let probPerSec = 0.00005;
  if ((corp.unlockedTech || []).includes("tt-industrial-safety")) probPerSec *= 0.92;
  if ((corp.completedInsights || []).includes("ceo-risk-assessment")) probPerSec *= 0.88;
  return probPerSec;
}

export function applyMiningOperations(corp, now = Date.now()) {
  ensureCorpMiningModel(corp);

  const extractors = corp.mining.silicateExtractors || [];
  extractors.forEach((extractor) => {
    if (!extractor.active) {
      return;
    }

    // --- Downtime logic ---
    if (extractor.downtimeActive) {
      // If downtimeStartedAt is not a valid timestamp, forcibly set it to now (first tick only)
      if (!Number.isFinite(Number(extractor.downtimeStartedAt)) || Number(extractor.downtimeStartedAt) <= 0) {
        extractor.downtimeStartedAt = now;
      }
      // Enforce minimum downtime duration (15 minutes = 900,000 ms)
      const minDowntimeMs = 15 * 60 * 1000;
      const nowMs = now;
      const startedAt = Number(extractor.downtimeStartedAt);
      if (nowMs - startedAt < minDowntimeMs) {
        // Still within minimum downtime, cannot recover yet
        return;
      }
      // Per-tick recovery probability (default: 0.0276% per second)
      const lastTick = Number(extractor.lastTickAt || extractor.downtimeStartedAt || now);
      const intervalEnd = now;
      const elapsedMs = Math.max(0, intervalEnd - lastTick);
      const recoveryProbPerSec = 0.000276; // 0.0276% per second
      const tickSeconds = elapsedMs / 1000;
      const tickProb = 1 - Math.pow(1 - recoveryProbPerSec, tickSeconds);
      if (Math.random() < tickProb) {
        // Recovery!
        extractor.downtimeActive = false;
        extractor.downtimeRecoveredAt = now;
        extractor.downtimeStartedAt = null;
        // Resume mining: update lastTickAt so mining resumes from now
        extractor.lastTickAt = now;
      }
      // If not recovered, remain in downtime (mining paused)
      return;
    } else {
      // If not in downtime, always clear downtimeStartedAt
      extractor.downtimeStartedAt = null;
    }

    // Per-tick downtime probability (default: 0.005% per second)
    // If tick is longer than 1s, scale probability accordingly
    const lastTick = Number(extractor.lastTickAt || extractor.startedAt || now);
    const maxEnd = Number(extractor.endsAt || now);
    const intervalEnd = Math.min(now, maxEnd);
    const elapsedMs = Math.max(0, intervalEnd - lastTick);

    if (elapsedMs <= 0) {
      if (now >= maxEnd) {
        stopExtractorCycle(extractor, now);
      }
      return;
    }

    // Calculate downtime probability for this tick
    const probPerSec = extractorDowntimeProbPerSec(corp);
    const tickSeconds = elapsedMs / 1000;
    // Probability of at least one event in tickSeconds: P = 1 - (1 - p)^n
    const tickProb = 1 - Math.pow(1 - probPerSec, tickSeconds);
    if (Math.random() < tickProb) {
      // Trigger downtime
      extractor.downtimeActive = true;
      extractor.downtimeStartedAt = now;
      extractor.downtimeRecoveredAt = null;
      return; // Mining is paused this tick
    }

    // --- Normal mining logic ---
    const elapsedHours = elapsedMs / (60 * 60 * 1000);
    const throughput = Math.max(0, Number(extractor.throughputPerHour || 0));
    let efficiency = 1;
    if ((corp.unlockedTech || []).includes("tt-basic-extraction")) efficiency *= 1.1;
    if ((corp.unlockedTech || []).includes("tt-supply-forecast")) efficiency *= 1.06;
    const projectedMined = elapsedHours * throughput * efficiency;
    const projectedCost = elapsedHours * Math.max(0, Number(extractor.operationCostPerHour || 0));

    let affordabilityRatio = 1;
    if (projectedCost > 0) {
      const byCredits = corp.finances.credits / projectedCost;
      affordabilityRatio = Math.max(0, Math.min(1, byCredits));
    }

    const minedWithCarry = projectedMined * affordabilityRatio + Math.max(0, Number(extractor.minedRemainder || 0));
    const actualMined = Math.floor(minedWithCarry);
    extractor.minedRemainder = minedWithCarry - actualMined;
    const actualCost = Math.round(projectedCost * affordabilityRatio);

    if (actualCost > 0) {
      corp.finances.credits = Math.max(0, corp.finances.credits - actualCost);
      extractor.totalSpent += actualCost;
      recordExpense(corp, "mining-ops", actualCost, now); // Bug #1022: at the tick's time, for the 24-hour window
    }

    if (actualMined > 0) {
      // Deposit at the station orbiting the extractor's lease body
      const lease = (corp.miningLeases || []).find((l) => l.id === extractor.leaseId);
      const depositStation = (lease && BODY_TO_STATION[lease.body]) || corp.currentStationId || "earth-station-prime";
      const stationInv = getStationInventory(corp, depositStation);
      stationInv.Silicates = (stationInv.Silicates || 0) + actualMined;
      extractor.totalMined += actualMined;
      extractor.minedThisCycle = Number(extractor.minedThisCycle || 0) + actualMined;
      // Bug #984: mined silicates are inventory, not income; revenue is booked when they are sold.
    }

    const consumedMs = Math.round(elapsedMs * affordabilityRatio);
    extractor.lastTickAt = lastTick + consumedMs;

    if (affordabilityRatio < 1 || now >= maxEnd) {
      stopExtractorCycle(extractor, now);
    }
  });

  corp.mining.silicateExtractor = extractors[0];
}

// ─── Refinery model ──────────────────────────────────────────────────────────
function ensureCorpRefineryModel(corp) {
  if (!Array.isArray(corp.refineries)) {
    corp.refineries = [];
  }

  // Sync refineries array with built Refinery buildings
  const builtCount = (corp.buildings || []).filter((b) => b.name === "Refinery").length;
  while (corp.refineries.length < builtCount) {
    const idx = corp.refineries.length + 1;
    corp.refineries.push({
      id: `ref-${idx}`,
      name: `Refinery #${idx}`,
      tier: 1,
      active: false,
      chainId: null,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      cyclesCompleted: 0,
      totalInputConsumed: 0,
      totalOutputProduced: 0
    });
  }

  corp.refineries = corp.refineries.map((ref, i) => ({
    id: String(ref.id || `ref-${i + 1}`),
    name: String(ref.name || `Refinery #${i + 1}`),
    tier: Number(ref.tier || 1),
    active: Boolean(ref.active),
    chainId: ref.chainId ?? null,
    stationId: ref.active ? refineryCycleStation(corp, ref) : null,
    cycleScale: Math.max(1, Number(ref.cycleScale || 1)),
    startedAt: ref.startedAt ?? null,
    lastTickAt: ref.lastTickAt ?? null,
    endsAt: ref.endsAt ?? null,
    cyclesCompleted: Number(ref.cyclesCompleted || 0),
    totalInputConsumed: Number(ref.totalInputConsumed || 0),
    totalOutputProduced: Number(ref.totalOutputProduced || 0)
  }));
}

// The station a running cycle delivers to: the one its inputs came from, recorded by start-refinery (Bug #692).
// A cycle started before that field existed is pinned once, at its first touch, to where the corporation is
// then, or to Earth Station Prime if it is in transit, so its outputs always land somewhere.
function refineryCycleStation(corp, ref) {
  if (ref.stationId) return String(ref.stationId);
  const pinned = corp.currentStationId || "earth-station-prime";
  console.warn(`[refinery] Bug #692: running cycle on ${ref.id || "a refinery"} had no station; pinned to ${pinned}.`);
  return pinned;
}

export function applyRefineryOperations(corp, now = Date.now()) {
  ensureCorpRefineryModel(corp);

  corp.refineries.forEach((ref) => {
    if (!ref.active || !ref.chainId) return;

    const chain = REFINERY_CHAINS[ref.chainId];
    if (!chain) {
      ref.active = false;
      ref.stationId = null;
      return;
    }

    const endsAt = Number(ref.endsAt || 0);
    if (!endsAt || now < endsAt) return;

    // Cycle complete — produce outputs at the station the cycle started at, scaled by the
    // number of batches the player queued (refinery `cycleScale`, default 1).
    if (!corp.inventory) corp.inventory = {};
    const refStationInv = getStationInventory(corp, ref.stationId);
    const scale = Math.max(1, Number(ref.cycleScale || 1));
    for (const output of chain.outputs) {
      const produced = output.quantityPerCycle * scale;
      bumpStat(corp, "refinedUnitsProduced", produced); // Bug #424: levels 9 and 10
      refStationInv[output.item] = (refStationInv[output.item] || 0) + produced;
      ref.totalOutputProduced += produced;
    }

    ref.cyclesCompleted += scale;
    ref.active = false;
    ref.chainId = null;
    ref.stationId = null;
    ref.cycleScale = 1;
    ref.startedAt = null;
    ref.lastTickAt = null;
    ref.endsAt = null;
  });
}

// ─── Asteroid Belt Mining ────────────────────────────────────────────────────

// Deterministic belt compositions per system — scoutable
/* 
  TODO(AB#1050): Asteroid Belts should be more dynamic. Once they spawn, there is a limited amount of ore to be mined. 
  Asteroid Belts should yield more resources than extractor yards. Once the ore has been mined, the asteroid belt disappears. 
  If no asteroid belt is present, it will have a 20% chance of spawning each hour at xx:00. The specific composition of the belt
  should be random. 
*/
const BELT_COMPOSITIONS = {
  "sol:belt":          { "Silicates": 35, "Carbon": 25, "Nickel": 20, "Water Ice": 15, "Titanium": 5 },
  "alpha-centauri:ac-belt": { "Silicates": 25, "Nickel": 22, "Titanium": 18, "Carbon": 15, "Hydrogen": 12, "Lithium": 8 },
  "barnards-star:bn-rift":  { "Nickel": 25, "Titanium": 22, "Carbon": 18, "Silicates": 15, "Hydrogen": 12, "Cobalt": 8 },
  "wolf-359:wf-shards":     { "Titanium": 20, "Nickel": 18, "Rare Earths": 16, "Lithium": 14, "Carbon": 12, "Cobalt": 10, "Thorium": 10 },
  "tau-ceti:tc-cloud":      { "Rare Earths": 18, "Cobalt": 16, "Thorium": 14, "Titanium": 14, "Nickel": 12, "Helium-3": 10, "Lithium": 8, "Uranium": 8 },
  "epsilon-eridani:ee-crown":{ "Rare Earths": 15, "Thorium": 14, "Uranium": 12, "Cobalt": 12, "Exotic Matter": 8, "Helium-3": 10, "Titanium": 10, "Lithium": 10, "Nickel": 9 }
};

// Rarity tiers control yield multiplier and the chance of bonus "jackpot" drops
/* 
  TODO(AB#1050): Rarity should be more dynamic. It shouldn't be impossible for an exotic Asteroid Belt to spawn within Sol, but it 
  should be less common than say Epsilon Eridani
*/
const SYSTEM_RARITY = {
  sol:                "common",
  "alpha-centauri":   "uncommon",
  "barnards-star":    "uncommon",
  "wolf-359":         "rare",
  "tau-ceti":         "rare",
  "epsilon-eridani":  "exotic"
};

// TODO(AB#822): In addition to rarity improving yields, it should also determine what types of raw resources are available
const RARITY_YIELD_MULTIPLIER = { common: 1.0, uncommon: 1.15, rare: 1.35, exotic: 1.6 };

const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV !== "production";

// Expedition durations (ms) — short, standard, extended
// In dev mode: 10s with scaled-up yield multipliers for quick testing
const EXPEDITION_DURATIONS = IS_DEV ? {
  short:    { label: "Short Sweep (10s)",      ms: 10 * 1000, tickYieldMultiplier: 126 },
  standard: { label: "Standard Survey (10s)",  ms: 10 * 1000, tickYieldMultiplier: 360 },
  extended: { label: "Deep Core Drill (10s)",  ms: 10 * 1000, tickYieldMultiplier: 1008 }
} : {
  short:    { label: "Short Sweep (30 min)",       ms: 30 * 60 * 1000, tickYieldMultiplier: 1 },
  standard: { label: "Standard Survey (1 hr)",     ms: 60 * 60 * 1000, tickYieldMultiplier: 1 },
  extended: { label: "Deep Core Drill (2 hr)",     ms: 2 * 60 * 60 * 1000, tickYieldMultiplier: 1 }
};

const EXPEDITION_LAUNCH_COST = 3000;   // credits per expedition launch
const PROBE_BUILD_COST = 8000;         // credits to fabricate one mining probe
const PROBE_ASSET_VALUE = 5000;
const PROBE_FABRICATION_MS = IS_DEV ? 10 * 1000 : 30 * 60 * 1000; // 10s dev, 30 min prod
const BASE_MAX_PROBES = 2;             // Fleet Cap before Level 1 grants one (Bug #586)
const FLEET_COORDINATION_TECH = "tt-fleet-coordination";
const FLEET_COORDINATION_BONUS = 12;   // "+12 fleet cap" (data/research.json)
const BASE_MAX_DEPLOYMENTS = 1;        // concurrent expedition slots

function ensureCorpAsteroidMiningModel(corp) {
  if (!corp.asteroidMining || typeof corp.asteroidMining !== "object") {
    corp.asteroidMining = {};
  }
  const am = corp.asteroidMining;

  if (typeof am.probeCount !== "number") am.probeCount = 0;
  if (typeof am.maxDeployments !== "number") am.maxDeployments = BASE_MAX_DEPLOYMENTS;
  if (!Array.isArray(am.fabricationQueue)) am.fabricationQueue = [];
  if (!Array.isArray(am.activeExpeditions)) am.activeExpeditions = [];
  if (!Array.isArray(am.completedExpeditions)) am.completedExpeditions = [];
  if (!Array.isArray(am.scoutedBelts)) am.scoutedBelts = [];

  // Normalize each active expedition
  am.activeExpeditions = am.activeExpeditions.map((exp) => ({
    id: exp.id || createId("exp"),
    beltKey: exp.beltKey || "sol:belt",
    systemId: exp.systemId || "sol",
    duration: exp.duration || "standard",
    deployedAt: exp.deployedAt || Date.now(),
    completesAt: exp.completesAt || Date.now(),
    lastTickAt: exp.lastTickAt || exp.deployedAt || Date.now(),
    launchCost: Number(exp.launchCost || EXPEDITION_LAUNCH_COST),
    yields: exp.yields || {},
    // Bug #1274: the fraction of a unit carried to the next tick; an expedition saved before it starts at 0.
    yieldCarry: Math.max(0, Number(exp.yieldCarry) || 0),
    status: exp.status || "active"
  }));
}

/**
 * Seeded pseudo-random for deterministic-per-tick asteroid loot.
 * Returns value in [0, 1).
 */
function seededRand(seed) {
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xFFFFFFFF;
}

function weightedPick(pool, seed) {
  const total = Object.values(pool).reduce((a, b) => a + b, 0);
  let roll = seededRand(seed) * total;
  for (const [resource, weight] of Object.entries(pool)) {
    roll -= weight;
    if (roll <= 0) return resource;
  }
  // Fallback
  return Object.keys(pool)[0];
}

// Bug #1274: an expedition's yield in whole units, with the fraction carried to the next tick, and split across the
// tick's drops so the drops add up to exactly that many. In production a 10-second tick of a Short Sweep is worth 0.5
// units; floored on its own it was always 0, and every production expedition came home empty. This is the extractors'
// rule (Bug #1138, !177: whole units now, the fraction carried, the same tolerance for floating-point drift), so a sweep
// yields the same total whether it is settled every 10 seconds or once at the end. An expedition saved before this has
// no carry yet, which reads as 0.
const EXPEDITION_CARRY_TOLERANCE = 1e-6;
function takeWholeUnits(amount, carried) {
  const total = amount + Math.max(0, Number(carried) || 0);
  const whole = Math.floor(total + EXPEDITION_CARRY_TOLERANCE);
  return { whole, rest: Math.max(0, total - whole) };
}

/** Split `whole` units into `weights.length` shares that add up to exactly `whole` (largest remainders first). */
export function splitExactly(whole, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (whole * w) / sum);
  const shares = raw.map(Math.floor);
  let left = whole - shares.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) shares[order[k][1]] += 1;
  return shares;
}

export function applyAsteroidExpeditions(corp, now = Date.now()) {
  ensureCorpAsteroidMiningModel(corp);

  const am = corp.asteroidMining;
  const expeditionsToRemove = [];

  am.activeExpeditions.forEach((exp) => {
    if (exp.status !== "active") return;

    const lastTick = Number(exp.lastTickAt || exp.deployedAt);
    const completesAt = Number(exp.completesAt);
    const intervalEnd = Math.min(now, completesAt);
    const elapsedMs = Math.max(0, intervalEnd - lastTick);

    if (elapsedMs <= 0 && now < completesAt) return;

    // Determine belt composition
    const composition = BELT_COMPOSITIONS[exp.beltKey];
    if (!composition) {
      exp.status = "completed";
      expeditionsToRemove.push(exp.id);
      return;
    }

    const rarity = SYSTEM_RARITY[exp.systemId] || "common"; // TODO(AB#804): Should we really be defaulting to common? In what circumstances is SYSTEM_RARITY[exp.systemId] null?
    const rarityMult = RARITY_YIELD_MULTIPLIER[rarity];
    const durationDef = EXPEDITION_DURATIONS[exp.duration] || EXPEDITION_DURATIONS.standard;
    const tickMult = durationDef.tickYieldMultiplier;

    // Roll resources for this tick interval
    const tickMinutes = elapsedMs / (60 * 1000);
    // Base: ~2-5 units per resource per tick minute
    const baseYieldPerMin = 3;
    const units = takeWholeUnits(tickMinutes * baseYieldPerMin * rarityMult * tickMult, exp.yieldCarry);
    const totalYield = units.whole;
    exp.yieldCarry = units.rest;

    if (totalYield > 0) {
      // Generate a tick-unique seed from expedition id + tick timestamp
      const tickSeed = (hashSeedStr(exp.id) + Math.floor(now / 5000)) | 0;

      // Roll 1–3 resources per tick (never more drops than units), sharing exactly totalYield between them
      const dropCount = Math.min(totalYield, 1 + Math.floor(seededRand(tickSeed) * 3));
      const weights = Array.from({ length: dropCount }, (_, i) => 0.6 + seededRand(tickSeed + i * 3571) * 0.8);
      const shares = splitExactly(totalYield, weights);
      for (let i = 0; i < dropCount; i++) {
        if (shares[i] <= 0) continue;
        const resource = weightedPick(composition, tickSeed + i * 7919);
        exp.yields[resource] = (exp.yields[resource] || 0) + shares[i];
      }
    }

    exp.lastTickAt = now;

    // Check completion
    if (now >= completesAt) {
      exp.status = "completed";

      // Deposit yields into nearest station in the expedition's system
      const stationsInSystem = Object.values(STATION_REGISTRY_CACHE).filter(s => s.systemId === exp.systemId);
      const depositStationId = (stationsInSystem.length > 0)
        ? (stationsInSystem.find(s => s.id === corp.currentStationId)?.id || stationsInSystem[0].id)
        : (corp.currentStationId || "earth-station-prime");

      const stationInv = getStationInventory(corp, depositStationId);
      for (const [resource, qty] of Object.entries(exp.yields)) {
        stationInv[resource] = (stationInv[resource] || 0) + qty;
      }

      // Return the probe
      am.probeCount = (am.probeCount || 0) + 1; // it counted against the Fleet Cap while away

      // Move to completed log (keep last 20)
      am.completedExpeditions.unshift({ ...exp, completedAt: now, depositStationId });
      bumpStat(corp, "asteroidExpeditionsCompleted", 1); // Bug #424: levels 7 and 10
      if (am.completedExpeditions.length > 20) am.completedExpeditions.length = 20;

      expeditionsToRemove.push(exp.id);
    }
  });

  // Remove completed expeditions from active list
  if (expeditionsToRemove.length > 0) {
    am.activeExpeditions = am.activeExpeditions.filter((e) => !expeditionsToRemove.includes(e.id));
  }
}

function hashSeedStr(input) {
  let h = 0;
  const text = String(input || "x");
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// ─── Exchange sales tax ──────────────────────────────────────────────────────
// TODO(AB#726): Should this be hardcoded? Or should we store it in the database?
const BASE_EXCHANGE_SALES_TAX_PCT = 8;

export function getEffectiveExchangeTaxRate(state) {
  let taxPct = BASE_EXCHANGE_SALES_TAX_PCT;

  // CEO Insight: Negotiation Fundamentals reduces tax by 2% per completion (max 3 completions = 6%)
  const completedInsights = state.corp.completedInsights || [];
  const negLevels = completedInsights.filter((id) => id === "ceo-negotiation-fundamentals").length;
  if (negLevels > 0) {
    const prog = CEO_INSIGHT_LIBRARY["ceo-negotiation-fundamentals"];
    const maxLevels = prog?.maxLevels || 3;
    const effectiveLevels = Math.min(negLevels, maxLevels);
    taxPct -= effectiveLevels * 2; // 2% per level
  }

  return Math.max(0, taxPct);
}

function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

// ─── What the level ladder may name (Bug #424) ────────────────────────────────
// Levels 6 to 10 named statistics no code kept and buildings no one could build, so nobody passed Level 5. The
// schema test (tests/schema/data-files.test.js) fails when a milestone names anything outside these lists.
/** Statistics the resolver works out from other state. */
const DERIVED_STATS = ["officeRented", "miningLeasesCount", "missionsCompleted"];
/** Statistics kept as counters in corp.stats, through bumpStat. */
const COUNTED_STATS = ["silicateSoldOnExchange", "refinedUnitsProduced", "asteroidExpeditionsCompleted"];
export const STAT_KEYS = Object.freeze([...DERIVED_STATS, ...COUNTED_STATS]);
/** Buildings a player can build (the construction routes in server/index.js; a test checks the two agree). */
export const PLAYER_BUILDINGS = Object.freeze(["Basic Extractor Yard", "Assembly Facility", "Refinery"]);

/** Add `n` to a counted statistic. Refuses a key nothing reads, so a typo cannot quietly start a new counter. */
export function bumpStat(corp, key, n = 1) {
  if (!COUNTED_STATS.includes(key)) throw new Error(`Unknown statistic "${key}": add it to COUNTED_STATS first.`);
  if (!corp.stats || typeof corp.stats !== "object") corp.stats = {};
  corp.stats[key] = (Number(corp.stats[key]) || 0) + (Number(n) || 0);
}

// ─── Metric resolver: maps milestones.json metric strings to live corp values ─
function resolveMetric(metric, corp) {
  const stats = corp.stats || {};
  const buildings = corp.buildings || [];
  const unlockedTech = corp.unlockedTech || [];
  const miningLeases = corp.miningLeases || [];

  // stat:<key> — check corp flags first, then corp.stats
  if (metric.startsWith("stat:")) {
    const key = metric.slice(5);
    if (key === "officeRented") return (Array.isArray(corp.offices) && corp.offices.length > 0) ? 1 : 0;
    if (key === "miningLeasesCount") return miningLeases.length;
    // Bug #424: counted from the missions already recorded (kept to the last 200), so old saves get credit too.
    if (key === "missionsCompleted") return Array.isArray(corp.completedMissions) ? corp.completedMissions.length : 0;
    return Number(stats[key] || 0);
  }

  // employeeCount
  if (metric === "employeeCount") return Number(corp.employeeCount || 0);

  // miningLease:<body> — check body field, fall back to type field
  if (metric.startsWith("miningLease:")) {
    const target = metric.slice(12);
    return miningLeases.some((l) => (l.body || l.type || l) === target) ? 1 : 0;
  }

  // building:<name> — boolean: has at least one
  if (metric.startsWith("building:")) {
    const name = metric.slice(9);
    return buildings.some((b) => b.name === name) ? 1 : 0;
  }

  // building-count:<name> — count of matching buildings
  if (metric.startsWith("building-count:")) {
    const name = metric.slice(15);
    return buildings.filter((b) => b.name === name).length;
  }

  // totalMined:<resource>
  if (metric.startsWith("totalMined:")) {
    if (metric === "totalMined:silicate") {
      return (corp?.mining?.silicateExtractors || [])
        .reduce((sum, ex) => sum + Number(ex?.totalMined || 0), 0);
    }
    return 0;
  }

  // unlockedTech:<techId>
  if (metric.startsWith("unlockedTech:")) {
    const techId = metric.slice(13);
    return unlockedTech.includes(techId) ? 1 : 0;
  }

  return 0;
}

// Bug #586: the Fleet Cap the sidebar shows is the cap fabrication enforces. It is the maxFleetSize
// granted by levels reached (never below the pre-Level-1 floor), plus Fleet Coordination Matrix.
// Every vessel counts: in the hangar, in fabrication, or out on an expedition.
export function fleetStatus(corp) {
  const am = corp?.asteroidMining || {};
  const granted = Math.max(BASE_MAX_PROBES, Number(corp?.unlocks?.maxFleetSize || 0));
  const coordinated = (corp?.unlockedTech || []).includes(FLEET_COORDINATION_TECH);
  const bonus = coordinated ? FLEET_COORDINATION_BONUS : 0;
  const cap = granted + bonus;
  const vessels = Number(am.probeCount || 0) + (am.fabricationQueue || []).length + (am.activeExpeditions || []).length;
  const raises = [];
  const nextLevel = [...MILESTONE_LEVELS]
    .sort((a, b) => a.level - b.level)
    .find((l) => l.level > Number(corp?.level || 0) && Number(l.unlocks?.maxFleetSize || 0) > granted);
  if (nextLevel) raises.push({ kind: "level", level: nextLevel.level, cap: nextLevel.unlocks.maxFleetSize + bonus });
  if (!coordinated) raises.push({ kind: "research", techId: FLEET_COORDINATION_TECH, name: "Fleet Coordination Matrix", bonus: FLEET_COORDINATION_BONUS });
  return { cap, vessels, full: vessels >= cap, raises, raiseText: fleetRaiseText(raises) };
}

// What raises the Fleet Cap next, in words; empty when nothing in this build does.
export function fleetRaiseText(raises) {
  const parts = raises.map((r) => r.kind === "level"
    ? `Reaching Corporation Level ${r.level} raises it to ${r.cap}`
    : `${r.name} research adds ${r.bonus}`);
  return parts.length ? `${parts.join("; ")}.` : "This is the highest Fleet Cap in this build.";
}

export function evaluateLevelProgress(profileState) {
  const corp = profileState.corp;
  corp.levelCap = MAX_DEFINED_LEVEL; // Bug #424: saves carried a literal 40

  // Build levelProgress from milestones.json definitions
  corp.levelProgress = {};
  const allRequirements = [];

  for (const levelDef of MILESTONE_LEVELS) {
    const lvlNum = levelDef.level;
    const reqs = levelDef.requirements.map((r) => {
      const progress = resolveMetric(r.metric, corp);
      return {
        id: r.id,
        title: r.title,
        progress,
        target: r.target,
        complete: Number(progress || 0) >= Number(r.target || 0)
      };
    });
    corp.levelProgress[`level${lvlNum}`] = {
      requirements: reqs,
      allCompleted: reqs.every((r) => r.complete)
    };
    allRequirements.push(...reqs);
  }

  // Track completed milestones by display title
  allRequirements.forEach((req) => {
    const milestoneName = REQ_ID_TO_TITLE[req.id] || req.title;
    if (req.complete && !corp.milestonesCompleted.includes(milestoneName)) {
      corp.milestonesCompleted.push(milestoneName);
    }
  });

  // Climb one level at a time: level N is granted only from level N-1, so a later level met
  // first waits for the one below it instead of skipping it (AB#690).
  const ordered = [...MILESTONE_LEVELS].sort((a, b) => a.level - b.level);
  for (const levelDef of ordered) {
    const lvlNum = levelDef.level;
    if (lvlNum <= corp.level) continue;
    if (lvlNum !== corp.level + 1 || !corp.levelProgress[`level${lvlNum}`].allCompleted) break;
    corp.level = lvlNum;
  }

  // Every level at or below the current one holds its tag and unlocks. Idempotent, so it also
  // repairs corporations the old loop promoted past a level without granting it (AB#690).
  for (const levelDef of ordered) {
    if (levelDef.level > corp.level) break;
    const tag = `Reached Corporation Level ${levelDef.level}`;
    if (!corp.milestonesCompleted.includes(tag)) {
      corp.milestonesCompleted.push(tag);
    }
    const u = levelDef.unlocks;
    if (u.employeeCap) corp.employeeCap = Math.max(corp.employeeCap, u.employeeCap);
    if (u.buildingSlots) corp.buildingSlots = Math.max(corp.buildingSlots, u.buildingSlots);
    if (u.maxFleetSize) corp.unlocks.maxFleetSize = Math.max(corp.unlocks.maxFleetSize, u.maxFleetSize);
    if (Array.isArray(u.marketSectors)) {
      for (const sector of u.marketSectors) {
        if (!corp.unlocks.marketSectors.includes(sector)) {
          corp.unlocks.marketSectors.push(sector);
        }
      }
    }
  }

  corp.fleet = fleetStatus(corp); // Bug #586: derived every evaluation, like levelProgress
}

/* TODO(AB#726): Should this all be hardcoded? Or should some of it be based upon completed research, etc? */
function createStarterCorporationState(baseState, ceoName, corpName) {
  const next = deepClone(baseState);

  next.corp = {
    ...next.corp,
    // Bug #711: how other players address this corporation. Opaque and random, never the account id, because names
    // are not unique and mail was routed by name.
    publicId: createId("corp"),
    ceo: ceoName,
    corporationName: corpName,
    location: "Earth",
    currentStationId: "earth-station-prime",
    currentSystemId: "sol",
    travel: null,
    level: 0,
    levelCap: MAX_DEFINED_LEVEL,
    milestonesCompleted: [],
    employeeCap: 8,
    employeeCount: 0,
    buildingSlots: 2,
    buildings: [{ name: "Headquarters", tier: 1, status: "Operational" }],
    military: {
      lightFighters: 0,
      destroyers: 0,
      siegeEngines: 0,
      attackValue: 0,
      defenseValue: 0,
      modifiers: {
        rdBonusPct: 0,
        ceoLeadershipPct: 0
      }
    },
    finances: {
      ...next.corp.finances,
      credits: 250000,
      liabilities: 0,
      assets: 0,
      dailyRevenue: 0,
      dailyCosts: 0,
      taxRatePct: 14,
      bondYieldPct: 0,
      exchangeSalesTaxPct: 8,
      lifetimeRevenue: 0,
      lifetimeCosts: 0,
      incomeBySource: {},
      expensesByCategory: {},
      snapshots: []
    },
    inventory: {},
    mining: {
      silicateExtractors: [],
      silicateExtractor: {
        active: false,
        startedAt: null,
        lastTickAt: null,
        endsAt: null,
        throughputPerHour: 0,
        operationCostPerHour: 0,
        totalMined: 0,
        totalSpent: 0,
        lastCompletedAt: null
      }
    },
    unlocks: {
      marketSectors: [],
      maxUpgradeTier: 1,
      maxFleetSize: 0,
      maxBasicExtractorYards: 1
    },
    investments: [],
    unlockedTech: [],
    completedInsights: [],
    offices: [],
    miningLeases: [],
    tradeHistory: []
  };

  next.queues = {
    corporateRnD: [],
    ceoInsight: []
  };

  next.playerProfile = {
    isNewPlayer: true,
    registeredAt: Date.now(),
    walkthroughCompleted: false
  };

  evaluateLevelProgress(next);
  ensureCorpMiningModel(next.corp);
  ensureCorpRefineryModel(next.corp);
  return next;
}

// ─── Mission Template Pool ─────────────────────────────────────────────────
const CONTRACT_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours
const CONTRACTS_PER_AGENT = 2;
const COMPLETED_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h before a completed mission can reappear
// AB#579: the walkthrough closes with Elara Voss promising a new corporation this contract, so a corporation that has
// never accepted or completed one is always offered it. public/scripts/walkthrough.js names it (handoffContractId).
export const FIRST_CONTRACT_ID = "ms-log-001";

/*
  TODO(AB#1051): This shouldn't be hardcoded in this way. The values should be more random. 
*/
const MISSION_TEMPLATES = [
  {
    id: "ms-log-001",
    title: "Silicate Requisition Order — Batch 4-7A",
    type: "Logistics",
    risk: "Low",
    reward: "12,000 Credits",
    text: "Coordinator Voss requires 400 units of raw silicates delivered to her office for redistribution to ISA-contracted construction projects. Mine the quota from any active extraction lease and sell directly to the agent within the deadline.",
    agentId: "elara-voss",
    quota: { resource: "Silicates", amount: 400 }
  },
  {
    id: "ms-log-002",
    title: "Nickel Freight Manifest — Consignment 9-2B",
    type: "Logistics",
    risk: "Low",
    reward: "15,000 Credits",
    text: "The Bureau has flagged a shortfall of nickel across ISA-administered construction depots. Deliver 300 units of nickel to fulfil this standing requisition order.",
    agentId: "elara-voss",
    quota: { resource: "Nickel", amount: 300 }
  },
  {
    id: "ms-log-003",
    title: "Carbon Fibre Supply Run — Priority C",
    type: "Logistics",
    risk: "Low",
    reward: "10,000 Credits",
    text: "Station maintenance divisions require a resupply of carbon for composite fabrication. Source and deliver 500 units to the contracting office.",
    agentId: "elara-voss",
    quota: { resource: "Carbon", amount: 500 }
  },
  {
    id: "ms-log-004",
    title: "Helium-3 Emergency Allocation — Directive 77",
    type: "Logistics",
    risk: "Medium",
    reward: "24,000 Credits",
    text: "Reactor fuel reserves are approaching critical minimums. The ISA has issued a priority directive: deliver 200 units of Helium-3 to the Bureau for immediate redistribution to power infrastructure.",
    agentId: "elara-voss",
    quota: { resource: "Helium-3", amount: 200 }
  },
  {
    id: "ms-log-005",
    title: "Titanium Structural Allotment — Frame Series 12",
    type: "Logistics",
    risk: "Medium",
    reward: "20,000 Credits",
    text: "Station expansion projects require titanium for structural framework assembly. Deliver 250 units to satisfy this month's allotment schedule.",
    agentId: "elara-voss",
    quota: { resource: "Titanium", amount: 250 }
  },
  {
    id: "ms-log-006",
    title: "Water Ice Procurement — Habitat Sustainment",
    type: "Logistics",
    risk: "Low",
    reward: "8,000 Credits",
    text: "Life-support divisions have requisitioned 600 units of water ice for processing into potable reserves. Standard sustainment contract — deliver to the Bureau at your earliest.",
    agentId: "elara-voss",
    quota: { resource: "Water Ice", amount: 600 }
  },
  {
    id: "ms-log-007",
    title: "Rare Earths Acquisition — R&D Allocation",
    type: "Logistics",
    risk: "High",
    reward: "35,000 Credits",
    text: "The ISA's applied sciences division has requested rare earth elements for experimental fabrication. Deliver 150 units. Extraction difficulty is noted — compensation reflects the challenge.",
    agentId: "elara-voss",
    quota: { resource: "Rare Earths", amount: 150 }
  },
  {
    id: "ms-log-008",
    title: "Lithium Cell Stockpile — Battery Reserve",
    type: "Logistics",
    risk: "Medium",
    reward: "22,000 Credits",
    text: "Energy storage facilities need lithium for next-generation battery cell production. Source and deliver 200 units to the contracting office to fulfil this standing order.",
    agentId: "elara-voss",
    quota: { resource: "Lithium", amount: 200 }
  },
  {
    id: "ms-log-009",
    title: "Cobalt Shipment — Alloy Programme",
    type: "Logistics",
    risk: "Medium",
    reward: "18,000 Credits",
    text: "The metallurgy division requires cobalt for high-temperature alloy production. Deliver 250 units to satisfy the current programme quota.",
    agentId: "elara-voss",
    quota: { resource: "Cobalt", amount: 250 }
  },
  {
    id: "ms-log-010",
    title: "Thorium Fuel Rods — Reactor Consignment",
    type: "Logistics",
    risk: "High",
    reward: "30,000 Credits",
    text: "Next-generation reactor trials require thorium. The ISA has authorised a premium-rate contract for 100 units delivered to the Bureau. Handle with appropriate caution.",
    agentId: "elara-voss",
    quota: { resource: "Thorium", amount: 100 }
  }
];

/**
 * Refresh contract offerings for an account if the timer has expired.
 * Returns the current offerings array (mutates state in-place).
 */
function refreshContractOfferings(corpState) {
  if (!corpState.contractOfferings) corpState.contractOfferings = { missions: [], nextRefreshAt: 0 };
  const offerings = corpState.contractOfferings;
  const now = Date.now();

  // Only regenerate when the timer has actually expired
  if (offerings.nextRefreshAt > 0 && now < offerings.nextRefreshAt) {
    return offerings;
  }

  // Gather IDs that are on cooldown (recently completed)
  const completedMissions = corpState.completedMissions || [];
  const cooldownIds = new Set();
  for (const m of completedMissions) {
    if (m.completedAt && (now - m.completedAt) < COMPLETED_COOLDOWN_MS) {
      cooldownIds.add(m.id);
    }
  }

  // Gather IDs that are currently active
  const activeIds = new Set((corpState.activeMissions || []).map(m => m.id));

  // Filter eligible templates
  const eligible = MISSION_TEMPLATES.filter(t => !cooldownIds.has(t.id) && !activeIds.has(t.id));

  // Shuffle and pick; a corporation's first offering always includes the contract the walkthrough promised it.
  const shuffled = eligible.slice().sort(() => Math.random() - 0.5);
  const neverContracted = !completedMissions.length && !activeIds.size;
  const promised = neverContracted ? shuffled.find((t) => t.id === FIRST_CONTRACT_ID) : null;
  const picked = promised ? [promised, ...shuffled.filter((t) => t !== promised)] : shuffled;
  offerings.missions = picked.slice(0, CONTRACTS_PER_AGENT).map(t => ({ ...t }));
  offerings.nextRefreshAt = now + CONTRACT_REFRESH_MS;

  return offerings;
}

function getSeedState() {
  return {
    world: {
      lawName: "Interstellar Settlement Protocol",
      lawYear: 2147, // TOOD: Should we set this value to increment on Jan 1st?
      systems: deepClone(SYSTEMS_DATA),
      refineryChains: REFINERY_CHAINS_DATA.chains.map((c) => ({
        id: c.id,
        input: c.input,
        inputQuantityPerCycle: c.inputQuantityPerCycle,
        outputs: c.outputs,
        cycleDurationHours: c.cycleDurationHours,
        requiresResearch: c.requiresResearch,
        requiresTechIds: c.requiresTechIds,
        tier: c.tier,
        category: c.category
      }))
    },
    /* TODO(AB#737): Remove legacy data */
    corp: {
      id: "corp-001",
      ceo: "You",
      corporationName: "ISP Foundry Holdings",
      level: 1,
      levelCap: MAX_DEFINED_LEVEL,
      milestonesCompleted: ["HQ Constructed", "First 10 Employees"],
      employeeCap: 100,
      employeeCount: 38,
      buildingSlots: 3,
      buildings: [
        { name: "Headquarters", tier: 1, status: "Operational" },
        { name: "Basic Extractor Yard", tier: 1, status: "Operational" },
        { name: "Refinery Annex", tier: 1, status: "Constructing" }
      ],
      military: {
        lightFighters: 14,
        destroyers: 2,
        siegeEngines: 0,
        attackValue: 284,
        defenseValue: 219,
        modifiers: {
          rdBonusPct: 5,
          ceoLeadershipPct: 3
        }
      },
      finances: {
        credits: 2450000,
        liabilities: 800000,
        assets: 6050000,
        dailyRevenue: 210000,
        dailyCosts: 156000,
        taxRatePct: 14,
        bondYieldPct: 4.8
      },
      inventory: {
        Silicates: 900,
        "Helium-3": 260,
        Titanium: 180
      },
      mining: {
        silicateExtractors: [
          {
            id: "ext-basic-1",
            name: "Basic Extractor Yard #1",
            tier: 1,
            active: false,
            startedAt: null,
            lastTickAt: null,
            endsAt: null,
            throughputPerHour: 0,
            operationCostPerHour: 0,
            totalMined: 0,
            totalSpent: 0,
            lastCompletedAt: null
          }
        ],
        silicateExtractor: {
          active: false,
          startedAt: null,
          lastTickAt: null,
          endsAt: null,
          throughputPerHour: 0,
          operationCostPerHour: 0,
          totalMined: 0,
          totalSpent: 0,
          lastCompletedAt: null
        }
      },
      unlocks: {
        marketSectors: ["Raw Materials", "Logistics Services"],
        maxUpgradeTier: 2,
        maxFleetSize: 45,
        maxBasicExtractorYards: 3
      },
      unlockedTech: ["tt-basic-extraction"]
    },
    queues: {
      corporateRnD: [
        {
          id: "rnd-001",
          name: "Material Compression I",
          effect: "+8% refining throughput",
          durationHours: 9,
          startedAt: Date.now() - 2 * 60 * 60 * 1000
        },
        {
          id: "rnd-002",
          name: "Fleet Coordination Matrix",
          effect: "+12 fleet cap",
          durationHours: 16,
          startedAt: null
        }
      ],
      ceoInsight: [
        {
          id: "ceo-001",
          name: "Executive Negotiation Lab",
          effect: "+6% trade spread efficiency",
          durationHours: 6,
          startedAt: Date.now() - 60 * 60 * 1000
        },
        {
          id: "ceo-002",
          name: "Leadership Cohesion Seminar",
          effect: "+4% morale multiplier",
          durationHours: 8,
          startedAt: null
        }
      ]
    },
    missions: [
      {
        id: "ms-log-001",
        title: "Silicate Requisition Order — Batch 4-7A",
        type: "Logistics",
        risk: "Low",
        reward: "12,000 Credits",
        text: "Coordinator Voss requires 400 units of raw silicates delivered to her office for redistribution to ISA-contracted construction projects. Mine the quota from any active extraction lease and sell directly to the agent within the deadline.",
        canShiftControl: false,
        agentId: "elara-voss",
        quota: { resource: "Silicates", amount: 400 }
      }
    ],
    combatReports: []
  };
}

// ─── Global social state: chat and forums (Bug #749) ─────────────────────────
// Neither was ever created, so on any install without an old data/state.json every chat message threw inside
// appendChatMessage and was dropped, and the forum's category list was empty. They are seeded here rather than in
// normalizeStateShape, because that function also shapes every player's account state, which has no chat.

/** The chat channels. "private" is deliberately absent: isp-bug-5 removes it from the channel allowlist. */
export const CHAT_CHANNELS = ["global", "local", "trade"];

/** The forum categories: the one list the client's picker and the thread route's allowlist both read. */
export const FORUM_CATEGORIES = ["General", "Trade & Exchange", "Mining & Industry", "Conglomerates & Diplomacy", "Help & Guides"];

/** Give the global state its chat channels and forums, keeping whatever is already there. Returns the same object. */
export function ensureGlobalSocialState(globalState) {
  if (!globalState.chatLog || typeof globalState.chatLog !== "object" || Array.isArray(globalState.chatLog)) {
    globalState.chatLog = {};
  }
  for (const channel of CHAT_CHANNELS) {
    if (!Array.isArray(globalState.chatLog[channel])) globalState.chatLog[channel] = [];
  }
  if (!globalState.forums || typeof globalState.forums !== "object") globalState.forums = {};
  globalState.forums.categories = [...FORUM_CATEGORIES];
  if (!Array.isArray(globalState.forums.threads)) globalState.forums.threads = [];
  return globalState;
}

function ensureStateFile() {
  // Bug #588, #574: a missing file used to return the bare seed early, skipping the market setup below, so a fresh
  // install (and every test process) had no order book and no standing buy orders. Both paths now take the same route.
  const exists = fs.existsSync(statePath);
  const normalized = normalizeGlobalState(exists ? JSON.parse(fs.readFileSync(statePath, "utf8")) : getSeedState());
  safeWriteFile(statePath, JSON.stringify(normalized, null, 2));
  return normalized;
}

// NPC buyers exist for every raw resource that currently has a refinery chain, so newly mined materials always have
// a guaranteed sink.
// TODO(AB#777): Reevaluate how we are storing the below information. Should it be hardcoded? Should it be more dynamic?
const NPC_BUY_SEED = [
  { item: "Silicates",   buyer: "GEX Commodities Authority", unitPrice: 24, dailyQty: 1000000 },
  { item: "Helium-3",    buyer: "Lunar Helium Consortium",   unitPrice: 92, dailyQty: 250000 },
  { item: "Nickel",      buyer: "Belt Refining Cooperative", unitPrice: 18, dailyQty: 750000 },
  { item: "Titanium",    buyer: "Olympus Heavy Industries",  unitPrice: 64, dailyQty: 400000 },
  { item: "Carbon",      buyer: "ISA Materials Exchange",    unitPrice: 12, dailyQty: 1500000 },
  { item: "Rare Earths", buyer: "Synthorium Trading House",  unitPrice: 140, dailyQty: 120000 }
];

/**
 * Names no player may take (Bug #433): every name the game's own messages are signed with, and every NPC buyer on the
 * exchange, derived from the lists the server uses so a new sender or buyer is reserved without anyone retyping it.
 */
export { NPC_BUY_SEED };
export const RESERVED_CORPORATION_NAMES = Object.freeze([
  ...Object.values(SYSTEM_SENDERS),
  ...NPC_BUY_SEED.map((seed) => seed.buyer)
]);

/** Give the global state a market: an order book, and every standing buy order it lacks. Keeps what exists. */
function ensureMarketState(globalState) {
  if (!globalState.market || typeof globalState.market !== "object") globalState.market = {};
  if (!Array.isArray(globalState.market.orderBook)) globalState.market.orderBook = [];
  globalState.market.priceHistory = normalizePriceHistory(globalState.market.priceHistory); // AB#715, and cleans a saved one
  if (!Array.isArray(globalState.market.npcBuyOrders)) globalState.market.npcBuyOrders = [];
  for (const seed of NPC_BUY_SEED) {
    const id = `npc-buy-${seed.item.toLowerCase().replace(/\s+/g, "-")}-daily`;
    if (!globalState.market.npcBuyOrders.some((o) => o.id === id)) {
      globalState.market.npcBuyOrders.push({
        id,
        item: seed.item,
        buyer: seed.buyer,
        unitPrice: seed.unitPrice,
        totalQtyPerDay: seed.dailyQty,
        remainingQty: seed.dailyQty,
        lastResetDate: ""
      });
    }
  }
  return globalState;
}

// AB#715: imported beside its use in ensureMarketState, rather than in the import block that parallel pull requests all edit.
import { normalizePriceHistory } from "./priceHistory.js";

/** Everything the server needs in its global state, from a saved state or the seed. Idempotent. */
export function normalizeGlobalState(raw) {
  return ensureMarketState(ensureGlobalSocialState(normalizeStateShape(raw)));
}

/** The global state a fresh install starts with: what tests check the shape of, instead of data/state.json. */
export function freshGlobalState() {
  return normalizeGlobalState(getSeedState());
}

let state = ensureStateFile();
// Bug #1036: report what the removed combat simulate route left in the global state, as a count and a size only.
{
  const summary = storedCombatReportSummary(state);
  if (summary) console.warn(`[combat] ${summary.count} stored combat report(s), ${summary.bytes} bytes, from the removed POST /api/combat/simulate (Bug #1036); left in place.`);
}
let saveTimer = null;
let accountsSaveTimer = null;

// Bug #578: the accounts live in memory and in accounts-snapshot.json in the data directory, the only store until
// Postgres in v0.6 (Decision #591).
function loadAccountsSnapshotFromDisk() {
  try {
    if (!fs.existsSync(accountsSnapshotPath)) return null;
    const raw = fs.readFileSync(accountsSnapshotPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.accounts) return null;
    return parsed;
  } catch (error) {
    console.warn("[accounts] Failed to load local accounts-snapshot.json:", error?.message || error);
    return null;
  }
}

function writeAccountsSnapshotToDiskNow() {
  if (_diskSnapshotTimer) {
    clearTimeout(_diskSnapshotTimer);
    _diskSnapshotTimer = null;
  }
  try {
    safeWriteFile(accountsSnapshotPath, JSON.stringify(accountsStore, null, 2));
  } catch (error) {
    logPersistError("[accounts] Failed to write local accounts snapshot", error);
  }
}

// Debounce disk snapshot writes so high-frequency mutations don't block the
// event loop with synchronous I/O (especially painful on OneDrive folders).
let _diskSnapshotTimer = null;
function writeAccountsSnapshotToDisk() {
  if (_diskSnapshotTimer) return;
  _diskSnapshotTimer = setTimeout(() => {
    _diskSnapshotTimer = null;
    writeAccountsSnapshotToDiskNow();
  }, 500);
  if (typeof _diskSnapshotTimer?.unref === "function") _diskSnapshotTimer.unref();
}

/** The accounts from the snapshot in the data directory, or the seed on a fresh install. */
function loadAccountsStore(fallbackStore) {
  const local = loadAccountsSnapshotFromDisk();
  if (local) {
    console.warn(`[accounts] Restored ${Object.keys(local.accounts).length} account(s) from the snapshot in the data directory.`);
    return mergeDummyAccount(local, fallbackStore);
  }
  console.warn("[accounts] No accounts snapshot in the data directory; starting from the seed.");
  return fallbackStore;
}

/**
 * Ensure the in-memory `dummy` dev account survives loading a snapshot that lacks it. Mutates and returns
 * `hydrated` for chaining.
 */
export function mergeDummyAccount(hydrated, fallbackStore) {
  if (!hydrated || typeof hydrated !== "object") return hydrated;
  if (!hydrated.accounts || typeof hydrated.accounts !== "object") {
    hydrated.accounts = {};
  }
  const fallbackDummy = fallbackStore?.accounts?.dummy;
  if (fallbackDummy && !hydrated.accounts.dummy) {
    hydrated.accounts.dummy = fallbackDummy;
  }
  return hydrated;
}

/**
 * Create a fresh in-memory seed accounts store with a dummy dev account.
 * This is the store a fresh install starts with.
 *
 */
function createSeedAccountsStore() {
  const seedState = normalizeStateShape(getSeedState());
  const dummyState = createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics");
  // Grant dummy account all research + nav techs for testing
  dummyState.corp.unlockedTech = [
    "tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast",
    "tt-energy-routing", "tt-fleet-coordination",
    "tt-proxima-navigation", "tt-deep-star-navigation"
  ];
  return {
    accounts: {
      dummy: {
        id: "dummy",
        email: "dummy@isp.local",
        passwordHash: bcrypt.hashSync("dummy-password", PASSWORD_SALT_ROUNDS),
        createdAt: Date.now(),
        refreshTokens: [],
        notifications: [],
        messages: [],
        walkthroughCompleted: false,
        state: dummyState
      }
    }
  };
}

let accountsStore = loadAccountsStore(createSeedAccountsStore());

// Bug #691: leases used to accept any string as a body. Say how many stored leases name a body the catalog does not
// have, as a count only (no account, no name), and leave them in place: deleting a player's lease is a Board call.
{
  const unknown = unknownLeaseBodies(SYSTEMS_DATA, Object.values(accountsStore.accounts || {}));
  if (unknown) console.warn(`[leases] ${unknown} stored mining lease(s) name a body that is not in data/systems.json (Bug #691); left in place.`);
}
// Bug #711: saves from before corporations had a public id get one on load, so they can be addressed by mail.
backfillCorpPublicIds();
// Bug #689: POST /api/investments is removed. Report what it stored, for the PM, and leave it in place.
{
  const records = directInvestmentRecords(Object.values(accountsStore.accounts || {}));
  if (records.length) console.warn(`[investments] ${records.length} direct investment(s) from the removed route (Bug #689), left in place:`, JSON.stringify(records));
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    safeWriteFile(statePath, JSON.stringify(state, null, 2));
    saveTimer = null;
  }, 300);
}

/** Write the global state now, cancelling a pending debounced save. */
function saveStateNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  safeWriteFile(statePath, JSON.stringify(state, null, 2));
}

let _lastPersistErrorAt = 0;
let _lastPersistErrorSig = "";

function summarizePersistError(error) {
  const raw = String(error?.message || error || "unknown error");
  return raw.length > 400 ? `${raw.slice(0, 400)}\u2026 (truncated)` : raw;
}

function logPersistError(prefix, error) {
  const message = summarizePersistError(error);
  // Signature ignores the message tail so transient outages collapse into
  // a single line per prefix instead of spamming.
  const signature = `${prefix}:${message.slice(0, 80)}`;
  const now = Date.now();
  // Keep the first error visible, but suppress duplicate spam bursts.
  if (signature === _lastPersistErrorSig && now - _lastPersistErrorAt < 15000) {
    return;
  }
  _lastPersistErrorSig = signature;
  _lastPersistErrorAt = now;
  console.error(`${prefix}:`, message);
}

function scheduleAccountsSave() {
  writeAccountsSnapshotToDisk();
}

/**
 * Write the accounts and the global state to the data directory now. The graceful shutdown calls it, so a container
 * stopped for a new revision keeps the last changes (Bug #1153: the debounced writes it used to start never ran).
 */
export async function saveAccountsNow() {
  writeAccountsSnapshotToDiskNow();
  try {
    saveStateNow();
  } catch (error) {
    logPersistError("[state] Failed to write the global state", error);
  }
  return true;
}

export function getState() {
  return state;
}

/** Get/create station-scoped inventory sub-object for a corp */
export function getStationInventory(corp, stationId) {
  if (!corp.inventory || typeof corp.inventory !== "object") corp.inventory = {};
  if (!corp.inventory[stationId]) corp.inventory[stationId] = {};
  return corp.inventory[stationId];
}

export { CEO_INSIGHT_LIBRARY };
export { REFINERY_CHAINS };
export { MISSION_TEMPLATES, refreshContractOfferings };
export { SYSTEM_DETAILS };
export { BELT_COMPOSITIONS, EXPEDITION_DURATIONS, EXPEDITION_LAUNCH_COST, PROBE_BUILD_COST, PROBE_ASSET_VALUE, PROBE_FABRICATION_MS, BASE_MAX_PROBES, BASE_MAX_DEPLOYMENTS };

export function mutateState(mutator) {
  mutator(state);
  scheduleSave();
  return state;
}

export function appendChatMessage(channel, message) {
  mutateState((draft) => {
    // Backstop for Bug #749: the seed is the fix, but a message must never be dropped because a migration lost this.
    if (!draft.chatLog || typeof draft.chatLog !== "object") draft.chatLog = {};
    if (!Array.isArray(draft.chatLog[channel])) {
      draft.chatLog[channel] = [];
    }

    draft.chatLog[channel].push(message);

    if (draft.chatLog[channel].length > 120) {
      draft.chatLog[channel] = draft.chatLog[channel].slice(-120);
    }
  });
}


/**
 * How many combat reports the global state holds, and how big they are, without anything from inside them. Every one
 * was written by POST /api/combat/simulate, removed for Bug #1036 (no login, unbounded strings, sent to every client);
 * they are reported at startup for the PM rather than deleted. Null when there are none.
 */
export function storedCombatReportSummary(globalState) {
  const reports = Array.isArray(globalState?.combatReports) ? globalState.combatReports : [];
  if (!reports.length) return null;
  return { count: reports.length, bytes: Buffer.byteLength(JSON.stringify(reports)) };
}

// Kept for the combat system to come: nothing calls it since POST /api/combat/simulate was removed (Bug #1036).
export function createCombatReport(payload) {
  const report = {
    id: `cmb-${Date.now()}`,
    createdAt: Date.now(),
    ...payload
  };

  mutateState((draft) => {
    draft.combatReports.unshift(report);
    draft.combatReports = draft.combatReports.slice(0, 50);
  });

  return report;
}

function sanitizeAccount(account) {
  return {
    id: account.id,
    email: account.email,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt || null,
    walkthroughCompleted: account.walkthroughCompleted,
    state: deepClone(account.state)
  };
}

function sanitizeNotification(notification) {
  return {
    id: notification.id,
    accountId: notification.accountId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    createdAt: notification.createdAt,
    readAt: notification.readAt || null
  };
}

function pushSystemNotification(account, payload) {
  if (!account.notifications) {
    account.notifications = [];
  }

  account.notifications.unshift({
    id: createId("ntf"),
    accountId: account.id,
    type: payload.type || "system",
    title: payload.title || "Notification",
    body: payload.body || "",
    createdAt: Date.now(),
    readAt: null
  });

  account.notifications = account.notifications.slice(0, 120);
}

export function getAccountById(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  refreshContractOfferings(account.state.corp);
  evaluateLevelProgress(account.state);
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export async function authenticateAccount(email, password) {
  const normalizedEmail = String(email || "").toLowerCase();
  const normalizedPassword = String(password || "");
  const account = Object.values(accountsStore.accounts || {}).find(
    (item) => item.email?.toLowerCase() === normalizedEmail
  );

  if (!account) {
    return null;
  }

  const isValidPassword = bcrypt.compareSync(normalizedPassword, String(account.passwordHash || ""));
  if (!isValidPassword) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  refreshContractOfferings(account.state.corp);
  account.lastLoginAt = Date.now();
  pushSystemNotification(account, {
    type: "auth",
    title: "Secure Access Granted",
    body: "Authentication successful. Welcome back to command."
  });
  scheduleAccountsSave();

  return sanitizeAccount(account);
}

export async function createAccount({ email, password, ceoName, corpName }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { error: "A valid email is required." };
  }

  if (normalizedPassword.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const existing = Object.values(accountsStore.accounts || {}).find((item) => item.email === normalizedEmail);
  if (existing) {
    return { error: "An account with this email already exists." };
  }

  // Bug #433: the name is the only trust signal on the order book, the forums and in mail. Checked before anything is
  // created: 3 to 40 plain characters, unique ignoring case and spacing, and not the name of
  // anything the game itself speaks as.
  const corporation = validateCorporationName(corpName, {
    existingNames: Object.values(accountsStore.accounts || {}).map((item) => item?.state?.corp?.corporationName).filter(Boolean),
    reservedNames: RESERVED_CORPORATION_NAMES
  });
  if (corporation.error) {
    return { error: corporation.error };
  }

  const accountId = createId("acc");
  const passwordHash = bcrypt.hashSync(normalizedPassword, PASSWORD_SALT_ROUNDS);

  const seedState = normalizeStateShape(getSeedState());
  const nextState = createStarterCorporationState(
    seedState,
    String(ceoName || "New CEO").trim() || "New CEO",
    corporation.name
  );

  const account = {
    id: accountId,
    email: normalizedEmail,
    passwordHash,
    walkthroughCompleted: false,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    refreshTokens: [],
    notifications: [],
    messages: [],
    state: nextState
  };

  pushSystemNotification(account, {
    type: "system",
    title: "Corporation Registered",
    body: "Your corporation charter is now active under the Interstellar Settlement Protocol."
  });

  // The letter's text lives in public/scripts/liaison.js with the coordinator who signs it (AB#585).
  pushSystemMessage(account, welcomeLetter(corpName, accountId));

  accountsStore.accounts[accountId] = account;
  scheduleAccountsSave();

  return { account: sanitizeAccount(account) };
}

export function listAccountNotifications(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const notifications = (account.notifications || []).map(sanitizeNotification);
  return {
    notifications,
    unreadCount: notifications.filter((item) => !item.readAt).length
  };
}

export function addAccountNotification(accountId, payload) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  pushSystemNotification(account, payload);
  scheduleAccountsSave();
  return sanitizeNotification(account.notifications[0]);
}

export function markNotificationRead(accountId, notificationId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const target = (account.notifications || []).find((item) => item.id === notificationId);
  if (!target) {
    return null;
  }

  if (!target.readAt) {
    target.readAt = Date.now();
    scheduleAccountsSave();
  }

  return sanitizeNotification(target);
}

export function markAllNotificationsRead(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  const now = Date.now();
  (account.notifications || []).forEach((item) => {
    if (!item.readAt) {
      item.readAt = now;
    }
  });

  scheduleAccountsSave();
  return listAccountNotifications(accountId);
}

// ─── Messaging ───────────────────────────────────────────────────────────────

const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function pushSystemMessage(account, { subject, body, fromName = SYSTEM_SENDERS.SYSTEM }) {
  if (!Array.isArray(account.messages)) account.messages = [];
  account.messages.unshift({
    id: createId("msg"),
    fromType: "system",
    fromId: "system",
    fromName,
    toAccountId: account.id,
    toName: account.state?.corp?.corporationName || "",
    subject,
    body,
    sentAt: Date.now(),
    readAt: null,
    folder: "inbox",
    trashedAt: null
  });
}

function purgeExpiredTrash(account) {
  const cutoff = Date.now() - TRASH_TTL_MS;
  account.messages = (account.messages || []).filter(
    (m) => m.folder !== "trash" || Number(m.trashedAt || 0) > cutoff
  );
}

export function listAccountMessages(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  purgeExpiredTrash(account);
  scheduleAccountsSave();
  // Bug #711: fromId and toAccountId are account ids. They stay in storage but never leave the server: a player's
  // mail names other corporations by publicId.
  return (account.messages || []).map(({ fromId, toAccountId, ...m }) => ({ ...m }));
}

// ─── Mail recipients (Bug #711) ──────────────────────────────────────────────
// Mail was addressed by corporation name and delivered to the first account whose name matched. Names are not unique
// (the registration default made collisions common), so it is now addressed by each corporation's publicId.

/** The name a player's mail is signed with. Never the email address. */
const senderName = (account) => String(account?.state?.corp?.corporationName || "").trim() || "Unregistered corporation";

/** Bug #754: the longest corporation name there is (register.html's maxlength), so a longer recipient is none. */
// A mail recipient name longer than any corporation name cannot match one (Bug #754); the maximum is Bug #433's.
export const CORP_NAME_MAX_LENGTH = CORPORATION_NAME_MAX_LENGTH;
// Control characters (C0 and DEL). Written with escapes so the source holds no raw control bytes.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
/** A draft's recipient as typed, made safe to keep: control characters removed, trimmed, capped. */
const draftRecipientName = (value) => String(value || "").replace(CONTROL_CHARACTERS, "").trim().slice(0, CORP_NAME_MAX_LENGTH);

/** Give every corporation that lacks one a publicId. Returns how many were added. */
export function backfillCorpPublicIds() {
  let added = 0;
  for (const account of Object.values(accountsStore.accounts || {})) {
    const corp = account?.state?.corp;
    if (corp && !corp.publicId) { corp.publicId = createId("corp"); added++; }
  }
  if (added) scheduleAccountsSave();
  return added;
}

const corpCard = (account) => {
  const corp = account.state.corp;
  return { publicId: corp.publicId, corporationName: corp.corporationName || "", ceo: corp.ceo || "", location: corp.location || "" };
};

/** Up to `limit` corporations whose name contains `query` (case-insensitive), described without anything private. */
export function findCorporations(query, limit = 10) {
  const wanted = String(query || "").trim().toLowerCase();
  if (!wanted) return [];
  backfillCorpPublicIds();
  return Object.values(accountsStore.accounts || {})
    .filter((a) => String(a?.state?.corp?.corporationName || "").toLowerCase().includes(wanted))
    .slice(0, limit)
    .map(corpCard);
}

/**
 * Who a message goes to: the corporation with publicId `toCorpId`, or - for drafts and older clients - the one
 * corporation named exactly `toCorpName`. Returns { account } or { status, error, candidates? }; nothing is delivered
 * on an error, so an ambiguous name can never reach the wrong player.
 */
export function resolveMailRecipient({ toCorpId, toCorpName } = {}) {
  backfillCorpPublicIds();
  const accounts = Object.values(accountsStore.accounts || {}).filter((a) => a?.state?.corp);
  const id = String(toCorpId || "").trim();
  if (id) {
    const account = accounts.find((a) => a.state.corp.publicId === id);
    return account ? { account } : { status: 404, error: "That corporation no longer exists." };
  }
  const typed = String(toCorpName || "").trim();
  if (!typed) return { status: 400, error: "Recipient corporation is required." };
  // Bug #754: no corporation name is longer than this or contains a control character, so such a name is refused
  // outright rather than truncated into something that might match a real corporation.
  CONTROL_CHARACTERS.lastIndex = 0;
  if (typed.length > CORP_NAME_MAX_LENGTH || CONTROL_CHARACTERS.test(typed)) {
    return { status: 400, error: "That is not a corporation name." };
  }
  const name = typed.toLowerCase();
  const matches = accounts.filter((a) => String(a.state.corp.corporationName || "").trim().toLowerCase() === name);
  if (matches.length === 1) return { account: matches[0] };
  if (!matches.length) return { status: 404, error: "No corporation has that name." };
  return {
    status: 409,
    error: `${matches.length} corporations share that name. Choose which one you mean.`,
    candidates: matches.slice(0, 10).map(corpCard)
  };
}

export function markMessageRead(accountId, messageId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  const msg = (account.messages || []).find((m) => m.id === messageId);
  if (!msg) return null;
  if (!msg.readAt) {
    msg.readAt = Date.now();
    scheduleAccountsSave();
  }
  return { ...msg };
}

export function moveMessage(accountId, messageId, folder) {
  const validFolders = ["inbox", "archive", "trash"];
  if (!validFolders.includes(folder)) return null;
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  const msg = (account.messages || []).find((m) => m.id === messageId);
  if (!msg) return null;
  msg.folder = folder;
  if (folder === "trash") msg.trashedAt = Date.now();
  else msg.trashedAt = null;
  scheduleAccountsSave();
  return { ...msg };
}

export function sendPlayerMessage(fromAccountId, { toCorpId, toCorpName, subject, body }) {
  const sender = accountsStore.accounts?.[fromAccountId];
  if (!sender) return { error: "Sender not found." };

  const trimmedSubject = String(subject || "").trim().slice(0, 200) || "(no subject)";
  const trimmedBody = String(body || "").trim().slice(0, 8000);
  if (!trimmedBody) return { status: 400, error: "Message body cannot be empty." };

  // Bug #711: by publicId, or by a name only when exactly one corporation has it. Self-send is still allowed.
  const resolved = resolveMailRecipient({ toCorpId, toCorpName });
  if (!resolved.account) return resolved;
  const recipient = resolved.account;

  const sentAt = Date.now();
  const fromName = senderName(sender); // never the email address (Bug #711)
  const toName = recipient.state?.corp?.corporationName || "";
  const fromCorpId = sender.state?.corp?.publicId || null;
  const recipientCorpId = recipient.state?.corp?.publicId || null;

  // Delivered copy in recipient inbox
  if (!Array.isArray(recipient.messages)) recipient.messages = [];
  recipient.messages.unshift({
    id: createId("msg"),
    fromType: "player",
    fromId: fromAccountId,
    fromName,
    fromCorpId,
    toAccountId: recipient.id,
    toName,
    toCorpId: recipientCorpId,
    subject: trimmedSubject,
    body: trimmedBody,
    sentAt,
    readAt: null,
    folder: "inbox",
    trashedAt: null
  });

  // Sent copy in sender outbox
  if (!Array.isArray(sender.messages)) sender.messages = [];
  sender.messages.unshift({
    id: createId("msg"),
    fromType: "player",
    fromId: fromAccountId,
    fromName,
    fromCorpId,
    toAccountId: recipient.id,
    toName,
    toCorpId: recipientCorpId,
    subject: trimmedSubject,
    body: trimmedBody,
    sentAt,
    readAt: sentAt,
    folder: "sent",
    trashedAt: null
  });

  scheduleAccountsSave();
  return { ok: true, toName };
}

export function saveDraft(accountId, { draftId, toCorpId, toCorpName, subject, body }) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  if (!Array.isArray(account.messages)) account.messages = [];
  // Bug #711: a draft keeps the recipient's publicId, so it is sent to the corporation it was written for.
  const draftCorpId = String(toCorpId || "").trim().slice(0, 64) || null;

  if (draftId) {
    const existing = account.messages.find((m) => m.id === draftId && m.folder === "draft");
    if (existing) {
      existing.toCorpId = draftCorpId;
      existing.toCorpName = draftRecipientName(toCorpName); // Bug #754: capped, no control characters
      existing.subject = String(subject || "").trim().slice(0, 200);
      existing.body = String(body || "").trim().slice(0, 8000);
      existing.updatedAt = Date.now();
      scheduleAccountsSave();
      return { ...existing };
    }
  }

  const draft = {
    id: createId("msg"),
    fromType: "player",
    fromId: accountId,
    fromName: senderName(account),
    toAccountId: null,
    toCorpId: draftCorpId,
    toCorpName: draftRecipientName(toCorpName), // Bug #754: capped, no control characters
    toName: "",
    subject: String(subject || "").trim().slice(0, 200),
    body: String(body || "").trim().slice(0, 8000),
    sentAt: Date.now(),
    readAt: Date.now(),
    folder: "draft",
    trashedAt: null
  };
  account.messages.unshift(draft);
  scheduleAccountsSave();
  return { ...draft };
}

export function deleteDraft(accountId, draftId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return false;
  const before = (account.messages || []).length;
  account.messages = (account.messages || []).filter((m) => !(m.id === draftId && m.folder === "draft"));
  if (account.messages.length !== before) {
    scheduleAccountsSave();
    return true;
  }
  return false;
}

export function addSystemMessageToAccount(accountId, { subject, body, fromName = SYSTEM_SENDERS.SYSTEM }) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  pushSystemMessage(account, { subject, body, fromName });
  scheduleAccountsSave();
  return (account.messages || [])[0];
}

export function accountExists(accountId) {
  return Boolean(accountsStore.accounts?.[accountId]);
}

export function getAllAccountIds() {
  return Object.keys(accountsStore.accounts || {});
}

// TODO(AB#757): Evaluate usage of Refresh Tokens
export function storeRefreshToken(accountId, token, expiresAt) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return false;
  }

  if (!Array.isArray(account.refreshTokens)) {
    account.refreshTokens = [];
  }

  account.refreshTokens.push({ token, expiresAt: Number(expiresAt || 0) });
  account.refreshTokens = account.refreshTokens
    .filter((item) => item.expiresAt > Date.now())
    .slice(-10);
  scheduleAccountsSave();
  return true;
}

export function revokeRefreshToken(accountId, token) {
  const account = accountsStore.accounts?.[accountId];
  if (!account || !Array.isArray(account.refreshTokens)) {
    return false;
  }

  const before = account.refreshTokens.length;
  account.refreshTokens = account.refreshTokens.filter((item) => item.token !== token);
  if (account.refreshTokens.length !== before) {
    scheduleAccountsSave();
    return true;
  }

  return false;
}

export function hasRefreshToken(accountId, token) {
  const account = accountsStore.accounts?.[accountId];
  if (!account || !Array.isArray(account.refreshTokens)) {
    return false;
  }

  const now = Date.now();
  account.refreshTokens = account.refreshTokens.filter((item) => item.expiresAt > now);
  return account.refreshTokens.some((item) => item.token === token);
}

export function getDummyAccount() {
  applyMiningOperations(accountsStore.accounts.dummy.state.corp);
  evaluateLevelProgress(accountsStore.accounts.dummy.state);
  scheduleAccountsSave();
  return sanitizeAccount(accountsStore.accounts.dummy);
}

export function markWalkthroughCompleted(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  account.walkthroughCompleted = true;
  account.state.playerProfile.walkthroughCompleted = true;
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export function resetWalkthroughCompletion(accountId) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  account.walkthroughCompleted = false;
  account.state.playerProfile.walkthroughCompleted = false;
  scheduleAccountsSave();
  return sanitizeAccount(account);
}

export function resetDummyAccountProgress() {
  const dummy = accountsStore.accounts?.dummy;
  if (!dummy) {
    return null;
  }

  const seedState = normalizeStateShape(getSeedState());
  dummy.state = createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics");
  dummy.notifications = [];
  dummy.messages = [];
  dummy.walkthroughCompleted = false;
  dummy.state.playerProfile.walkthroughCompleted = false;

  // Strip any market sell orders belonging to the dummy account from global state
  const dummyId = dummy.id;
  state.market.orderBook = (state.market.orderBook || []).filter(
    (order) => order.type !== "sell" || order.sellerAccountId !== dummyId
  );
  scheduleSave();

  scheduleAccountsSave();
  return sanitizeAccount(dummy);
}

export function mutateAccountState(accountId, mutator) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) {
    return null;
  }

  applyMiningOperations(account.state.corp);
  mutator(account.state);
  applyMiningOperations(account.state.corp);
  refreshContractOfferings(account.state.corp);
  ensureCorpMiningModel(account.state.corp);
  evaluateLevelProgress(account.state);
  scheduleAccountsSave();
  return sanitizeAccount(account);
}
