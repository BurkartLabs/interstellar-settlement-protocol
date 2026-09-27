// The warfare catalog (ISP-225, AB#920; docs/design/TERRITORY.md, AB#916).
//
// data/warfare.json holds every number the territory design fixes: the concession terms and upkeep curve, each system's
// rule (the ownerRule strings made rules: control weights, tariff cap, and what differs from the standard terms), and the
// systems that can never be conceded. It is read once, when the server starts, and checked twice: its own shape and
// bounds, and every system id it names against data/systems.json (T-019: one catalog naming ids another does not
// define is what once stopped the corporation ladder at level 5). Either failing stops the server: it throws on import,
// and server/index.js imports this before anything listens (fails closed).
//
// v0.13-02 to 04 (tariffs and dumping, patents and lobbying, arbitration claims: AB#917 to AB#919) add their sections
// with their designs; the bounds their stories need are already here, and apply once a section exists.
//
// ISP_WARFARE_CATALOG points at another file, for the test that proves the server refuses it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const DEFAULT_FILE = path.join(DATA, "warfare.json");

/** The highest tariff any system may allow (AB#920's acceptance: 25% unless a design says otherwise). */
export const MAX_TARIFF_PCT = 25;
/** The systems a concession may never be granted in, whatever the file says: Sol, so a new player is never locked out. */
export const ALWAYS_NEVER_CONCEDABLE = Object.freeze(["sol"]);
export const HOLDER_TYPES = Object.freeze(["corp", "conglomerate"]);

const COUNT = (v) => Number.isInteger(v) && v >= 0;
const POSITIVE = (v) => Number.isInteger(v) && v > 0;
const PCT = (v) => typeof v === "number" && v >= 0 && v <= 100;
const RATIO = (v) => typeof v === "number" && v >= 1;
const FACTOR = (v) => typeof v === "number" && v > 0 && v <= 1;

/** Every scalar the design's number table names, and what it must be. */
const SCALARS = {
  concessionGrantPct: PCT, concessionLeadRatio: RATIO, concessionEligibleDays: POSITIVE, concessionPetitionFee: COUNT,
  concessionReviewHours: COUNT, concessionTermDays: POSITIVE, concessionRetainPct: PCT, concessionGraceDays: POSITIVE,
  concessionRepetitionCooldownDays: COUNT, concessionUpkeepBase: COUNT, concessionUseDiscountMaxPct: PCT,
  concessionAdmMaxPct: COUNT, concessionFeeSharePct: PCT, concessionOwnLeaseDiscountPct: PCT,
  concessionTariffCapPct: PCT, concessionsPerSystem: POSITIVE
};
/** What a system's rule may change, and what each must be. */
const OVERRIDES = {
  concessionGrantPct: PCT, concessionEligibleDays: POSITIVE, concessionReviewHours: COUNT, concessionFeeSharePct: PCT,
  concessionTermDays: POSITIVE, concessionsPerSystem: (v) => v === 1 || v === 2, upkeepFactor: FACTOR, feeShareFactor: FACTOR,
  holders: (v) => Array.isArray(v) && v.length > 0 && v.every((h) => HOLDER_TYPES.includes(h)), counterPetitions: (v) => typeof v === "boolean"
};

/** What is wrong with the catalog's own shape and bounds, as sentences; [] when nothing is. */
export function warfareSchemaProblems(c) {
  const out = [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["the catalog is not an object"];
  for (const [key, ok] of Object.entries(SCALARS)) {
    if (!(key in c)) out.push(`${key} is missing`);
    else if (!ok(c[key])) out.push(`${key} is ${JSON.stringify(c[key])}, which is not a valid value`);
  }
  if (PCT(c.concessionRetainPct) && PCT(c.concessionGrantPct) && !(c.concessionRetainPct < c.concessionGrantPct)) {
    out.push(`concessionRetainPct (${c.concessionRetainPct}) must be below concessionGrantPct (${c.concessionGrantPct}), or a holder that just qualified could lose it the next day`);
  }
  if (PCT(c.concessionTariffCapPct) && c.concessionTariffCapPct > MAX_TARIFF_PCT) out.push(`concessionTariffCapPct is ${c.concessionTariffCapPct}%, above the ${MAX_TARIFF_PCT}% ceiling`);

  const never = Array.isArray(c.neverConcedable) ? c.neverConcedable : null;
  if (!never) out.push("neverConcedable is missing");
  else {
    for (const n of never) if (typeof n?.systemId !== "string" || !n.systemId || typeof n?.reason !== "string" || !n.reason) out.push(`a never-concedable entry has no system id or no reason: ${JSON.stringify(n)}`);
    for (const id of ALWAYS_NEVER_CONCEDABLE) if (!never.some((n) => n?.systemId === id)) out.push(`neverConcedable must include ${id}`);
  }

  const rules = c.systemRules && typeof c.systemRules === "object" && !Array.isArray(c.systemRules) ? c.systemRules : null;
  if (!rules || !Object.keys(rules).length) out.push("systemRules is missing");
  else {
    for (const [id, r] of Object.entries(rules)) {
      if (never?.some((n) => n?.systemId === id)) out.push(`${id} is never concedable and has a concession rule`);
      if (typeof r?.rule !== "string" || !r.rule) out.push(`${id} has no rule text`);
      const w = r?.weights;
      if (!w || !["leases", "extraction", "sales"].every((k) => typeof w[k] === "number" && w[k] >= 0)) out.push(`${id}'s weights need leases, extraction and sales`);
      else if (Math.abs(w.leases + w.extraction + w.sales - 1) > 1e-9) out.push(`${id}'s weights sum to ${w.leases + w.extraction + w.sales}, not 1`);
      if (!PCT(r?.tariffCapPct)) out.push(`${id}'s tariffCapPct is ${JSON.stringify(r?.tariffCapPct)}`);
      else if (r.tariffCapPct > MAX_TARIFF_PCT) out.push(`${id}'s tariffCapPct is ${r.tariffCapPct}%, above the ${MAX_TARIFF_PCT}% ceiling`);
      for (const [key, v] of Object.entries(r?.overrides || {})) {
        if (!OVERRIDES[key]) out.push(`${id} overrides ${key}, which a system rule cannot change`);
        else if (!OVERRIDES[key](v)) out.push(`${id}'s override ${key} is ${JSON.stringify(v)}, which is not a valid value`);
      }
      const retain = c.concessionRetainPct, grant = r?.overrides?.concessionGrantPct;
      if (PCT(grant) && PCT(retain) && !(retain < grant)) out.push(`${id}'s concessionGrantPct (${grant}) is not above concessionRetainPct (${retain})`);
    }
  }
  // v0.13-02/03 bounds, applied once their sections exist (AB#920's acceptance names them now)
  if (c.patents && !(typeof c.patents.royaltyMaxPct === "number" && c.patents.royaltyMaxPct >= 0 && c.patents.royaltyMaxPct < 100)) out.push(`patents.royaltyMaxPct is ${JSON.stringify(c.patents?.royaltyMaxPct)}; it must be below 100%`);
  if (c.tariffs && !(typeof c.tariffs.maxPct === "number" && c.tariffs.maxPct >= 0 && c.tariffs.maxPct <= MAX_TARIFF_PCT)) out.push(`tariffs.maxPct is ${JSON.stringify(c.tariffs?.maxPct)}; it must be at most ${MAX_TARIFF_PCT}%`);
  return out;
}

/** The system ids data/systems.json defines. */
export function readSystemIds(dir = DATA) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "systems.json"), "utf8"));
  return new Set((Array.isArray(raw) ? raw : raw.systems || []).map((s) => s?.id).filter(Boolean));
}

/**
 * Every system id the catalog names that data/systems.json does not define, and every system the catalog leaves
 * without a rule (T-019), as sentences; [] when all resolve. A system must be either conceded by a rule or never
 * concedable, never neither: a system added to the starmap without a territory rule fails here.
 */
export function warfareReferenceProblems(c, systemIds) {
  const out = [];
  const named = [...(c?.neverConcedable || []).map((n) => [n?.systemId, "neverConcedable"]), ...Object.keys(c?.systemRules || {}).map((id) => [id, "systemRules"])];
  for (const [id, where] of named) if (!systemIds.has(id)) out.push(`${where} names system "${id}", which data/systems.json does not define`);
  const covered = new Set(named.map(([id]) => id));
  for (const id of systemIds) if (!covered.has(id)) out.push(`system "${id}" has neither a concession rule nor a place in neverConcedable`);
  return out;
}

/** The catalog at `file`, checked; throws naming every problem when it is unusable. */
export function readWarfareCatalog(file = process.env.ISP_WARFARE_CATALOG || DEFAULT_FILE, systemIds = readSystemIds()) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = [...warfareSchemaProblems(raw), ...warfareReferenceProblems(raw, systemIds)];
  if (problems.length) throw new Error(`data/warfare.json cannot be used (AB#920): ${problems.join("; ")}.`);
  return Object.freeze(raw);
}

/** The catalog. Reading it throws when it is unusable, which stops the server starting (fails closed). */
export const WARFARE_CATALOG = readWarfareCatalog();

/** A system's concession terms: the catalog's standard terms with its rule's overrides; null when never concedable. */
export function concessionTermsFor(systemId, catalog = WARFARE_CATALOG) {
  const rule = catalog.systemRules?.[systemId];
  if (!rule) return null;
  const base = Object.fromEntries(Object.keys(SCALARS).map((k) => [k, catalog[k]]));
  return { ...base, upkeepFactor: 1, feeShareFactor: 1, holders: [...HOLDER_TYPES], counterPetitions: true, ...(rule.overrides || {}), weights: { ...rule.weights }, tariffCapPct: rule.tariffCapPct, rule: rule.rule };
}
