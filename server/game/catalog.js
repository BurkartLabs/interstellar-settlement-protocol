// server/game/catalog.js: part of the game state, split out of server/gameState.js by system (AB#737).

import "../loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { navigationFor } from "../../public/scripts/navigation.js";
import { ITEMS } from "./items.js"; // ISP-130 (AB#824): the item catalog; the server does not start while a data file names an item it lacks

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
/**
 * ISP-118 (AB#810): who holds a station. "neutral" is a station no corporation owns, open to every corporation to dock
 * and rent an office; v0.12's conglomerate-owned stations will add their own value here. The server does not start
 * with a station whose jurisdiction is missing or unknown (tests/schema/data-files.test.js).
 */
export const STATION_JURISDICTIONS = Object.freeze(["neutral"]);
/** Each station in `stations` without a known jurisdiction, as "id: what it has". */
export function stationJurisdictionProblems(stations) {
  return (stations || []).filter((s) => !STATION_JURISDICTIONS.includes(s?.jurisdiction))
    .map((s) => `${s?.id ?? "a station with no id"}: ${JSON.stringify(s?.jurisdiction ?? null)}`);
}
{
  const problems = stationJurisdictionProblems(STATIONS_RAW.stations);
  if (problems.length) throw new Error(`data/stations.json: every station needs a jurisdiction, one of ${STATION_JURISDICTIONS.join(", ")} (AB#810): ${problems.join("; ")}.`);
}
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

/**
 * ISP-104 (AB#796): the only keys a level's `unlocks` may name. Each has its applier in server/game/progression.js
 * (UNLOCK_APPLIERS), which refuses to load if the two lists differ. A key not listed here used to be ignored in
 * silence (AB#586's probe cap came apart from Fleet Cap that way): a reward the player earned and never got. Now the
 * server does not start with one, and tests/schema/milestones-unlocks.test.js fails.
 */
export const LEVEL_UNLOCK_KEYS = Object.freeze(["employeeCap", "buildingSlots", "maxFleetSize", "maxUpgradeTier", "marketSectors", "maxDeployments"]);

/** Every unlock key in `levels` that is not allowed, as "level N: key". */
export function unknownUnlockKeys(levels) {
  return (levels || []).flatMap((l) => Object.keys(l?.unlocks || {}).filter((k) => !LEVEL_UNLOCK_KEYS.includes(k)).map((k) => `level ${l?.level}: ${k}`));
}
{
  const unknown = unknownUnlockKeys(MILESTONE_LEVELS);
  if (unknown.length) throw new Error(`data/milestones.json names unlock keys nothing applies (AB#796): ${unknown.join(", ")}. Add each to LEVEL_UNLOCK_KEYS and its applier, or remove it.`);
}
// The top of the ladder is the highest level the data defines (Bug #424: the cap shown to players was a literal 40).
export const MAX_DEFINED_LEVEL = Math.max(...MILESTONE_LEVELS.map((l) => l.level));           // [{level, requirements, unlocks}, ...]
/**
 * ISP-106 (AB#798): the roadmap the sidebar lists, derived from `levels`: each level's requirement titles in order,
 * then "Reached Corporation Level N". It was a hand-written array in data/milestones.json (and a third copy in
 * public/scripts/views/chrome.js) that repeated levels 1 to 10 and drifted: from level 6 on it named an old plan
 * (Ferric and Refinery Complexes, cryo-vapor, belt mining) that no level requires. These are the same strings
 * evaluateLevelProgress records in milestonesCompleted, so an item is marked done exactly when it is.
 */
export function deriveRoadmap(levels) {
  return [...(levels || [])].sort((a, b) => a.level - b.level).flatMap((l) => [...(l.requirements || []).map((r) => r.title), `Reached Corporation Level ${l.level}`]);
}
export const MILESTONE_ROADMAP = Object.freeze(deriveRoadmap(MILESTONE_LEVELS));

// ─── CEO Insight programs ────────────────────────────────────────────────────
export const ceoInsightPath = path.join(catalogueDir, "ceo-insight.json");
export const CEO_INSIGHT_DATA = JSON.parse(fs.readFileSync(ceoInsightPath, "utf8"));
export const CEO_INSIGHT_LIBRARY = {};
for (const prog of CEO_INSIGHT_DATA.programs) {
  CEO_INSIGHT_LIBRARY[prog.id] = prog;
}

// ─── Research tree: single source of truth from data/research.json (AB#1049) ─
// Used to be redefined by hand in server/index.js (RESEARCH_LIBRARY) and public/scripts/app.js (techTree);
// data/research.json's schema test already validated it and nothing loaded it. Now this is the only copy the
// server keys by id, and GET /api/research (server/index.js) is how the client gets the same tree.
export const researchPath = path.join(catalogueDir, "research.json");
export const RESEARCH_DATA = JSON.parse(fs.readFileSync(researchPath, "utf8"));
export const RESEARCH_LIBRARY = {};
for (const node of RESEARCH_DATA.nodes) {
  RESEARCH_LIBRARY[node.id] = node;
}

// ─── Systems: single source of truth from data/systems.json ────────────────
const deepFreeze = (value) => {
  if (value && typeof value === "object") { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); }
  return value;
};
/** The systems catalog, frozen: nothing at run time changes a system's facts (ISP-112, AB#804). */
export const SYSTEMS_DATA = deepFreeze(JSON.parse(fs.readFileSync(path.join(catalogueDir, "systems.json"), "utf8")));
/** ISP-112 (AB#804): each system by id, for its bodies, owner rule, rarity, routes and access research. */
export const SYSTEMS_BY_ID = new Map(SYSTEMS_DATA.map((s) => [s.id, s]));
/**
 * AB#828: what an extractor on a body yields, as { item, concentration } adding to 1 (data/systems.json
 * resourceProfile, AB#826). Keyed by the body's name, which is what a lease stores (names are unique across the
 * catalog). A lease on a body the catalog no longer has (Bug #691 keeps them) mines Silicates, as every lease did.
 */
const BODY_RESOURCE_PROFILES = new Map(SYSTEMS_DATA.flatMap((s) => (s.bodies || [])
  .filter((b) => Array.isArray(b.resourceProfile) && b.resourceProfile.length)
  .map((b) => [b.name, b.resourceProfile])));
const LEGACY_PROFILE = Object.freeze([Object.freeze({ item: "Silicates", concentration: 1 })]);
export function bodyResourceProfile(bodyName) {
  return BODY_RESOURCE_PROFILES.get(bodyName) || LEGACY_PROFILE;
}
/** ISP-112 (AB#804): the travel gate and the jump routes over the catalog (public/scripts/navigation.js). */
export const NAVIGATION = navigationFor(SYSTEMS_DATA);

// ─── Refinery chains ────────────────────────────────────────────────────────
export const refineryChainsPath = path.join(catalogueDir, "refinery-chains.json");
export const REFINERY_CHAINS_DATA = JSON.parse(fs.readFileSync(refineryChainsPath, "utf8"));
/** ISP-106 (AB#798): the raw resources, each countable as mined for totalMined:<resource>. */
// AB#828: what can be mined is every raw item in the item catalog (AB#824), so a body whose profile yields Deuterium,
// Iron Ore or Bauxite (AB#826) counts it towards totalMined:<item>. What can be listed on the exchange is still the
// refinery file's own list; making the new raws tradeable is its own story.
export const MINEABLE_RESOURCES = Object.freeze(ITEMS.filter((item) => item.category === "raw").map((item) => item.name));
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

export const BASE_MAX_PROBES = 2;             // Fleet Cap before Level 1 grants one (Bug #586)
export const BASE_MAX_DEPLOYMENTS = 1;        // concurrent expedition slots before a level's maxDeployments (AB#2307)
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

