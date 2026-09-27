// server/game/stations.js: the station registry (ISP-209, AB#904). The only module that reads data/stations.json.
//
// Two kinds of station, behind one lookup:
// - the catalog, data/stations.json: the NPC stations, shipped with the code, owned by nobody (`"owner": "npc"`);
// - stations built in play (conglomerate stations, docs/design/CONGLOMERATES.md Part 2), persisted to
//   <ISP_DATA_DIR>/stations-built.json. ISP-210 (AB#905) is what creates them, through addStation.
// Every station lookup goes through allStations, stationById or stationAtBody, so a built station is everywhere a
// catalog one is (P-HALF-FIX); tests/unit/stationRegistry.test.js fails if a server file reads the catalog itself.
// In memory every station's owner is `{ type: "npc" | "conglomerate", id }`; the catalog file keeps its "npc".
// Fails closed: an unreadable or invalid built-stations file stops the server, rather than starting it without them.
import fs from "node:fs";
import path from "node:path";
import { SYSTEMS_BY_ID, catalogueDir, dataDir, safeWriteFile } from "./catalog.js";

/**
 * ISP-118 (AB#810): who holds a station. "neutral" is a station no corporation owns, open to every corporation to dock
 * and rent an office; "conglomerate" is one a conglomerate built (CONGLOMERATES.md Part 2). The server does not start
 * with a station whose jurisdiction is missing or unknown (tests/schema/data-files.test.js).
 */
export const STATION_JURISDICTIONS = Object.freeze(["neutral", "conglomerate"]);
export const OWNER_TYPES = Object.freeze(["npc", "conglomerate"]);
/** Each station in `stations` without a known jurisdiction, as "id: what it has". */
export function stationJurisdictionProblems(stations) {
  return (stations || []).filter((s) => !STATION_JURISDICTIONS.includes(s?.jurisdiction))
    .map((s) => `${s?.id ?? "a station with no id"}: ${JSON.stringify(s?.jurisdiction ?? null)}`);
}

const CATALOG = JSON.parse(fs.readFileSync(path.join(catalogueDir, "stations.json"), "utf8")).stations;
{
  const problems = [...stationJurisdictionProblems(CATALOG), ...CATALOG.filter((s) => s.jurisdiction !== "neutral").map((s) => `${s.id}: a catalog station is neutral`)];
  if (problems.length) throw new Error(`data/stations.json: every station needs a jurisdiction, one of ${STATION_JURISDICTIONS.join(", ")} (AB#810): ${problems.join("; ")}.`);
}
const withOwner = (s) => ({ ...s, owner: { type: "npc", id: null } });
const STATIC = Object.freeze(CATALOG.map((s) => Object.freeze(withOwner(s))));
const STATIC_IDS = new Set(STATIC.map((s) => s.id));

export const builtStationsPath = (dir = dataDir) => path.join(dir, "stations-built.json");
let built = [];
let byId = new Map();
let byBody = new Map();
function index() {
  byId = new Map([...STATIC, ...built].map((s) => [s.id, s]));
  byBody = new Map([...STATIC, ...built].map((s) => [s.body, s]));
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 '.-]{2,47}$/;
/**
 * Why `input` cannot be a built station beside `others`, or null. Only a conglomerate builds one: the NPC stations are
 * the catalog. The id may not be a catalog station's or another built one's; the system must be one the game has, and
 * the body one of that system's, with no station at it yet (one station per body: stationAtBody answers with one).
 */
export function builtStationProblem(input, others = built) {
  const s = input && typeof input === "object" ? input : {};
  if (typeof s.id !== "string" || !ID.test(s.id)) return "a station id is lower-case words joined by hyphens";
  if (STATIC_IDS.has(s.id)) return `${s.id} is a catalog station's id`;
  if (others.some((o) => o.id === s.id)) return `${s.id} is already a station`;
  if (typeof s.name !== "string" || !NAME.test(s.name)) return "a station name is 3 to 48 letters, digits, spaces, apostrophes, dots or hyphens";
  const system = typeof s.systemId === "string" ? SYSTEMS_BY_ID.get(s.systemId) : null;
  if (!system) return `no system ${JSON.stringify(s.systemId ?? null)}`;
  if (typeof s.body !== "string" || !(system.bodies || []).some((b) => b.name === s.body)) return `no body ${JSON.stringify(s.body ?? null)} in ${system.name}`;
  if ([...STATIC, ...others].some((o) => o.body === s.body)) return `${s.body} already has a station`;
  if (s.owner?.type !== "conglomerate" || typeof s.owner.id !== "string" || !s.owner.id) return "a built station is a conglomerate's";
  if (s.jurisdiction !== "conglomerate") return "a built station's jurisdiction is conglomerate";
  return null;
}

/** Read the built stations from `dir`; throws on anything unreadable or invalid (the server must not start). */
export function loadBuiltStations(dir = dataDir) {
  const file = builtStationsPath(dir);
  if (!fs.existsSync(file)) return [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: the built stations cannot be read (${error.message}); the server will not start without them.`);
  }
  if (!Array.isArray(doc?.stations)) throw new Error(`${file}: no "stations" list; the server will not start without it.`);
  const out = [];
  for (const s of doc.stations) {
    const problem = builtStationProblem(s, out);
    if (problem) throw new Error(`${file}: ${problem}; the server will not start with an invalid station.`);
    out.push(Object.freeze({ ...s, owner: Object.freeze({ ...s.owner }), buildingIds: Object.freeze([...(s.buildingIds || [])]) }));
  }
  return out;
}

/** Load (or reload, for a test's restart) the built stations from `dir`. */
export function reloadStations(dir = dataDir) {
  built = loadBuiltStations(dir);
  index();
}
reloadStations();

/** Every station, the catalog first and then those built in play, oldest first. */
export function allStations() {
  return [...STATIC, ...built];
}
/** The station with this id, or null. */
export function stationById(id) {
  return (typeof id === "string" && byId.get(id)) || null;
}
/** The station at this body (by the body's name, as a lease stores it), or null. */
export function stationAtBody(body) {
  return (typeof body === "string" && byBody.get(body)) || null;
}
/** Every station keyed by id, for code that takes a map; a fresh object each call. */
export function stationMap() {
  return Object.fromEntries(allStations().map((s) => [s.id, s]));
}
/** Only the NPC catalog: what a data file (the conglomerate catalog) may name, because it cannot name a built one. */
export function catalogStations() {
  return STATIC;
}

/**
 * Add a station built in play and persist it before it is visible. `{ id, name, systemId, body, owner: { type:
 * "conglomerate", id } }`, with a tier (default 3, CONGLOMERATES.md) and a designation of its own if none is given.
 */
export function addStation(input, dir = dataDir) {
  const station = {
    designation: null, tier: 3, description: "", buildingIds: [], ...input,
    jurisdiction: "conglomerate", owner: input?.owner && typeof input.owner === "object" ? { type: input.owner.type, id: input.owner.id } : input?.owner
  };
  const problem = builtStationProblem(station);
  if (problem) return { ok: false, error: problem };
  if (!station.designation) station.designation = `${station.systemId.toUpperCase()}-CGL-${String(built.length + 1).padStart(3, "0")}`;
  const next = [...built, Object.freeze({ ...station, owner: Object.freeze(station.owner), buildingIds: Object.freeze([...station.buildingIds]) })];
  try {
    safeWriteFile(builtStationsPath(dir), JSON.stringify({ stations: next }, null, 2));
  } catch {
    return { ok: false, error: "the station could not be saved" }; // not saved, so not added
  }
  built = next;
  index();
  return { ok: true, station: next.at(-1) };
}

/**
 * A station as GET /api/stations sends it: everything the catalog shows, and its owner as a type and a public name only
 * (`ownerName` from `conglomerateName(id)`; null for an NPC station). No owner id leaves the server.
 */
export function publicStation(station, conglomerateName = () => null) {
  const { owner, ...rest } = station;
  return { ...rest, ownerType: owner.type, ownerName: owner.type === "conglomerate" ? conglomerateName(owner.id) || "A conglomerate" : null };
}
