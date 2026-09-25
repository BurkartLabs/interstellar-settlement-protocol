// server/game/catalog.js: part of the game state, split out of server/gameState.js by system (AB#737).

import "../loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
// Bug #578: two directories. The game's catalogues (stations, systems, research and the rest) ship with the code in
// data/. What the server writes, state.json and accounts-snapshot.json, goes to ISP_DATA_DIR: a mounted volume in the
// container, data/ when it is not set. The test process points it at an empty directory of its own, so every run
// starts from the seed and never reads what a local server last wrote (Bug #588).
export const catalogueDir = path.join(__dirname, "..", "..", "data");
export const dataDir = process.env.ISP_DATA_DIR ? path.resolve(process.env.ISP_DATA_DIR) : catalogueDir;
export const statePath = path.join(dataDir, "state.json");
export const accountsSnapshotPath = path.join(dataDir, "accounts-snapshot.json");
export const milestonesPath = path.join(catalogueDir, "milestones.json");
export const PASSWORD_SALT_ROUNDS = 10;

// Load station data for body→station mapping
export const STATIONS_RAW = JSON.parse(fs.readFileSync(path.join(catalogueDir, "stations.json"), "utf8"));
export const BODY_TO_STATION = {};
export const STATION_REGISTRY_CACHE = {};
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

export function safeWriteFile(filePath, data) {
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
export const MILESTONES_DATA = JSON.parse(fs.readFileSync(milestonesPath, "utf8"));
export const MILESTONE_LEVELS = MILESTONES_DATA.levels;
// The top of the ladder is the highest level the data defines (Bug #424: the cap shown to players was a literal 40).
export const MAX_DEFINED_LEVEL = Math.max(...MILESTONE_LEVELS.map((l) => l.level));           // [{level, requirements, unlocks}, ...]
export const MILESTONE_ROADMAP = MILESTONES_DATA.roadmap;          // ["Rent an Office", ...]

// ─── CEO Insight programs ────────────────────────────────────────────────────
export const ceoInsightPath = path.join(catalogueDir, "ceo-insight.json");
export const CEO_INSIGHT_DATA = JSON.parse(fs.readFileSync(ceoInsightPath, "utf8"));
export const CEO_INSIGHT_LIBRARY = {};
for (const prog of CEO_INSIGHT_DATA.programs) {
  CEO_INSIGHT_LIBRARY[prog.id] = prog;
}

// ─── Systems: single source of truth from data/systems.json ────────────────
export const SYSTEMS_DATA = JSON.parse(fs.readFileSync(path.join(catalogueDir, "systems.json"), "utf8"));

// ─── Refinery chains ────────────────────────────────────────────────────────
export const refineryChainsPath = path.join(catalogueDir, "refinery-chains.json");
export const REFINERY_CHAINS_DATA = JSON.parse(fs.readFileSync(refineryChainsPath, "utf8"));
export const REFINERY_CHAINS = {};
for (const chain of REFINERY_CHAINS_DATA.chains) {
  REFINERY_CHAINS[chain.id] = chain;
}

// ─── Missions: templates, the agent registry and reputation tiers (AB#1051) ─
export const missionsPath = path.join(catalogueDir, "missions.json");
export const MISSIONS_DATA = JSON.parse(fs.readFileSync(missionsPath, "utf8"));

// Build a lookup from requirement id → display title (for milestonesCompleted tracking)
export const REQ_ID_TO_TITLE = {};
for (const lvl of MILESTONE_LEVELS) {
  for (const req of lvl.requirements) {
    REQ_ID_TO_TITLE[req.id] = req.title;
  }
}

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
/* TODO(AB#804): This should be fetched from systems.json, see SYSTEMS_DATA */
export const SYSTEM_DETAILS = {
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

export const BASE_MAX_PROBES = 2;             // Fleet Cap before Level 1 grants one (Bug #586)
export const FLEET_COORDINATION_TECH = "tt-fleet-coordination";
export const FLEET_COORDINATION_BONUS = 12;   // "+12 fleet cap" (data/research.json)
export function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

/** Get/create station-scoped inventory sub-object for a corp */
export function getStationInventory(corp, stationId) {
  if (!corp.inventory || typeof corp.inventory !== "object") corp.inventory = {};
  if (!corp.inventory[stationId]) corp.inventory[stationId] = {};
  return corp.inventory[stationId];
}

