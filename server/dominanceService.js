// server/dominanceService.js: the dominance cache and its daily computation (ISP-217, AB#912). The metric is
// server/game/dominance.js; this runs it, keeps the last good result and serves it.
//
// The result holds every corporation's own components, so it lives in its own file in the data directory
// (dominance.json) and never in the global state, which is sent to every client (server/realtime.js). It is computed at
// the first tick after 00:00 UTC (a one-minute ticker, server/index.js) and at the first read after a start without a
// cached day. Fails closed: when a computation throws, the last good result stays, with its own computedAt, and the
// failure is logged; nothing partial is ever served.

import fs from "node:fs";
import path from "node:path";
import { computeDominance } from "./game/dominance.js";
import { dayKeyOf } from "./game/dominanceCounters.js";
import { dataDir, safeWriteFile } from "./game/catalog.js";
import { accountsStore } from "./game/store.js";
import { recordControlDay } from "./controlService.js"; // ISP-226 (AB#921): each day's control readings

const FILE = path.join(dataDir, "dominance.json");
let cache = readCache();
let lastError = null;

function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && typeof parsed === "object" && parsed.systems ? parsed : null;
  } catch {
    return null;
  }
}

/** Compute if today's (UTC) result is missing. Returns what it did: "computed", "cached" or "failed". */
export function dominanceTick(now = Date.now(), compute = computeDominance) {
  if (cache && dayKeyOf(cache.computedAt) === dayKeyOf(now)) return "cached";
  try {
    const started = Date.now();
    const result = compute({ accounts: Object.values(accountsStore.accounts || {}), conglomerates: accountsStore.conglomerates || [] }, now);
    if (!result?.systems) throw new Error("the computation returned no systems");
    cache = { ...result, durationMs: Date.now() - started };
    lastError = null;
    safeWriteFile(FILE, JSON.stringify(cache));
    recordControlDay(cache); // ISP-226 (AB#921)
    return "computed";
  } catch (error) {
    lastError = { at: now, message: String(error?.message || error) };
    console.error("[dominance] the computation failed; the last good result stays:", lastError.message);
    return "failed";
  }
}

/** The public reading: per system, the top three by corporation and by conglomerate, rounded, and "others". */
export function publicDominance(systemId = null, now = Date.now()) {
  if (!cache) dominanceTick(now);
  if (!cache) return { computedAt: null, window: null, systems: {} };
  const systems = systemId ? (cache.systems[systemId] ? { [systemId]: cache.systems[systemId] } : {}) : cache.systems;
  return { computedAt: cache.computedAt, window: cache.window, stale: dayKeyOf(cache.computedAt) !== dayKeyOf(now), systems };
}

/** A corporation's own components per system, and its conglomerate's summed, as percentages to one decimal. */
export function ownDominance(publicId, now = Date.now()) {
  if (!cache) dominanceTick(now);
  const pct = (v) => Math.round(Number(v) * 1000) / 10;
  const shape = (p) => ({ leases: pct(p.leases), extraction: pct(p.extraction), sales: pct(p.sales), dominance: pct(p.dominance) });
  const mine = cache?.private?.[publicId] || {};
  return {
    computedAt: cache?.computedAt ?? null,
    systems: Object.fromEntries(Object.entries(mine).map(([systemId, p]) => [systemId, { corporation: shape(p), ...(p.conglomerate ? { conglomerate: shape(p.conglomerate) } : {}) }]))
  };
}

/** For tests: forget the cache (and optionally the file), so a computation runs on the next read. */
export function resetDominanceCache({ removeFile = false } = {}) {
  cache = null;
  lastError = null;
  if (removeFile) fs.rmSync(FILE, { force: true });
}

export function dominanceStatus() {
  return { computedAt: cache?.computedAt ?? null, durationMs: cache?.durationMs ?? null, lastError };
}
