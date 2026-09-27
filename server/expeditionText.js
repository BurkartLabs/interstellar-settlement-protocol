// AB#1295: what a returning asteroid expedition tells the player, in the names the game shows everywhere else. The
// notification said "returned from belt" and "deposited at earth-station-prime" (a key's suffix and a station id), and
// the inbox report title-cased ids ("Ac Belt", "Barnards Star"). Names come from the catalogs, never from the ids,
// through the lookups the client shares (AB#1336).
import { SYSTEMS_CATALOG } from "./travel.js";
import { stationMap } from "./game/stations.js"; // ISP-209 (AB#904)
import { beltPhrase, beltPlace, stationName } from "../public/scripts/displayNames.js";
import { ECONOMY } from "./economy.js";
import { nextBeltDrawAt } from "./game/belts.js"; // AB#2330
import { UNITS } from "./game/units.js"; // AB#820: escort losses by name

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
  const rats = expeditionRatsText(exp); // AB#820
  return `Mining probe has returned from ${beltPhrase(SYSTEMS_CATALOG, exp?.beltKey, exp?.systemId)}. Yields: ${yieldSummary}.${ferric} Resources deposited at ${station}.${early}${rats ? ` ${rats}` : ""}`;
}

/**
 * AB#820 (docs/design/rats.md): what the Rats did to this expedition, in one or two sentences, or "" for an expedition
 * launched before Rats. The escort's losses by unit name; the haul lost in units.
 */
export function expeditionRatsText(exp) {
  const r = exp?.rats;
  if (!r || !Array.isArray(r.encounters)) return "";
  const met = r.encounters.length;
  if (!met) return r.escortFleetId ? "No Rats were met; the escort returns unharmed." : "No Rats were met.";
  const times = met === 1 ? "once" : met === 2 ? "twice" : `${met} times`;
  const lost = {};
  let haul = 0;
  for (const e of r.encounters) {
    for (const [id, n] of Object.entries(e.escort?.lost || {})) lost[id] = (lost[id] || 0) + n;
    haul += Object.values(e.haulLost || {}).reduce((s, n) => s + n, 0);
  }
  // troops' names are already plural: "2 squads of Attack Troops", as the Fleet tab says it
  const named = (id, n) => (UNITS[id]?.role === "troop" || id === "at" || id === "dt" ? `${n} squad${n === 1 ? "" : "s"} of ${UNITS[id]?.name || id}` : `${n} ${UNITS[id]?.name || id}${n === 1 ? "" : "s"}`);
  const unitWords = Object.entries(lost).map(([id, n]) => named(id, n)).join(", ");
  const fought = r.encounters.filter((e) => e.escort).length;
  const escort = !r.escortFleetId ? ""
    : r.escortBeaten ? ` The escort was beaten${unitWords ? `, losing ${unitWords}` : ""}.`
      : ` The escort held ${fought === 1 ? "the fight" : `all ${fought} fights`}${unitWords ? `, losing ${unitWords}` : " without a loss"}.`;
  const taken = haul ? ` Rats took ${haul.toLocaleString("en-US")} units of the haul.` : " The haul is intact.";
  return `Met Rats ${times}.${escort}${taken}`;
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
