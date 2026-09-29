// The conglomerate catalog (ISP-196, AB#890; docs/design/CONGLOMERATES.md, AB#888 and AB#889).
//
// data/conglomerates.json holds every number the design fixes. It is read once, when the server starts, and checked
// twice: its own shape (every field present and sane, the level ladder rising from 5 members to at most 100), and every
// id it names against the catalog that defines it (buildings, stations, items, research). T-019: ISP's corporation
// ladder once stopped at level 5 because one catalog named ids another did not define, and each file's own schema test
// passed. Either check failing stops the server: it throws on import, and server/index.js imports this. A game that
// starts with a broken ladder is worse than one that does not start.
//
// ISP_CONGLOMERATE_CATALOG points at another file, for the test that proves the server refuses it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogStations } from "./game/stations.js"; // ISP-209 (AB#904)
import { ECONOMY } from "./economy.js"; // ISP-212b (AB#4655): the ISA's exchange tax, for a station's first rate

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const DEFAULT_FILE = path.join(DATA, "conglomerates.json");

export const MAX_MEMBERS = 100;
export const FIRST_LEVEL_MEMBERS = 5;
export const ROLES = Object.freeze(["founder", "director", "member"]);

/** Every scalar the design's number table names, and what it must be. */
const COUNT = (v) => Number.isInteger(v) && v >= 0;
const POSITIVE = (v) => Number.isInteger(v) && v > 0;
const PCT = (v) => typeof v === "number" && v >= 0 && v <= 100;
const SCALARS = {
  minFounderAgeDays: COUNT, charterFee: POSITIVE, charterDeposit: COUNT, emblems: POSITIVE, colours: POSITIVE,
  inviteExpiryDays: POSITIVE, applicationExpiryDays: POSITIVE, invitesPerDay: POSITIVE, joinCooldownHours: COUNT, nameReleaseDays: COUNT,
  maxDirectors: POSITIVE, founderAbsentDays: POSITIVE, upkeepBase: COUNT, upkeepPerMemberStep: COUNT, upkeepMinMembers: POSITIVE,
  arrearsDropDays: POSITIVE, levelReserveDays: COUNT, levelFillPct: PCT, poolingFeePct: PCT, remoteDispatchYieldPct: PCT, founderWithdrawPct: PCT,
  directorWithdrawPct: PCT, directorWithdrawMax: COUNT, memberGoodsWithdrawPct: PCT, withdrawalNoticePct: PCT,
  withdrawalDelayHours: COUNT, stationMinLevel: POSITIVE, stationCostCredits: POSITIVE, stationBuildDays: POSITIVE,
  stationMemberRentPct: PCT, stationVoteHours: POSITIVE, assetSafetyFeePct: PCT, stakeBuyoutLeftPct: PCT,
  stakeBuyoutRemovedPct: PCT, stakeBuyoutDays: POSITIVE, dominanceWindowDays: POSITIVE, dominancePublicRoundPct: PCT
};
const ID_FIELDS = ["bureauBuildingId", "charterStationId", "homeStationId", "assetSafetyStationId"];

/** What is wrong with the catalog's own shape, as sentences; [] when nothing is. */
export function conglomerateSchemaProblems(c) {
  const out = [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["the catalog is not an object"];
  for (const [key, ok] of Object.entries(SCALARS)) {
    if (!(key in c)) out.push(`${key} is missing`);
    else if (!ok(c[key])) out.push(`${key} is ${JSON.stringify(c[key])}, which is not a valid value`);
  }
  for (const key of ID_FIELDS) if (typeof c[key] !== "string" || !c[key]) out.push(`${key} is missing`);

  if (!Array.isArray(c.levels) || !c.levels.length) out.push("levels is missing");
  else {
    c.levels.forEach((l, i) => {
      const at = `levels[${i}]`;
      if (l?.level !== i + 1) out.push(`${at}.level is ${JSON.stringify(l?.level)}, not ${i + 1}`);
      if (!POSITIVE(l?.maxMembers)) out.push(`${at}.maxMembers is missing`);
      if (!COUNT(l?.cost)) out.push(`${at}.cost is missing`);
      if (!COUNT(l?.minDaysAtPrevious)) out.push(`${at}.minDaysAtPrevious is missing`);
      if (l?.researchRequired !== undefined && !Array.isArray(l.researchRequired)) out.push(`${at}.researchRequired is not a list`);
      if (i === 0 && l?.maxMembers !== FIRST_LEVEL_MEMBERS) out.push(`the first level's cap is ${l?.maxMembers}, not ${FIRST_LEVEL_MEMBERS}`);
      if (i > 0 && POSITIVE(l?.maxMembers) && !(l.maxMembers > c.levels[i - 1]?.maxMembers)) out.push(`level ${i + 1}'s cap (${l.maxMembers}) is not above level ${i}'s (${c.levels[i - 1]?.maxMembers})`);
      if (POSITIVE(l?.maxMembers) && l.maxMembers > MAX_MEMBERS) out.push(`level ${i + 1}'s cap (${l.maxMembers}) is above ${MAX_MEMBERS}`);
    });
    if (POSITIVE(c.stationMinLevel) && c.stationMinLevel > c.levels.length) out.push(`stationMinLevel ${c.stationMinLevel} is above the top level`);
  }

  if (JSON.stringify(c.roles) !== JSON.stringify(ROLES)) out.push(`roles must be exactly ${ROLES.join(", ")}`);
  if (!Array.isArray(c.permissions) || !c.permissions.length) out.push("permissions is missing");
  else {
    const ids = new Set();
    for (const p of c.permissions) {
      if (!p?.id || ids.has(p.id)) out.push(`a permission has no id, or ${p?.id} is there twice`);
      ids.add(p?.id);
      if (typeof p?.label !== "string" || !p.label) out.push(`permission ${p?.id} has no label`);
      for (const r of ROLES) if (typeof p?.[r] !== "boolean") out.push(`permission ${p?.id} does not say whether a ${r} holds it`);
    }
  }

  if (!c.stationCostGoods || typeof c.stationCostGoods !== "object" || !Object.keys(c.stationCostGoods).length) out.push("stationCostGoods is missing");
  else for (const [item, n] of Object.entries(c.stationCostGoods)) if (!POSITIVE(n)) out.push(`stationCostGoods.${item} is ${JSON.stringify(n)}`);
  if (typeof c.stakeGoodsPriceBasis !== "string" || !c.stakeGoodsPriceBasis) out.push("stakeGoodsPriceBasis is missing");
  if (!Array.isArray(c.stationTaxOptions) || !c.stationTaxOptions.length || !c.stationTaxOptions.every(PCT)) out.push("stationTaxOptions is missing or not a list of percentages");
  const w = c.dominanceWeights;
  if (!w || !["leases", "extraction", "sales"].every((k) => typeof w[k] === "number" && w[k] >= 0)) out.push("dominanceWeights needs leases, extraction and sales");
  else if (Math.abs(w.leases + w.extraction + w.sales - 1) > 1e-9) out.push(`dominanceWeights sum to ${w.leases + w.extraction + w.sales}, not 1`);
  return out;
}

/** The catalogs the conglomerate catalog names ids from, as sets of ids. */
export function readReferenceCatalogs(dir = DATA) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const ids = (list) => new Set((list || []).map((x) => x?.id).filter(Boolean));
  return {
    buildings: ids(read("buildings.json").buildings),
    stations: ids(catalogStations()), // the NPC catalog: a data file cannot name a station built in play
    items: ids(read("items.json").items),
    research: ids(read("research.json").nodes)
  };
}

/** Every id the catalog names that its own catalog does not define (T-019), as sentences; [] when all resolve. */
export function conglomerateReferenceProblems(c, refs) {
  const out = [];
  const FILE = { building: "buildings.json", station: "stations.json", item: "items.json", research: "research.json" };
  const check = (set, kind, id, where) => { if (!set.has(id)) out.push(`${where} names ${kind} "${id}", which data/${FILE[kind]} does not define`); };
  check(refs.buildings, "building", c?.bureauBuildingId, "bureauBuildingId");
  for (const key of ["charterStationId", "homeStationId", "assetSafetyStationId"]) check(refs.stations, "station", c?.[key], key);
  for (const item of Object.keys(c?.stationCostGoods || {})) check(refs.items, "item", item, "stationCostGoods");
  for (const l of c?.levels || []) for (const r of l?.researchRequired || []) check(refs.research, "research", r, `level ${l.level}'s researchRequired`);
  return out;
}

/** The catalog at `file`, checked; throws naming every problem when it is unusable. */
export function readConglomerateCatalog(file = process.env.ISP_CONGLOMERATE_CATALOG || DEFAULT_FILE, refs = readReferenceCatalogs()) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = [...conglomerateSchemaProblems(raw), ...conglomerateReferenceProblems(raw, refs)];
  if (problems.length) throw new Error(`data/conglomerates.json cannot be used (AB#890): ${problems.join("; ")}.`);
  return Object.freeze(raw);
}

/** The catalog. Reading it throws when it is unusable, which stops the server starting (fails closed). */
export const CONGLOMERATE_CATALOG = readConglomerateCatalog();

/** ISP-212b (AB#4655): a new station's sales tax: the option nearest the ISA's exchange tax (the lower on a tie). */
export function defaultStationTaxPct(catalog = CONGLOMERATE_CATALOG, isaPct = ECONOMY.exchange.salesTaxPct) {
  return [...catalog.stationTaxOptions].sort((a, b) => Math.abs(a - isaPct) - Math.abs(b - isaPct) || a - b)[0];
}

/**
 * Actions anyone signed in may take whatever their role, including none: they are about the caller's own corporation,
 * and their own rules refuse what does not apply (a member applying is told it already belongs). ISP-199 (AB#893).
 */
export const OPEN_ACTIONS = Object.freeze(["charter", "directory", "view-own", "apply", "answer-invitation", "withdraw-application"]);

/**
 * The one permission check (ISP-199, AB#893; P-HALF-FIX): may a corporation holding `role` (founder, director, member,
 * or null for none) take `action`? Member actions are the catalog's roles table, read on every call; open actions are
 * OPEN_ACTIONS. An unknown role or action is refused (fails closed).
 */
export function can(role, action, catalog = CONGLOMERATE_CATALOG) {
  if (role !== null && !ROLES.includes(role)) return false;
  if (OPEN_ACTIONS.includes(action)) return true;
  const permission = catalog?.permissions?.find((p) => p.id === action);
  return Boolean(permission && role && permission[role] === true);
}

/** Whether `action` is one can() knows: an open action or a row of the roles table. */
export function isKnownAction(action, catalog = CONGLOMERATE_CATALOG) {
  return OPEN_ACTIONS.includes(action) || Boolean(catalog?.permissions?.some((p) => p.id === action));
}
