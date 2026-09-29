// server/telemetry.js (ISP-256, AB#952): the minimum telemetry process/TELEMETRY.md requires before a product leaves
// Preview, stored here, on the game's own server and data volume: no third-party processor (that choice is Decision
// D-1.0-1's). What is kept, and nothing else:
//   { at, event, distinct_id, session_id, app_version, platform, props }
// `at` is the server's clock. `distinct_id` is a random id the browser keeps for itself (public/scripts/telemetry.js):
// never the account id, the email or the address a request came from. No IP address, user agent or account is stored.
// Only the events below, with exactly their properties and types, are accepted; anything else is dropped whole, never
// stored raw. One file a day, <dataDir>/telemetry/YYYY-MM-DD.jsonl, deleted after RETENTION_DAYS.
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./game/catalog.js";

export const RETENTION_DAYS = 90;
export const MAX_EVENTS_PER_REQUEST = 20;
const DAY = 86_400_000;

const str = (max) => (v) => typeof v === "string" && v.length > 0 && v.length <= max;
const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const ID = /^[0-9a-f]{32}$/;

/** Each event TELEMETRY.md names, with its properties and their types (rank_up is the game's named verb for a level). */
export const TELEMETRY_EVENTS = Object.freeze({
  app_open: { source: str(40) },
  verb_first: { latency_ms: int(0, 7 * DAY) },
  verb_repeat: { count_in_session: int(1, 100_000) },
  session_end: { duration_s: int(0, 7 * 86_400), actions: int(0, 100_000) },
  error: { message: str(300), hash: (v) => typeof v === "string" && /^[0-9a-f]{8}$/.test(v) },
  funnel_step: { step: (v) => typeof v === "string" && /^[a-z][a-z0-9_-]{0,39}$/.test(v) },
  rank_up: { level: int(1, 999) }
});
export const PLATFORMS = Object.freeze(["web-desktop", "web-mobile"]);

/**
 * The stored row for one event as the browser sent it, or null to drop it. Strict: a known name, the identity fields
 * well formed, and exactly the event's own properties, each of its type. Nothing unknown is copied through.
 */
export function telemetryRow(input, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const spec = Object.hasOwn(TELEMETRY_EVENTS, input.event) ? TELEMETRY_EVENTS[input.event] : null;
  if (!spec) return null;
  if (!ID.test(String(input.distinct_id)) || !ID.test(String(input.session_id))) return null;
  if (!/^[0-9A-Za-z.+-]{1,20}$/.test(String(input.app_version ?? ""))) return null;
  if (!PLATFORMS.includes(input.platform)) return null;
  const props = input.props && typeof input.props === "object" && !Array.isArray(input.props) ? input.props : null;
  if (!props) return null;
  const keys = Object.keys(props);
  if (keys.length !== Object.keys(spec).length || !keys.every((k) => Object.hasOwn(spec, k) && spec[k](props[k]))) return null;
  return {
    at: now,
    event: input.event,
    distinct_id: input.distinct_id,
    session_id: input.session_id,
    app_version: input.app_version,
    platform: input.platform,
    props: Object.fromEntries(Object.keys(spec).map((k) => [k, props[k]]))
  };
}

export const telemetryDir = (dir = dataDir) => path.join(dir, "telemetry");
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

let lastPrunedDay = null;
/** Delete the day files older than RETENTION_DAYS. Run at most once a day, from recordTelemetry. */
export function pruneTelemetry(now = Date.now(), dir = dataDir) {
  const folder = telemetryDir(dir);
  const oldest = dayOf(now - RETENTION_DAYS * DAY);
  let removed = 0;
  let files = [];
  try { files = fs.readdirSync(folder); } catch { return 0; }
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (m && m[1] < oldest) { try { fs.unlinkSync(path.join(folder, f)); removed += 1; } catch { /* next day */ } }
  }
  return removed;
}

/**
 * Store a request's events: each valid one appended to today's file, each invalid one dropped. Returns
 * { accepted, dropped }. A store that cannot be written throws; the route answers 503 and nothing is half-kept.
 */
export function recordTelemetry(events, { now = Date.now(), dir = dataDir } = {}) {
  const rows = [];
  let dropped = 0;
  for (const e of events) {
    const row = telemetryRow(e, now);
    if (row) rows.push(row);
    else dropped += 1;
  }
  if (rows.length) {
    const folder = telemetryDir(dir);
    fs.mkdirSync(folder, { recursive: true });
    fs.appendFileSync(path.join(folder, `${dayOf(now)}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  if (lastPrunedDay !== dayOf(now)) { lastPrunedDay = dayOf(now); pruneTelemetry(now, dir); }
  return { accepted: rows.length, dropped };
}

/** Test hook: forget when the store was last pruned. */
export function resetTelemetryPrune() { lastPrunedDay = null; }
