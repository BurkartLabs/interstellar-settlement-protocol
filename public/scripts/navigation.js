// Which navigation research reaches which system. The one copy of the travel gate: the server's travel route and
// lease check and the browser's starmap all import it (Bug #976: three copies had drifted, and two of them made
// Sol a deep-star system, so a corporation with only Proxima navigation could reach Alpha Centauri and not return).

const NEAR_STAR_SYSTEMS = new Set(["alpha-centauri", "barnards-star"]);
const NEAR_STAR_TECH = "tt-proxima-navigation";
const DEEP_STAR_TECH = "tt-deep-star-navigation";

/** The research a jump to this system needs, or null for Sol, which every corporation can always return to. */
export function researchForSystem(systemId) {
  if (systemId === "sol") return null;
  return NEAR_STAR_SYSTEMS.has(systemId) ? NEAR_STAR_TECH : DEEP_STAR_TECH;
}

// AB#1061: a station's claims office files leases only on the body it orbits (NEW_PLAYER_EXPERIENCE.md): Earth from
// Earth Station Prime, Mars from Mars Orbital Dock. The one copy of that rule: the server's lease route refuses with
// it and the level milestone cards use it to say where to go. `stations` is data/stations.json's list, or the
// server's id-keyed registry of the same objects.
const stationList = (stations) => (Array.isArray(stations) ? stations : Object.values(stations || {}));

/** The station whose claims office files leases on this body, or null when no station orbits it. */
export function leaseStationFor(stations, body) {
  const wanted = String(body || "").toLowerCase();
  return stationList(stations).find((s) => String(s?.body || "").toLowerCase() === wanted) || null;
}

/** Why a lease on `body` cannot be filed from `currentStationId` (null while in transit), or null when it can. */
export function leaseFilingRefusal(stations, currentStationId, body) {
  if (!currentStationId) return "You are in transit. Dock at a station, then file the lease at its ISA Claims & Leases Division.";
  const here = stationList(stations).find((s) => s?.id === currentStationId);
  const office = leaseStationFor(stations, body);
  if (!office) return `No station files mining leases on ${body}.`;
  if (office.id === currentStationId) return null;
  return `Leases on ${office.body} are filed at ${office.name}, the station that orbits it. You are docked at ${here?.name || "another station"}: travel to ${office.name} on the Starmap, then file at its ISA Claims & Leases Division.`;
}

/** Whether a corporation in currentSystemId with this research (a Set or an array) can go to targetSystemId. */
export function canReachSystem(unlockedTech, currentSystemId, targetSystemId) {
  if ((currentSystemId || "sol") === targetSystemId) return true;
  const required = researchForSystem(targetSystemId);
  if (!required) return true;
  const unlocked = unlockedTech instanceof Set ? unlockedTech : new Set(unlockedTech || []);
  return unlocked.has(required);
}
