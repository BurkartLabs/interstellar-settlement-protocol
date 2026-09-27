// AB#1295: what a returning asteroid expedition tells the player, in the names the game shows everywhere else. The
// notification said "returned from belt" and "deposited at earth-station-prime" (a key's suffix and a station id), and
// the inbox report title-cased ids ("Ac Belt", "Barnards Star"). Names come from the catalogs, never from the ids,
// through the lookups the client shares (AB#1336).
import { SYSTEMS_CATALOG } from "./travel.js";
import { stationMap } from "./game/stations.js"; // ISP-209 (AB#904)
import { beltPhrase, beltPlace, stationName } from "../public/scripts/displayNames.js";
import { ECONOMY } from "./economy.js";
import { nextBeltDrawAt } from "./game/belts.js"; // AB#2330

/** The belt, its system and the deposit station, by name. Anything unknown is null rather than an id. */
export function expeditionPlaces(exp) {
  return {
    ...beltPlace(SYSTEMS_CATALOG, exp?.beltKey, exp?.systemId),
    station: stationName(stationMap(), exp?.depositStationId)
  };
}

/** The Expedition Complete notification's text. */
export function expeditionNotificationBody(exp) {
  const yieldSummary = Object.entries(exp?.yields || {}).map(([r, q]) => `${q} ${r}`).join(", ") || "no resources";
  const station = stationName(stationMap(), exp?.depositStationId) || "your nearest station";
  // ISP-96 (AB#786): what the Ferric Mining Complex added, already counted in the yields above.
  const bonus = Object.entries(exp?.ferricBonus || {}).map(([r, q]) => `${q} ${r}`).join(" and ");
  const ferric = bonus ? ` Your Ferric Mining Complex added ${bonus}.` : "";
  const early = exp?.endedEarly ? ` ${expeditionEndedEarlyText(exp)}` : ""; // AB#2330
  return `Mining probe has returned from ${beltPhrase(SYSTEMS_CATALOG, exp?.beltKey, exp?.systemId)}. Yields: ${yieldSummary}.${ferric} Resources deposited at ${station}.${early}`;
}

/** AB#2330: how many minutes before its scheduled return an expedition came home, at least 1. */
export function minutesEarly(exp) {
  const early = exp?.endedEarly;
  return early ? Math.max(1, Math.ceil((Number(early.scheduledAt) - Number(early.at)) / 60_000)) : 0;
}

/** AB#2330: why an expedition came home early, or "" for one that ran its course. */
export function expeditionEndedEarlyText(exp) {
  const m = minutesEarly(exp);
  if (!m) return "";
  return `The belt was mined out, so the probe came home ${m} minute${m === 1 ? "" : "s"} early. The launch fee is not refunded.`;
}

/** AB#2330: why a mined-out belt cannot be scouted or mined, and when it next may come back (UTC, on the hour). */
export function emptyBeltMessage(belt) {
  const at = new Date(nextBeltDrawAt(belt) || Date.now());
  const hour = `${String(at.getUTCHours()).padStart(2, "0")}:00 UTC`;
  const pct = Math.round(ECONOMY.belts.respawnChancePerHour * 100);
  return `This belt has been mined out. An empty belt has a ${pct}% chance of forming anew each hour on the hour; the next chance is at ${hour}.`;
}
