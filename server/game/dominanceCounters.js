// server/game/dominanceCounters.js: the two daily counters the dominance metric reads (ISP-217, AB#912;
// docs/design/CONGLOMERATES.md, "The dominance metric"): tonnes a corporation extracted in each system, and credits of
// its sales settled at each station, per UTC day, kept for dominanceWindowDays and nothing older.
//
// They are written where the work already settles (a mining span's deposit, an expedition's haul, a sale's payment) and
// kept on the corporation itself (corp.dominance), so the writers need no global state. Only the daily computation
// (server/game/dominance.js) reads them, and it publishes rounded shares, never these figures.

import { CONGLOMERATE_CATALOG } from "../conglomerates.js";
import { SYSTEMS_DATA } from "./catalog.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const dayKeyOf = (t) => Math.floor(Number(t) / DAY_MS) * DAY_MS;

/** A body's system id, by the body's id or its name ("Earth", as a lease names it); null for an unknown body. */
const SYSTEM_OF_BODY = new Map(SYSTEMS_DATA.flatMap((s) => (s.bodies || []).flatMap((b) => [[b.id, s.id], [b.name, s.id], [String(b.name).toLowerCase(), s.id]])));
export function systemOfBody(body) {
  if (typeof body !== "string" || !body) return null;
  return SYSTEM_OF_BODY.get(body) ?? SYSTEM_OF_BODY.get(body.toLowerCase()) ?? null;
}

/** The corporation's counters, with every day older than the window removed. */
function book(corp, at, days = CONGLOMERATE_CATALOG.dominanceWindowDays) {
  if (!corp.dominance || typeof corp.dominance !== "object") corp.dominance = {};
  const d = corp.dominance;
  if (!d.extraction || typeof d.extraction !== "object") d.extraction = {};
  if (!d.sales || typeof d.sales !== "object") d.sales = {};
  const oldest = dayKeyOf(at) - days * DAY_MS;
  for (const kind of ["extraction", "sales"]) for (const day of Object.keys(d[kind])) if (Number(day) < oldest) delete d[kind][day];
  return d;
}

/** Count `tonnes` extracted by `corp` in `systemId` on `at`'s UTC day. */
export function recordExtraction(corp, systemId, tonnes, at = Date.now()) {
  const n = Math.floor(Number(tonnes) || 0);
  if (!corp || !systemId || n <= 0) return;
  const day = (book(corp, at).extraction[dayKeyOf(at)] ||= {});
  day[systemId] = (day[systemId] || 0) + n;
}

/** Count `credits` of a sale by `corp` settled at `stationId` on `at`'s UTC day. */
export function recordSale(corp, stationId, credits, at = Date.now()) {
  const n = Math.floor(Number(credits) || 0);
  if (!corp || !stationId || n <= 0) return;
  const day = (book(corp, at).sales[dayKeyOf(at)] ||= {});
  day[stationId] = (day[stationId] || 0) + n;
}

/** Whether two corporations are in one conglomerate now: a sale between them buys no dominance. */
export function sameConglomerate(a, b) {
  return Boolean(a?.conglomerateId && b?.conglomerateId && a.conglomerateId === b.conglomerateId);
}
