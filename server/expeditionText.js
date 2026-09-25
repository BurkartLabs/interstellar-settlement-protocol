// AB#1295: what a returning asteroid expedition tells the player, in the names the game shows everywhere else. The
// notification said "returned from belt" and "deposited at earth-station-prime" (a key's suffix and a station id), and
// the inbox report title-cased ids ("Ac Belt", "Barnards Star"). Names come from the catalogs, never from the ids.
import { STATION_REGISTRY, SYSTEMS_CATALOG } from "./travel.js";

/** The belt, its system and the deposit station, by name. Anything unknown is null rather than an id. */
export function expeditionPlaces(exp) {
  const [keySystemId, beltId] = String(exp?.beltKey || "").split(":");
  const system = SYSTEMS_CATALOG.find((s) => s.id === (exp?.systemId || keySystemId));
  const belt = (system?.bodies || []).find((b) => b.id === beltId && b.type === "Field");
  return {
    belt: belt?.name || null,
    system: system?.name || null,
    station: STATION_REGISTRY[exp?.depositStationId]?.name || null
  };
}

/** The Expedition Complete notification's text. */
export function expeditionNotificationBody(exp) {
  const places = expeditionPlaces(exp);
  const from = places.belt ? `the ${places.belt}${places.system ? ` (${places.system})` : ""}` : "an asteroid belt";
  const yieldSummary = Object.entries(exp?.yields || {}).map(([r, q]) => `${q} ${r}`).join(", ") || "no resources";
  return `Mining probe has returned from ${from}. Yields: ${yieldSummary}. Resources deposited at ${places.station || "your nearest station"}.`;
}
