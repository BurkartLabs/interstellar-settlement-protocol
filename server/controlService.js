// server/controlService.js: each system's daily control readings and the public control view (ISP-226, AB#921;
// docs/design/TERRITORY.md). The scores are server/game/control.js; the dominance they are made from is
// server/dominanceService.js, which calls recordControlDay after each daily computation.
//
// The readings live in control-history.json in the data directory, like dominance.json: the last days per system that
// eligibility reads, never more. They hold holder ids (corporation publicIds, conglomerate ids) and scores, never an
// account id. What is served is names, rounded scores and eligibility only.

import fs from "node:fs";
import path from "node:path";
import { dataDir, safeWriteFile } from "./game/catalog.js";
import { dayKeyOf } from "./game/dominanceCounters.js";
import { roundToSteps } from "./game/dominance.js";
import { controlScores, eligibility } from "./game/control.js";
import { CONGLOMERATE_CATALOG } from "./conglomerates.js";
import { WARFARE_CATALOG, concessionTermsFor } from "./warfare.js";

const FILE = path.join(dataDir, "control-history.json");
/** Days kept per system: the longest eligibility window any system has. */
const KEEP_DAYS = Math.max(WARFARE_CATALOG.concessionEligibleDays, ...Object.values(WARFARE_CATALOG.systemRules).map((r) => r.overrides?.concessionEligibleDays || 0));
let history = readHistory();

/** ISP-264 (AB#960): the store as held, for a player's data export and for erasing an account (server/accountData.js). */
export const dataStore = Object.freeze({
  file: "control-history.json",
  read: () => history,
  rewrite(fn) { if (!history || typeof history !== "object") return; fn(history); safeWriteFile(FILE, JSON.stringify(history)); } // nothing held yet: nothing to write
});

function readHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed && typeof parsed === "object" && parsed.days ? parsed : { days: [] };
  } catch {
    return { days: [] };
  }
}

const isNever = (systemId) => WARFARE_CATALOG.neverConcedable.some((n) => n.systemId === systemId);
/** A system's control weights: its rule's, or (never concedable, still scored) the dominance metric's own. */
const weightsFor = (systemId) => WARFARE_CATALOG.systemRules[systemId]?.weights || CONGLOMERATE_CATALOG.dominanceWeights;

/** Record one daily dominance result's control scores (idempotent per UTC day), keeping the last KEEP_DAYS days. */
export function recordControlDay(result) {
  if (!result?.holders || !Number.isFinite(result.computedAt)) return false;
  const day = dayKeyOf(result.computedAt);
  const systems = Object.fromEntries(Object.entries(result.holders).map(([systemId, entry]) => [systemId, controlScores(entry, weightsFor(systemId))]));
  history.days = [...history.days.filter((d) => d.day !== day), { day, computedAt: result.computedAt, systems }]
    .sort((a, b) => b.day - a.day)
    .slice(0, KEEP_DAYS);
  safeWriteFile(FILE, JSON.stringify(history));
  return true;
}

/**
 * The public control view of a system at `now`: whether it can be conceded (and its rule), when the scores were
 * computed and whether they are stale, and the top three holders with rounded scores and whether each is eligible.
 * Null for a system not in the registry.
 */
export function systemControl(systemId, now = Date.now(), knownSystems) {
  if (!knownSystems.has(systemId)) return null;
  const terms = concessionTermsFor(systemId);
  const days = history.days.map((d) => ({ day: d.day, computedAt: d.computedAt, scores: d.systems[systemId] || [] }));
  const { stale, eligible } = eligibility(days, terms, now);
  const newest = days[0];
  const scores = newest?.scores || [];
  const top = scores.slice(0, 3);
  const rest = scores.slice(3).reduce((s, h) => s + h.score, 0);
  const total = scores.reduce((s, h) => s + h.score, 0) || 1;
  const rounded = roundToSteps([...top.map((h) => ({ name: h.name, share: h.score / total })), ...(rest > 0 ? [{ name: "", share: rest / total }] : [])], CONGLOMERATE_CATALOG.dominancePublicRoundPct);
  const others = rest > 0 ? rounded.pop().share : 0;
  return {
    systemId,
    concedable: Boolean(terms),
    rule: terms ? terms.rule : WARFARE_CATALOG.neverConcedable.find((n) => n.systemId === systemId)?.reason,
    computedAt: newest?.computedAt ?? null,
    stale,
    holders: top.map((h, i) => ({ name: h.name, type: h.type, score: rounded[i].share, eligible: !isNever(systemId) && eligible.has(`${h.type}:${h.id}`) })),
    others
  };
}

/**
 * ISP-227 (AB#922): what a petition, a renewal or a challenge reads now: the system's terms (null when never
 * concedable), whether the readings are stale, who is eligible ("type:id"), and the newest scores ({ type, id, name,
 * score, extraction }). A stale reading or none is the caller's to refuse (fails closed).
 */
export function controlNow(systemId, now = Date.now()) {
  const terms = concessionTermsFor(systemId);
  const days = history.days.map((d) => ({ day: d.day, computedAt: d.computedAt, scores: d.systems[systemId] || [] }));
  const { stale, eligible, streaks } = eligibility(days, terms, now);
  return { terms, stale: stale || !days.length, eligible, streaks, scores: days[0]?.scores || [] }; // streaks: ISP-229 (AB#924)
}

/** For tests: forget the readings (and optionally the file). */
export function resetControlHistory({ removeFile = false } = {}) {
  history = { days: [] };
  if (removeFile) fs.rmSync(FILE, { force: true });
}
