// server/travel.js: star systems, stations and travel times, split out of server/index.js (AB#1815).
import fs from "node:fs";
import path from "node:path";
import { NAVIGATION, SYSTEMS_DATA } from "./game/catalog.js";
import { IS_DEV, __dirname } from "./app.js";

// ── Jumps between systems: data/systems.json's routes, through public/scripts/navigation.js (AB#718, AB#804) ──
function getSystemHops(fromId, toId) {
  return NAVIGATION.systemHops(fromId, toId) ?? 99; // unreachable fallback
}

// ── Planet ordering within each system (for intra-system hop distance) ──
// Only planets/fields count as "orbital positions"; moons inherit their parent's index.
const BODY_ORBITAL_INDEX = {}; // bodyName → positional index within its system
const BODY_PARENT = {};        // moonName → parentPlanetName
/** The body catalog. Also what a mining lease is resolved against (server/leases.js, Bug #691). One copy (AB#804). */
const SYSTEMS_CATALOG = SYSTEMS_DATA;
for (const sys of SYSTEMS_CATALOG) {
  let idx = 0;
  for (const b of sys.bodies) {
    if (b.type === "Moon") {
      BODY_PARENT[b.name] = sys.bodies.find(p => p.id === b.parentId)?.name || b.name;
    } else {
      BODY_ORBITAL_INDEX[b.name] = idx;
      idx++;
    }
  }
}

// Travel time in ms between two stations
function getTravelTimeMs(fromId, toId) {
  const from = STATION_REGISTRY[fromId];
  const to = STATION_REGISTRY[toId];
  if (!from || !to) return 0;

  if (IS_DEV) return 5 * 1000; // 5 seconds in dev

  // Same body: 1 minute
  if (from.body === to.body) return 1 * 60 * 1000;

  // Resolve to parent planet if the body is a moon
  const fromPlanet = BODY_PARENT[from.body] || from.body;
  const toPlanet = BODY_PARENT[to.body] || to.body;

  if (from.systemId === to.systemId) {
    // Planet ↔ its own moon: 3 minutes
    if (fromPlanet === to.body || toPlanet === from.body || fromPlanet === toPlanet) {
      // One is a moon of the other, or both orbit the same planet
      const isMoonHop = (from.body !== fromPlanet || to.body !== toPlanet);
      if (isMoonHop && fromPlanet === toPlanet) return 3 * 60 * 1000;
    }

    // Different planets in the same system: 10 min base + 5 min per extra hop
    const fromIdx = BODY_ORBITAL_INDEX[fromPlanet];
    const toIdx = BODY_ORBITAL_INDEX[toPlanet];
    if (fromIdx !== undefined && toIdx !== undefined) {
      const hops = Math.abs(toIdx - fromIdx);
      return (10 + hops * 5) * 60 * 1000; // 10 + 5n minutes
    }
    return 10 * 60 * 1000; // fallback
  }

  // Different systems: 1 hr per hop along the adjacency graph
  const hops = getSystemHops(from.systemId, to.systemId);
  return Math.max(1, hops) * 60 * 60 * 1000;
}

/** ISP-117 (AB#809): an interstellar jump takes an hour a hop along the catalog's adjacency, never less than one. */
function interstellarTravelMs(hops) {
  return Math.max(1, Number(hops) || 0) * 60 * 60 * 1000;
}

// Interstellar travel time (system-to-system, no station context)
function getInterstellarTravelTimeMs(fromSystemId, toSystemId) {
  if (IS_DEV) return 5 * 1000;
  // No route is refused by the travel route, except home to Sol (Bug #976): that trip counts as one hop, not 99.
  return interstellarTravelMs(NAVIGATION.systemHops(fromSystemId, toSystemId) ?? 1);
}

// ─── Station & Travel constants ──────────────────────────────────────────────
const STATIONS_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "stations.json"), "utf8"));
const STATION_REGISTRY = {};
for (const s of STATIONS_DATA.stations) {
  STATION_REGISTRY[s.id] = s;
}

export { STATION_REGISTRY, SYSTEMS_CATALOG, STATIONS_DATA, getInterstellarTravelTimeMs, getTravelTimeMs, interstellarTravelMs };
