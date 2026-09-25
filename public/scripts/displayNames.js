// AB#1336: the names a player reads for systems, stations and belts, from the catalogs (data/systems.json,
// data/stations.json). Shared by the server and the client. Messages were built from ids ("deployed to belt",
// "(Mars, SOL)", "the Barnards Star system"). An unknown id is null, never the id, so a caller chooses the words.

/** A system's name, from the systems catalog (an array of { id, name, bodies }). */
export function systemName(systems, systemId) {
  return (Array.isArray(systems) ? systems : []).find((s) => s.id === systemId)?.name || null;
}

/** A station's name, from a list of stations or a registry keyed by id. */
export function stationName(stations, stationId) {
  if (!stations || !stationId) return null;
  const station = Array.isArray(stations) ? stations.find((s) => s.id === stationId) : stations[stationId];
  return station?.name || null;
}

/** An asteroid belt's name and its system's, from a belt key ("alpha-centauri:ac-belt"). */
export function beltPlace(systems, beltKey, systemId = null) {
  const [keySystemId, beltId] = String(beltKey || "").split(":");
  const system = (Array.isArray(systems) ? systems : []).find((s) => s.id === (systemId || keySystemId));
  const belt = (system?.bodies || []).find((b) => b.id === beltId && b.type === "Field");
  return { belt: belt?.name || null, system: system?.name || null };
}

/** "the Asteroid Belt (Sol)", or "an asteroid belt" when the belt is not in the catalog. */
export function beltPhrase(systems, beltKey, systemId = null) {
  const place = beltPlace(systems, beltKey, systemId);
  if (!place.belt) return "an asteroid belt";
  return `the ${place.belt}${place.system ? ` (${place.system})` : ""}`;
}
