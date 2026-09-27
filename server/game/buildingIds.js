// server/game/buildingIds.js: every built building has a stable id the server made (ISP-100, AB#792).
//
// Entries in corp.buildings were { name, tier, status } with nothing to tell three extractor yards apart, so an upgrade
// route (AB#793) could only have named one by name or index: the wrong yard, or an index a client made up. Ids are
// given here rather than at each build route, so a building made by any route - including one written later - has one
// by the time the mutation that made it returns (store.js calls this after every mutator, and on load).
//
// An extractor yard's building and its extractor record (corp.mining.silicateExtractors) are pushed together, in the
// same order, by the build route, and server/buildingRemoval.js (AB#2569) removes them together. So an unlinked n-th yard
// belongs to the n-th unlinked extractor, and each extractor is given its building's id as `buildingId`. An extractor that
// already has one keeps it.

import { createId } from "./catalog.js";

export const EXTRACTOR_YARD_NAME = "Basic Extractor Yard";

const hasId = (b) => typeof b?.id === "string" && b.id.length > 0;

/**
 * Give every building in corp.buildings an id it lacks, make duplicate ids unique, and link each extractor record to
 * its yard's id. Everything is worked out before anything is written, so a corporation is changed completely or not
 * at all. Returns true when something changed. Running it again on its own output changes nothing.
 */
export function ensureBuildingIds(corp) {
  if (!corp || !Array.isArray(corp.buildings)) return false;

  const seen = new Set();
  const buildings = corp.buildings.map((b) => {
    if (!b || typeof b !== "object") return b;
    if (hasId(b) && !seen.has(b.id)) {
      seen.add(b.id);
      return b;
    }
    // AB#2290: a taken id gets a counter rather than another createId, so this ends even when createId repeats itself
    // (a test that pins Math.random and Date made the old retry loop run until the worker ran out of heap).
    const base = createId("bld");
    let id = base;
    for (let n = 2; seen.has(id); n += 1) id = `${base}-${n}`;
    seen.add(id);
    return { ...b, id };
  });

  const extractors = Array.isArray(corp.mining?.silicateExtractors) ? corp.mining.silicateExtractors : [];
  const yards = buildings.filter((b) => b && typeof b === "object" && b.name === EXTRACTOR_YARD_NAME);
  const claimed = new Set(extractors.map((e) => e?.buildingId).filter((id) => yards.some((y) => y.id === id)));
  const free = yards.filter((y) => !claimed.has(y.id));
  const links = [];
  for (const extractor of extractors) {
    if (!extractor || typeof extractor !== "object") continue;
    if (yards.some((y) => y.id === extractor.buildingId)) continue;
    const yard = free.shift();
    if (!yard) break;
    links.push([extractor, yard.id]);
  }

  const changed = buildings.some((b, i) => b !== corp.buildings[i]) || links.length > 0;
  if (!changed) return false;
  corp.buildings = buildings;
  for (const [extractor, id] of links) extractor.buildingId = id;
  return true;
}

/**
 * The load-time migration: ensureBuildingIds for every corporation in the store. A corporation that throws is left as
 * it was and counted; the log names no account and no player data. Returns { migrated, failed }.
 */
export function backfillBuildingIds(accounts, log = console.warn) {
  let migrated = 0;
  let failed = 0;
  for (const account of Object.values(accounts || {})) {
    const corp = account?.state?.corp;
    if (!corp) continue;
    try {
      if (ensureBuildingIds(corp)) migrated += 1;
    } catch {
      failed += 1;
    }
  }
  if (failed) log(`[buildings] ${failed} corporation(s) could not be given building ids (AB#792); left unchanged.`);
  return { migrated, failed };
}
