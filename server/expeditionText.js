// AB#1295: what a returning asteroid expedition tells the player, in the names the game shows everywhere else. The
// notification said "returned from belt" and "deposited at earth-station-prime" (a key's suffix and a station id), and
// the inbox report title-cased ids ("Ac Belt", "Barnards Star"). Names come from the catalogs, never from the ids,
// through the lookups the client shares (AB#1336).
import { STATION_REGISTRY, SYSTEMS_CATALOG } from "./travel.js";
import { beltPhrase, beltPlace, stationName } from "../public/scripts/displayNames.js";

/** The belt, its system and the deposit station, by name. Anything unknown is null rather than an id. */
export function expeditionPlaces(exp) {
  return {
    ...beltPlace(SYSTEMS_CATALOG, exp?.beltKey, exp?.systemId),
    station: stationName(STATION_REGISTRY, exp?.depositStationId)
  };
}

/** The Expedition Complete notification's text. */
export function expeditionNotificationBody(exp) {
  const yieldSummary = Object.entries(exp?.yields || {}).map(([r, q]) => `${q} ${r}`).join(", ") || "no resources";
  const station = stationName(STATION_REGISTRY, exp?.depositStationId) || "your nearest station";
  return `Mining probe has returned from ${beltPhrase(SYSTEMS_CATALOG, exp?.beltKey, exp?.systemId)}. Yields: ${yieldSummary}. Resources deposited at ${station}.`;
}
