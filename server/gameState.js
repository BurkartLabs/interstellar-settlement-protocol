import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "..", "data");
const statePath = path.join(dataDir, "state.json");
const accountsPath = path.join(dataDir, "accounts.json");
const milestonesPath = path.join(dataDir, "milestones.json");
const PASSWORD_SALT_ROUNDS = 10;
const IS_SERVERLESS = Boolean(process.env.VERCEL);
const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_ANON_KEY = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const USE_SUPABASE_AUTH = Boolean(USE_SUPABASE && SUPABASE_ANON_KEY);
const SUPABASE_MANAGED_PASSWORD_HASH = "__supabase_auth_managed__";

// Load station data for body→station mapping
const STATIONS_RAW = JSON.parse(fs.readFileSync(path.join(dataDir, "stations.json"), "utf8"));
const BODY_TO_STATION = {};
const STATION_REGISTRY_CACHE = {};
for (const s of STATIONS_RAW.stations) {
  BODY_TO_STATION[s.body] = s.id;
  STATION_REGISTRY_CACHE[s.id] = s;
}

const supabaseAdmin = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const supabaseAuthClient = USE_SUPABASE_AUTH
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;

// Clean up any leftover .tmp files from interrupted atomic writes
if (!IS_SERVERLESS) {
  for (const f of fs.readdirSync(dataDir)) {
    if (f.endsWith(".tmp")) {
      try { fs.unlinkSync(path.join(dataDir, f)); } catch {}
    }
  }
}

function safeWriteFile(filePath, data, contextLabel = "write") {
  try {
    // Atomic write: write to a temp file then rename, so a mid-write kill
    // (e.g. double Ctrl+C or node --watch termination) never truncates the real file.
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, data, "utf8");
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (error) {
    // Vercel filesystem is read-only for deployed source paths; keep running in-memory.
    if (IS_SERVERLESS && (error?.code === "EROFS" || error?.code === "EPERM" || error?.code === "EACCES")) {
      return false;
    }
    throw error;
  }
}

// ─── Milestones: single source of truth from data/milestones.json ──────────
const MILESTONES_DATA = JSON.parse(fs.readFileSync(milestonesPath, "utf8"));
const MILESTONE_LEVELS = MILESTONES_DATA.levels;           // [{level, requirements, unlocks}, ...]
const MILESTONE_ROADMAP = MILESTONES_DATA.roadmap;          // ["Rent an Office", ...]

// ─── CEO Insight programs ────────────────────────────────────────────────────
const ceoInsightPath = path.join(dataDir, "ceo-insight.json");
const CEO_INSIGHT_DATA = JSON.parse(fs.readFileSync(ceoInsightPath, "utf8"));
const CEO_INSIGHT_LIBRARY = {};
for (const prog of CEO_INSIGHT_DATA.programs) {
  CEO_INSIGHT_LIBRARY[prog.id] = prog;
}

// ─── Systems: single source of truth from data/systems.json ────────────────
const SYSTEMS_DATA = JSON.parse(fs.readFileSync(path.join(dataDir, "systems.json"), "utf8"));

// ─── Refinery chains ────────────────────────────────────────────────────────
const refineryChainsPath = path.join(dataDir, "refinery-chains.json");
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
    const defaults = SYSTEM_DETAILS[system.id];
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
      totalSpent: Number(extractor.totalSpent || 0),
      lastCompletedAt: extractor.lastCompletedAt ?? null,
      leaseId: extractor.leaseId ?? null,
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
    totalSpent: 0,
    lastCompletedAt: null
  };

  if (!corp.unlocks || typeof corp.unlocks !== "object") {
    corp.unlocks = {};
  }
  if (typeof corp.unlocks.maxBasicExtractorYards !== "number") {
    corp.unlocks.maxBasicExtractorYards = 1;
  }
}

function stopExtractorCycle(extractor, timestamp) {
  extractor.active = false;
  extractor.endsAt = timestamp;
  extractor.lastTickAt = timestamp;
  extractor.lastCompletedAt = timestamp;
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
    const baseProbPerSec = 0.00005; // 0.005% per second
    let probPerSec = baseProbPerSec;
    if ((corp.unlockedTech || []).includes("tt-industrial-safety")) {
      probPerSec *= 0.92; // -8% risk
    }
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

    const actualMined = Math.floor(projectedMined * affordabilityRatio);
    const actualCost = Math.round(projectedCost * affordabilityRatio);

    if (actualCost > 0) {
      corp.finances.credits = Math.max(0, corp.finances.credits - actualCost);
      extractor.totalSpent += actualCost;
    }

    if (actualMined > 0) {
      // Deposit at the station orbiting the extractor's lease body
      const lease = (corp.miningLeases || []).find((l) => l.id === extractor.leaseId);
      const depositStation = (lease && BODY_TO_STATION[lease.body]) || corp.currentStationId || "earth-station-prime";
      const stationInv = getStationInventory(corp, depositStation);
      stationInv.Silicates = (stationInv.Silicates || 0) + actualMined;
      extractor.totalMined += actualMined;
      corp.finances.dailyRevenue += Math.round(actualMined * 2.4);
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
    startedAt: ref.startedAt ?? null,
    lastTickAt: ref.lastTickAt ?? null,
    endsAt: ref.endsAt ?? null,
    cyclesCompleted: Number(ref.cyclesCompleted || 0),
    totalInputConsumed: Number(ref.totalInputConsumed || 0),
    totalOutputProduced: Number(ref.totalOutputProduced || 0)
  }));
}

export function applyRefineryOperations(corp, now = Date.now()) {
  ensureCorpRefineryModel(corp);

  corp.refineries.forEach((ref) => {
    if (!ref.active || !ref.chainId) return;

    const chain = REFINERY_CHAINS[ref.chainId];
    if (!chain) {
      ref.active = false;
      return;
    }

    const endsAt = Number(ref.endsAt || 0);
    if (!endsAt || now < endsAt) return;

    // Cycle complete — produce outputs at current station
    if (!corp.inventory) corp.inventory = {};
    const refStationId = corp.currentStationId || "earth-station-prime";
    const refStationInv = getStationInventory(corp, refStationId);
    for (const output of chain.outputs) {
      refStationInv[output.item] = (refStationInv[output.item] || 0) + output.quantityPerCycle;
      ref.totalOutputProduced += output.quantityPerCycle;
    }

    ref.cyclesCompleted += 1;
    ref.active = false;
    ref.chainId = null;
    ref.startedAt = null;
    ref.lastTickAt = null;
    ref.endsAt = null;
  });
}

// ─── Asteroid Belt Mining ────────────────────────────────────────────────────

// Deterministic belt compositions per system — scoutable
const BELT_COMPOSITIONS = {
  "sol:belt":          { "Silicates": 35, "Carbon": 25, "Nickel": 20, "Water Ice": 15, "Titanium": 5 },
  "alpha-centauri:ac-belt": { "Silicates": 25, "Nickel": 22, "Titanium": 18, "Carbon": 15, "Hydrogen": 12, "Lithium": 8 },
  "barnards-star:bn-rift":  { "Nickel": 25, "Titanium": 22, "Carbon": 18, "Silicates": 15, "Hydrogen": 12, "Cobalt": 8 },
  "wolf-359:wf-shards":     { "Titanium": 20, "Nickel": 18, "Rare Earths": 16, "Lithium": 14, "Carbon": 12, "Cobalt": 10, "Thorium": 10 },
  "tau-ceti:tc-cloud":      { "Rare Earths": 18, "Cobalt": 16, "Thorium": 14, "Titanium": 14, "Nickel": 12, "Helium-3": 10, "Lithium": 8, "Uranium": 8 },
  "epsilon-eridani:ee-crown":{ "Rare Earths": 15, "Thorium": 14, "Uranium": 12, "Cobalt": 12, "Exotic Matter": 8, "Helium-3": 10, "Titanium": 10, "Lithium": 10, "Nickel": 9 }
};

// Rarity tiers control yield multiplier and the chance of bonus "jackpot" drops
const SYSTEM_RARITY = {
  sol:                "common",
  "alpha-centauri":   "uncommon",
  "barnards-star":    "uncommon",
  "wolf-359":         "rare",
  "tau-ceti":         "rare",
  "epsilon-eridani":  "exotic"
};

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
const BASE_MAX_PROBES = 2;
const BASE_MAX_DEPLOYMENTS = 1;        // concurrent expedition slots

function ensureCorpAsteroidMiningModel(corp) {
  if (!corp.asteroidMining || typeof corp.asteroidMining !== "object") {
    corp.asteroidMining = {};
  }
  const am = corp.asteroidMining;

  if (typeof am.probeCount !== "number") am.probeCount = 0;
  if (typeof am.maxProbes !== "number") am.maxProbes = BASE_MAX_PROBES;
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

    const rarity = SYSTEM_RARITY[exp.systemId] || "common";
    const rarityMult = RARITY_YIELD_MULTIPLIER[rarity];
    const durationDef = EXPEDITION_DURATIONS[exp.duration] || EXPEDITION_DURATIONS.standard;
    const tickMult = durationDef.tickYieldMultiplier;

    // Roll resources for this tick interval
    const tickMinutes = elapsedMs / (60 * 1000);
    // Base: ~2-5 units per resource per tick minute
    const baseYieldPerMin = 3;
    const totalYield = Math.floor(tickMinutes * baseYieldPerMin * rarityMult * tickMult);

    if (totalYield > 0) {
      // Generate a tick-unique seed from expedition id + tick timestamp
      const tickSeed = (hashSeedStr(exp.id) + Math.floor(now / 5000)) | 0;

      // Roll 1–3 resources per tick
      const dropCount = 1 + Math.floor(seededRand(tickSeed) * 3);
      for (let i = 0; i < dropCount; i++) {
        const resource = weightedPick(composition, tickSeed + i * 7919);
        const qty = Math.max(1, Math.floor((totalYield / dropCount) * (0.6 + seededRand(tickSeed + i * 3571) * 0.8)));
        exp.yields[resource] = (exp.yields[resource] || 0) + qty;
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
      am.probeCount = Math.min(am.maxProbes, (am.probeCount || 0) + 1);

      // Move to completed log (keep last 20)
      am.completedExpeditions.unshift({ ...exp, completedAt: now, depositStationId });
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

function evaluateLevelProgress(profileState) {
  const corp = profileState.corp;

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

  // Apply level-ups and unlock grants from milestones.json
  for (const levelDef of MILESTONE_LEVELS) {
    const lvlNum = levelDef.level;
    if (corp.level < lvlNum && corp.levelProgress[`level${lvlNum}`].allCompleted) {
      corp.level = lvlNum;
      const tag = `Reached Corporation Level ${lvlNum}`;
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
  }
}

function createStarterCorporationState(baseState, ceoName, corpName) {
  const next = deepClone(baseState);

  next.corp = {
    ...next.corp,
    ceo: ceoName,
    corporationName: corpName,
    location: "Earth",
    currentStationId: "earth-station-prime",
    currentSystemId: "sol",
    travel: null,
    level: 0,
    levelCap: 40,
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
      exchangeSalesTaxPct: 8
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

  // Shuffle and pick
  const shuffled = eligible.slice().sort(() => Math.random() - 0.5);
  offerings.missions = shuffled.slice(0, CONTRACTS_PER_AGENT).map(t => ({ ...t }));
  offerings.nextRefreshAt = now + CONTRACT_REFRESH_MS;

  return offerings;
}

function getSeedState() {
  return {
    world: {
      lawName: "Interstellar Settlement Protocol",
      lawYear: 2147,
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
    corp: {
      id: "corp-001",
      ceo: "You",
      corporationName: "ISP Foundry Holdings",
      level: 1,
      levelCap: 40,
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

function ensureStateFile() {
  if (!IS_SERVERLESS && !fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(statePath)) {
    const seed = normalizeStateShape(getSeedState());
    if (!IS_SERVERLESS) {
      safeWriteFile(statePath, JSON.stringify(seed, null, 2), "state init");
    }
    return seed;
  }

  const raw = fs.readFileSync(statePath, "utf8");
  const parsed = JSON.parse(raw);
  const normalized = normalizeStateShape(parsed);

  // Ensure NPC buy orders exist in global market state
  if (!normalized.market) normalized.market = {};
  if (!Array.isArray(normalized.market.npcBuyOrders)) {
    normalized.market.npcBuyOrders = [
      {
        id: "npc-buy-silicates-daily",
        item: "Silicates",
        buyer: "GEX Commodities Authority",
        unitPrice: 24,
        totalQtyPerDay: 1000000,
        remainingQty: 1000000,
        lastResetDate: ""
      }
    ];
  }

  if (!IS_SERVERLESS) {
    safeWriteFile(statePath, JSON.stringify(normalized, null, 2), "state normalize");
  }
  return normalized;
}

let state = ensureStateFile();
let saveTimer = null;
let accountsSaveTimer = null;

function stateWithAccountMeta(account) {
  const stateCopy = deepClone(account.state || {});
  stateCopy.__accountMeta = {
    refreshTokens: Array.isArray(account.refreshTokens) ? account.refreshTokens : [],
    notifications: Array.isArray(account.notifications) ? account.notifications : [],
    messages: Array.isArray(account.messages) ? account.messages : []
  };
  return stateCopy;
}

function splitAccountStateAndMeta(rawState) {
  const stateCopy = deepClone(rawState || {});
  const meta = stateCopy.__accountMeta || {};
  delete stateCopy.__accountMeta;
  return {
    state: normalizeStateShape(stateCopy),
    refreshTokens: Array.isArray(meta.refreshTokens) ? meta.refreshTokens : [],
    notifications: Array.isArray(meta.notifications) ? meta.notifications : [],
    messages: Array.isArray(meta.messages) ? meta.messages : []
  };
}

async function persistAccountsStoreToSupabase(snapshot = accountsStore) {
  if (!USE_SUPABASE || !supabaseAdmin) {
    return;
  }

  const allAccounts = Object.values(snapshot.accounts || {});
  if (!allAccounts.length) {
    return;
  }

  const accountRows = allAccounts.map((account) => ({
    id: account.id,
    email: String(account.email || "").toLowerCase(),
    password_hash: String(account.passwordHash || SUPABASE_MANAGED_PASSWORD_HASH),
    walkthrough_completed: Boolean(account.walkthroughCompleted),
    created_at: new Date(Number(account.createdAt || Date.now())).toISOString(),
    last_login_at: account.lastLoginAt ? new Date(Number(account.lastLoginAt)).toISOString() : null
  }));

  const stateRows = allAccounts.map((account) => ({
    account_id: account.id,
    state_json: stateWithAccountMeta(account),
    updated_at: new Date().toISOString()
  }));

  const { error: accountError } = await supabaseAdmin
    .from("accounts")
    .upsert(accountRows, { onConflict: "id" });

  if (accountError) {
    throw accountError;
  }

  const { error: stateError } = await supabaseAdmin
    .from("account_state")
    .upsert(stateRows, { onConflict: "account_id" });

  if (stateError) {
    throw stateError;
  }
}

async function hydrateAccountsStoreFromSupabaseOrFallback(fallbackStore) {
  if (!USE_SUPABASE || !supabaseAdmin) {
    return fallbackStore;
  }

  try {
    const { data: accountRows, error: accountError } = await supabaseAdmin
      .from("accounts")
      .select("id, email, password_hash, walkthrough_completed, created_at, last_login_at");

    if (accountError) {
      throw accountError;
    }

    if (!Array.isArray(accountRows) || accountRows.length === 0) {
      await persistAccountsStoreToSupabase(fallbackStore);
      return fallbackStore;
    }

    const { data: stateRows, error: stateError } = await supabaseAdmin
      .from("account_state")
      .select("account_id, state_json");

    if (stateError) {
      throw stateError;
    }

    const stateByAccountId = new Map((stateRows || []).map((row) => [row.account_id, row.state_json]));
    const hydrated = { accounts: {} };
    const seedState = normalizeStateShape(getSeedState());

    for (const row of accountRows) {
      const rawState = stateByAccountId.get(row.id) || createStarterCorporationState(seedState, "New CEO", "Frontier Protocol Ventures");
      const parsed = splitAccountStateAndMeta(rawState);
      parsed.state.playerProfile.walkthroughCompleted = Boolean(row.walkthrough_completed);
      evaluateLevelProgress(parsed.state);

      hydrated.accounts[row.id] = {
        id: row.id,
        email: String(row.email || "").toLowerCase(),
        passwordHash: String(row.password_hash || SUPABASE_MANAGED_PASSWORD_HASH),
        walkthroughCompleted: Boolean(row.walkthrough_completed),
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).getTime() : null,
        refreshTokens: parsed.refreshTokens,
        notifications: parsed.notifications,
        messages: parsed.messages,
        state: parsed.state
      };
    }

    return hydrated;
  } catch (error) {
    console.error("[supabase] Failed to hydrate accounts store, using local fallback:", error?.message || error);
    return fallbackStore;
  }
}

function ensureAccountsFile() {
  if (!IS_SERVERLESS && !fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const seedState = normalizeStateShape(getSeedState());

  if (!fs.existsSync(accountsPath)) {
    const dummyState = createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics");
    // Grant dummy account all research + nav techs for testing
    dummyState.corp.unlockedTech = [
      "tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast",
      "tt-energy-routing", "tt-fleet-coordination",
      "tt-proxima-navigation", "tt-deep-star-navigation"
    ];
    const seedAccounts = {
      accounts: {
        dummy: {
          id: "dummy",
          email: "dummy@isp.local",
          passwordHash: bcrypt.hashSync("dummy-password", PASSWORD_SALT_ROUNDS),
          createdAt: Date.now(),
          refreshTokens: [],
          notifications: [],
          walkthroughCompleted: false,
          state: dummyState
        }
      }
    };

    if (!IS_SERVERLESS) {
      safeWriteFile(accountsPath, JSON.stringify(seedAccounts, null, 2), "accounts init");
    }
    return seedAccounts;
  }

  const raw = fs.readFileSync(accountsPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed.accounts || typeof parsed.accounts !== "object") {
    parsed.accounts = {};
  }

  if (!parsed.accounts.dummy) {
    const dummyState2 = createStarterCorporationState(seedState, "Test Director", "Protocol Sandbox Dynamics");
    dummyState2.corp.unlockedTech = [
      "tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast",
      "tt-energy-routing", "tt-fleet-coordination",
      "tt-proxima-navigation", "tt-deep-star-navigation"
    ];
    parsed.accounts.dummy = {
      id: "dummy",
      email: "dummy@isp.local",
      passwordHash: bcrypt.hashSync("dummy-password", PASSWORD_SALT_ROUNDS),
      createdAt: Date.now(),
      refreshTokens: [],
      notifications: [],
      walkthroughCompleted: false,
      state: dummyState2
    };
  }

  Object.values(parsed.accounts).forEach((account) => {
    if (!account.id) {
      account.id = createId("acc");
    }

    account.email = String(account.email || "").toLowerCase();

    if (!account.passwordHash) {
      const legacyPassword = String(account.password || "dummy-password");
      account.passwordHash = bcrypt.hashSync(legacyPassword, PASSWORD_SALT_ROUNDS);
    }

    if (account.password) {
      delete account.password;
    }

    if (typeof account.createdAt !== "number") {
      account.createdAt = Date.now();
    }

    if (!Array.isArray(account.refreshTokens)) {
      account.refreshTokens = [];
    }

    if (!Array.isArray(account.notifications)) {
      account.notifications = [];
    }

    if (!Array.isArray(account.messages)) {
      account.messages = [];
    }

    account.state = normalizeStateShape(account.state || createStarterCorporationState(seedState, "New CEO", "Frontier Protocol Ventures"));
    if (typeof account.walkthroughCompleted !== "boolean") {
      account.walkthroughCompleted = Boolean(account.state.playerProfile?.walkthroughCompleted);
    }
    account.state.playerProfile.walkthroughCompleted = account.walkthroughCompleted;
    evaluateLevelProgress(account.state);
  });

  // On startup: normalize dummy account state to pick up any new fields, but preserve
  // all progress and active sessions. Progress and tokens are only reset on explicit request.
  if (parsed.accounts.dummy) {
    if (parsed.accounts.dummy.state) {
      parsed.accounts.dummy.state = normalizeStateShape(parsed.accounts.dummy.state);
      evaluateLevelProgress(parsed.accounts.dummy.state);
    }
  }

  if (!IS_SERVERLESS) {
    safeWriteFile(accountsPath, JSON.stringify(parsed, null, 2), "accounts normalize");
  }
  return parsed;
}

let accountsStore = await hydrateAccountsStoreFromSupabaseOrFallback(ensureAccountsFile());

function scheduleSave() {
  if (IS_SERVERLESS) {
    return;
  }

  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    safeWriteFile(statePath, JSON.stringify(state, null, 2), "state save");
    saveTimer = null;
  }, 300);
}

let _persistDirty = false;

function scheduleAccountsSave() {
  if (USE_SUPABASE) {
    if (IS_SERVERLESS) {
      // On serverless, just mark dirty — the flush middleware will persist before responding
      _persistDirty = true;
      return;
    }

    // Non-serverless: debounce as before
    if (accountsSaveTimer) {
      clearTimeout(accountsSaveTimer);
    }

    accountsSaveTimer = setTimeout(() => {
      persistAccountsStoreToSupabase().catch((error) => {
        console.error("[supabase] Failed to persist account snapshot:", error?.message || error);
      });
      accountsSaveTimer = null;
    }, 300);
    return;
  }

  if (IS_SERVERLESS) {
    return;
  }

  if (accountsSaveTimer) {
    clearTimeout(accountsSaveTimer);
  }

  accountsSaveTimer = setTimeout(() => {
    safeWriteFile(accountsPath, JSON.stringify(accountsStore, null, 2), "accounts save");
    accountsSaveTimer = null;
  }, 300);
}

export async function saveAccountsNow() {
  if (USE_SUPABASE) {
    _persistDirty = false;
    await persistAccountsStoreToSupabase();
    return;
  }

  if (IS_SERVERLESS) {
    return;
  }

  if (accountsSaveTimer) {
    clearTimeout(accountsSaveTimer);
    accountsSaveTimer = null;
  }
  safeWriteFile(accountsPath, JSON.stringify(accountsStore, null, 2), "accounts save immediate");
}

export async function flushPendingPersist() {
  if (_persistDirty && USE_SUPABASE) {
    _persistDirty = false;
    try {
      await persistAccountsStoreToSupabase();
    } catch (error) {
      console.error("[supabase] Flush persist failed:", error?.message || error);
    }
  }
}

export async function rehydrateFromSupabase() {
  if (!USE_SUPABASE || !supabaseAdmin) return;
  try {
    const fresh = await hydrateAccountsStoreFromSupabaseOrFallback(accountsStore);
    accountsStore.accounts = fresh.accounts;
  } catch (err) {
    console.error("[supabase] rehydrate failed, keeping in-memory state:", err?.message || err);
  }
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
    if (!draft.chatLog[channel]) {
      draft.chatLog[channel] = [];
    }

    draft.chatLog[channel].push(message);

    if (draft.chatLog[channel].length > 120) {
      draft.chatLog[channel] = draft.chatLog[channel].slice(-120);
    }
  });
}

export function resetChatHistory() {
  mutateState((draft) => {
    draft.chatLog = {
      global: [],
      local: [],
      trade: [],
      private: []
    };
  });
}

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

  if (USE_SUPABASE_AUTH && supabaseAuthClient) {
    const { error } = await supabaseAuthClient.auth.signInWithPassword({
      email: normalizedEmail,
      password: normalizedPassword
    });
    if (error) {
      return null;
    }
  } else {
    if (!account) {
      return null;
    }

    const isValidPassword = bcrypt.compareSync(normalizedPassword, String(account.passwordHash || ""));
    if (!isValidPassword) {
      return null;
    }
  }

  if (!account) {
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

  let accountId = createId("acc");
  let passwordHash = bcrypt.hashSync(normalizedPassword, PASSWORD_SALT_ROUNDS);

  if (USE_SUPABASE_AUTH && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: normalizedPassword,
      email_confirm: true
    });

    if (error) {
      const message = String(error.message || "").toLowerCase();
      if (message.includes("already") || message.includes("registered")) {
        return { error: "An account with this email already exists." };
      }
      return { error: `Supabase auth registration failed: ${error.message}` };
    }

    accountId = data?.user?.id || accountId;
    passwordHash = SUPABASE_MANAGED_PASSWORD_HASH;
  }

  const seedState = normalizeStateShape(getSeedState());
  const nextState = createStarterCorporationState(
    seedState,
    String(ceoName || "New CEO").trim() || "New CEO",
    String(corpName || "Frontier Protocol Ventures").trim() || "Frontier Protocol Ventures"
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

  pushSystemMessage(account, {
    subject: `ISA Settlement Licence — Ref. ISP-2147-${accountId.toUpperCase()}-AUTH`,
    fromName: "Interstellar Settlement Authority",
    body:
      `To the registered CEO of ${String(corpName || "Frontier Protocol Ventures").trim()},\n\n` +
      `Your corporation has been assessed and approved under the provisions of the Interstellar Settlement Protocol (Earth Assembly Act, 2147).\n\n` +
      `This licence grants your corporation the legal right to:\n` +
      `  — Establish a registered operational presence at any ISA-recognised station\n` +
      `  — Apply for extraction rights across approved bodies within the Sol system\n` +
      `  — Engage in commerce on the Galactic Exchange under your registered charter\n\n` +
      `Your first recommended action is to secure office space at Earth Station Prime. Enclosed is your Founding Charter reference number for all future ISA correspondence.\n\n` +
      `Founding Charter Ref: ISP/${accountId.toUpperCase()}/FC-001\n\n` +
      `Liaison Officer Aria Voss\nInterstellar Settlement Authority — Sol Division`
  });

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

function pushSystemMessage(account, { subject, body, fromName = "ISA System" }) {
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
  return (account.messages || []).map((m) => ({ ...m }));
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

export function sendPlayerMessage(fromAccountId, { toCorpName, subject, body }) {
  const sender = accountsStore.accounts?.[fromAccountId];
  if (!sender) return { error: "Sender not found." };

  const normalizedTarget = String(toCorpName || "").trim().toLowerCase();
  if (!normalizedTarget) return { error: "Recipient corporation name is required." };

  const recipient = Object.values(accountsStore.accounts || {}).find(
    (a) => a.id !== fromAccountId && String(a.state?.corp?.corporationName || "").trim().toLowerCase() === normalizedTarget
  );
  if (!recipient) return { error: `No corporation found matching \"${toCorpName}\".` };

  const trimmedSubject = String(subject || "").trim().slice(0, 200) || "(no subject)";
  const trimmedBody = String(body || "").trim().slice(0, 8000);
  if (!trimmedBody) return { error: "Message body cannot be empty." };

  const sentAt = Date.now();
  const fromName = sender.state?.corp?.corporationName || sender.email;
  const toName = recipient.state?.corp?.corporationName || "";

  // Delivered copy in recipient inbox
  if (!Array.isArray(recipient.messages)) recipient.messages = [];
  recipient.messages.unshift({
    id: createId("msg"),
    fromType: "player",
    fromId: fromAccountId,
    fromName,
    toAccountId: recipient.id,
    toName,
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
    toAccountId: recipient.id,
    toName,
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

export function saveDraft(accountId, { draftId, toCorpName, subject, body }) {
  const account = accountsStore.accounts?.[accountId];
  if (!account) return null;
  if (!Array.isArray(account.messages)) account.messages = [];

  if (draftId) {
    const existing = account.messages.find((m) => m.id === draftId && m.folder === "draft");
    if (existing) {
      existing.toCorpName = String(toCorpName || "").trim();
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
    fromName: account.state?.corp?.corporationName || "",
    toAccountId: null,
    toCorpName: String(toCorpName || "").trim(),
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

export function addSystemMessageToAccount(accountId, { subject, body, fromName = "ISA System" }) {
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
