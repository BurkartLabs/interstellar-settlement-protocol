// server/game/desk.js: Desk Work's packets (AB#4689, docs/design/desk-work.md). A packet is a short Bureau document
// built from the game's own data and graded on the server: its truth is drawn when the packet is generated, kept as the
// packet's key, and never sent to the client (section 3, rule 3; T-019). Every generator here is a pure function of a
// seed and the data it is given, so the same seed and data yield the same packet, and every grader checks an answer
// against the stored key and nothing else. The numbers are data/economy.json's `desk`.
//
// Slice 1 is the Survey (ISA Mineral Survey Division, section 5): readings of a body's resource profile or a live belt's
// composition, with seeded noise and, from tier 2, resources that are not there at all. Audit and Dispatch follow.

import crypto from "node:crypto";
import { ECONOMY } from "../economy.js";
import { navigationFor } from "../../public/scripts/navigation.js";
import { SYSTEMS_DATA } from "./catalog.js";
import { BELT_TIERS } from "./beltRules.js";
import { TIER_TEMPLATES, isBeltPresent } from "./belts.js";

/** The tiers a packet is drawn at. Tier 2 opens at Recognized and tier 3 at Trusted (section 4); the routes check that. */
export const DESK_TIERS = Object.freeze([1, 2, 3]);

const SURVEY_DIVISION = "ISA Mineral Survey Division";
/** How many resources a survey asks for, how many readings it carries and how many distractors it adds, by tier. */
const SURVEY_SHAPE = Object.freeze({
  1: { question: "dominant", asks: 1, passes: 1, distractors: 0 },
  2: { question: "top-three", asks: 3, passes: 1, distractors: 1 },
  3: { question: "top-three-rarity-reserve", asks: 3, passes: 4, distractors: 2 }
});
/** The belt rarities a tier-3 survey takes as its subject ("rare and exotic belts anywhere"). */
const TIER3_RARITIES = Object.freeze(["rare", "exotic"]);
/** How many subjects and noise draws a generator tries before it says there is nothing to survey. */
const MAX_DRAWS = 64;

/**
 * A deterministic generator for a seed: sfc32, keyed by a SHA-256 of the seed, returning numbers in [0, 1). The seed is
 * any string or number; the routes give each corporation its own (slice 5).
 */
export function deskRng(seed) {
  const hex = crypto.createHash("sha256").update(`desk:${String(seed)}`).digest("hex");
  let [a, b, c, d] = [0, 8, 16, 24].map((i) => parseInt(hex.slice(i, i + 8), 16) >>> 0);
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
/** A share as the document prints it: percent, one decimal. */
const asPct = (share) => Math.round(share * 1000) / 10;
/** A share with up to `noisePct` percent of itself added or taken away. */
const noisy = (share, noisePct, rng) => share * (1 + ((rng() * 2 - 1) * noisePct) / 100);

/** Shares summing to 1, largest first, from a { resource: weight } map. */
function sortedShares(weights) {
  const entries = Object.entries(weights).filter(([, w]) => Number(w) > 0);
  const total = entries.reduce((s, [, w]) => s + Number(w), 0);
  return entries.map(([r, w]) => [r, Number(w) / total]).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}

/**
 * What a survey of one body would be graded against, or null when there is nothing there to survey: a Field body is its
 * live belt (the current generation's composition), and only while the belt is present; any other body is its
 * resourceProfile.
 */
function surveyTruth(system, body, belts) {
  const subject = { systemId: system.id, systemName: system.name, bodyId: body.id, name: body.name, type: body.type };
  if (body.composition) {
    const belt = belts?.[`${system.id}:${body.id}`];
    if (!isBeltPresent(belt)) return null;
    return { ...subject, belt: { key: belt.key, generation: belt.generation, rarity: belt.rarity, remaining: belt.remaining }, shares: sortedShares(belt.composition) };
  }
  const weights = Object.fromEntries((body.resourceProfile || []).map((p) => [p.item, p.concentration]));
  return { ...subject, belt: null, shares: sortedShares(weights) };
}

/** Whether a truth can be asked about at a tier: enough resources, and the asked ranks strictly ordered. */
function surveyable(truth, asks) {
  const s = truth.shares.map(([, v]) => asPct(v));
  if (s.length < Math.max(2, asks)) return false;
  for (let i = 0; i < asks; i += 1) if (!(s[i] > (s[i + 1] ?? -1))) return false;
  return true;
}

/** Every body a survey at `tier` may take as its subject, for this corporation (section 5, the Survey table). */
export function surveySubjects(tier, { corp = {}, belts = {}, systems = SYSTEMS_DATA } = {}) {
  const shape = SURVEY_SHAPE[tier];
  if (!shape) return [];
  const navigation = navigationFor(systems);
  const inScope = (system, body) => {
    if (tier === 1) return system.id === "sol";
    if (tier === 2) return navigation.canReachSystem(corp.unlockedTech, corp.currentSystemId, system.id);
    return Boolean(body.composition);
  };
  return systems.flatMap((system) => (system.bodies || [])
    .filter((body) => inScope(system, body))
    .map((body) => surveyTruth(system, body, belts))
    .filter((truth) => truth && (tier !== 3 || TIER3_RARITIES.includes(truth.belt?.rarity)) && surveyable(truth, shape.asks)));
}

/** Every resource any body or belt in the catalog holds: where a survey's distractors come from. */
function resourcePool(systems) {
  const pool = new Set();
  for (const system of systems) {
    for (const body of system.bodies || []) {
      for (const p of body.resourceProfile || []) pool.add(p.item);
      for (const r of Object.keys(body.composition || {})) pool.add(r);
    }
  }
  return [...pool].sort();
}

/** The evidence a document gives for each resource: its one reading, or its readings averaged across the passes. */
function evidenceOf(readings) {
  const out = {};
  for (const reading of readings) for (const [r, v] of Object.entries(reading)) out[r] = (out[r] || 0) + v / readings.length;
  return out;
}

/** The rarity whose class profile is nearest to the evidence (L1 over shares), and whether it is nearer than the next. */
function nearestRarity(evidence, templates) {
  const ev = Object.fromEntries(sortedShares(evidence));
  const distances = Object.entries(templates).map(([tier, template]) => {
    const keys = new Set([...Object.keys(ev), ...Object.keys(template)]);
    let d = 0;
    for (const k of keys) d += Math.abs((ev[k] || 0) - (template[k] || 0));
    return [tier, d];
  }).sort((a, b) => a[1] - b[1]);
  return { rarity: distances[0][0], clear: distances.length < 2 || distances[1][1] - distances[0][1] > 0.02 };
}

/**
 * Whether a document can be answered from what it shows: ordered by its evidence, the first `asks` resources are the
 * truth's, in the truth's order, with no tie at any of those places; at tier 3 the class profiles name the right rarity
 * and the passes' reserve estimates average to within half the tolerance. A document that fails is redrawn, so no
 * packet asks for something its own readings contradict.
 */
function answerable(truth, shape, readings, reserveEstimates, rules) {
  const evidence = evidenceOf(readings);
  const ranked = Object.entries(evidence).sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < shape.asks; i += 1) {
    if (ranked[i][0] !== truth.shares[i][0]) return false;
    if (!(ranked[i][1] > (ranked[i + 1]?.[1] ?? -1))) return false;
  }
  if (shape.passes > 1) {
    const templates = Object.fromEntries(Object.entries(TIER_TEMPLATES).map(([t, c]) => [t, Object.fromEntries(sortedShares(c))]));
    const near = nearestRarity(evidence, templates);
    if (near.rarity !== truth.belt.rarity || !near.clear) return false;
    const mean = reserveEstimates.reduce((s, v) => s + v, 0) / reserveEstimates.length;
    if (Math.abs(mean - truth.belt.remaining) > (truth.belt.remaining * rules.surveyReserveTolerancePct) / 200) return false;
  }
  return true;
}

/** One survey document's readings for a truth: per pass, every true resource and every distractor, noisy, in percent. */
function drawReadings(truth, shape, distractors, noisePct, rng) {
  const floor = truth.shares[shape.asks - 1][1];
  const distractorBase = Object.fromEntries(distractors.map((r) => [r, floor * (0.2 + rng() * 0.6)]));
  const readings = [];
  for (let p = 0; p < shape.passes; p += 1) {
    const reading = {};
    for (const [r, share] of truth.shares) reading[r] = asPct(noisy(share, noisePct, rng));
    for (const [r, base] of Object.entries(distractorBase)) reading[r] = asPct(noisy(base, noisePct, rng));
    // Alphabetical: in drawing order the keys would spell out the true ranking and mark the distractors.
    readings.push(Object.fromEntries(Object.entries(reading).sort(([x], [y]) => (x < y ? -1 : 1))));
  }
  const reserveEstimates = shape.passes > 1
    ? Array.from({ length: shape.passes }, () => Math.round(noisy(truth.belt.remaining, noisePct, rng)))
    : null;
  return { readings, reserveEstimates };
}

/**
 * A Survey packet at `tier` from `seed`: { packet, key }, or null when the corporation has nothing it may survey at that
 * tier. `packet` is what the client is shown; `key` stays on the server and is all `gradeSurvey` reads. Pure: the same
 * seed, tier, corporation, belts and systems give the same packet.
 */
export function generateSurvey({ seed, tier, corp = {}, belts = {}, systems = SYSTEMS_DATA, rules = ECONOMY.desk } = {}) {
  const shape = SURVEY_SHAPE[tier];
  if (!shape) return null;
  const subjects = surveySubjects(tier, { corp, belts, systems });
  if (!subjects.length) return null;
  const rng = deskRng(`survey:${tier}:${seed}`);
  const noisePct = rules.surveyNoisePctByTier[tier - 1];
  const pool = resourcePool(systems);
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const truth = pick(subjects, rng);
    const absent = pool.filter((r) => !truth.shares.some(([t]) => t === r));
    const distractors = [];
    while (distractors.length < Math.min(shape.distractors, absent.length)) {
      const r = pick(absent, rng);
      if (!distractors.includes(r)) distractors.push(r);
    }
    const { readings, reserveEstimates } = drawReadings(truth, shape, distractors, noisePct, rng);
    if (!answerable(truth, shape, readings, reserveEstimates, rules)) continue;
    const ref = `MSD-${String(Math.floor(rng() * 1_000_000)).padStart(6, "0")}`;
    const subject = { systemId: truth.systemId, systemName: truth.systemName, bodyId: truth.bodyId, name: truth.name, type: truth.type, ...(truth.belt ? { beltKey: truth.belt.key, generation: truth.belt.generation } : {}) };
    const packet = {
      kind: "survey", tier, ref, division: SURVEY_DIVISION, question: shape.question,
      fee: rules.payByTier[tier - 1], points: rules.pointsByTier[tier - 1],
      subject, readings, options: Object.keys(readings[0]).sort(),
      ...(shape.passes > 1 ? {
        reserveEstimates,
        rarityOptions: [...BELT_TIERS],
        classProfiles: Object.fromEntries(Object.entries(TIER_TEMPLATES).map(([t, c]) => [t, Object.fromEntries(sortedShares(c).map(([r, v]) => [r, asPct(v)]))]))
      } : {})
    };
    const key = {
      kind: "survey", tier, ref, subject,
      truth: truth.shares.slice(0, shape.asks).map(([r, v]) => ({ resource: r, pct: asPct(v) })),
      distractors,
      ...(shape.passes > 1 ? { rarity: truth.belt.rarity, remaining: truth.belt.remaining, reserveTolerancePct: rules.surveyReserveTolerancePct } : {})
    };
    return { packet, key };
  }
  return null;
}

const listOf = (truth) => truth.map((t) => `${t.resource} (${t.pct}%)`).join(", ");

/** The graded receipt's sentence for a survey: the truth, and the rule it was graded by. */
function surveyExplanation(key) {
  const where = key.subject.name;
  if (key.tier === 1) return `${where}'s dominant resource is ${listOf(key.truth)}. A tier-1 survey is correct when it names the true largest share, read from the assay, not the readings.`;
  const top = `${where}'s top three resources are ${listOf(key.truth)}.`;
  if (key.tier === 2) return `${top} A tier-2 survey is correct when it ranks all three in order.`;
  return `${top} It is a ${key.rarity} belt with ${key.remaining} units remaining. A tier-3 survey is correct when the ranking, the rarity and a reserve estimate within ${key.reserveTolerancePct}% are all right.`;
}

/**
 * Grade an answer to a Survey against its stored key: { correct, explanation }. Anything malformed is simply incorrect
 * (it fails closed). Tier 1 reads { pick }, tier 2 { ranking: [three resources] }, tier 3 that plus { rarity, reserve }.
 */
export function gradeSurvey(key, answer) {
  if (!key || key.kind !== "survey" || !Array.isArray(key.truth)) return { correct: false, explanation: "" };
  const result = (correct) => ({ correct, explanation: surveyExplanation(key) });
  if (!answer || typeof answer !== "object") return result(false);
  const truth = key.truth.map((t) => t.resource);
  if (key.tier === 1) return result(typeof answer.pick === "string" && answer.pick === truth[0]);
  const ranking = answer.ranking;
  if (!Array.isArray(ranking) || ranking.length !== truth.length || !ranking.every((r, i) => r === truth[i])) return result(false);
  if (key.tier === 2) return result(true);
  if (answer.rarity !== key.rarity) return result(false);
  const reserve = answer.reserve;
  if (typeof reserve !== "number" || !Number.isFinite(reserve)) return result(false);
  // A hair of slack, so an estimate exactly at the tolerance is not lost to floating-point rounding.
  return result(Math.abs(reserve - key.remaining) <= (key.remaining * key.reserveTolerancePct) / 100 + 1e-9);
}
