// server/game/desk.js: Desk Work's packets (AB#4689, docs/design/desk-work.md). A packet is a short Bureau document
// built from the game's own data and graded on the server: its truth is drawn when the packet is generated, kept as the
// packet's key, and never sent to the client (section 3, rule 3; T-019). Every generator here is a pure function of a
// seed and the data it is given, so the same seed and data yield the same packet, and every grader checks an answer
// against the stored key and nothing else. The numbers are data/economy.json's `desk`.
//
// Slice 1 is the Survey (ISA Mineral Survey Division, section 5): readings of a body's resource profile or a live belt's
// composition, with seeded noise and, from tier 2, resources that are not there at all. Slice 2 is the Audit (ISA Claims
// & Leases Division): a filing in which one clause, two, or none breaks a rule the server enforces. Slice 3 is the
// Dispatch (GEX Routing Desk): a transfer to price, a fill to cost delivered, a deadline fill and its margin.

import crypto from "node:crypto";
import { ECONOMY, npcBidFor } from "../economy.js";
import { jumpsBetween, transferFee, transitTime } from "../transfers.js";
import { WARFARE_CATALOG } from "../warfare.js";
import { CONGLOMERATE_CATALOG } from "../conglomerates.js";
import { NPC_CATALOG } from "../npcCorporations.js";
import { navigationFor } from "../../public/scripts/navigation.js";
import { employeesForNextLease } from "../../public/scripts/leaseStaffing.js";
import { activeOfficeAt } from "../../public/scripts/officeStatus.js";
import { leaseHasRoom } from "../../public/scripts/leaseSlots.js";
import { taxBreakdown } from "../../public/scripts/exchangeTax.js";
import { nextYardPrice } from "../../public/scripts/yardPrice.js";
import { SYSTEMS_DATA } from "./catalog.js";
import { BELT_TIERS } from "./beltRules.js";
import { TIER_TEMPLATES, isBeltPresent } from "./belts.js";
import { catalogStations } from "./stations.js";
import { bidQuotaFor, bidRuleFor } from "./world.js";

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

// ─── Audit (ISA Claims & Leases Division, section 5) ─────────────────────────────────────────────────────────────────
//
// A filing is a set of clauses, each a situation one of the server's rules decides. Every clause's verdict and corrected
// figure come from that rule's own code (the helper the route calls, or the catalog it reads), never a number restated
// here; the generator only chooses situations, and a clause it meant to break that the rule passes is a bug it throws on.

const AUDIT_DIVISION = "ISA Claims & Leases Division";
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const round2 = (v) => Math.round(v * 100) / 100;
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

/** A lease's building slots, read off the rule itself (leaseHasRoom), so the number lives in one place. */
const LEASE_SLOTS = (() => {
  let k = 0;
  while (k < 100 && leaseHasRoom({ extractorIds: Array(k).fill("yard") })) k += 1;
  return k;
})();
/** Every body the registry leases, with its price (purchase-lease charges data/systems.json's leaseCost). */
const LEASE_BODIES = SYSTEMS_DATA.flatMap((s) => (s.bodies || []).filter((b) => Number(b.leaseCost) > 0).map((b) => ({ system: s.name, body: b.name, cost: b.leaseCost })));
const leaseCostOf = (f) => LEASE_BODIES.find((b) => b.body === f.body && b.system === f.system)?.cost;
const taxFor = (leasesHeld) => taxBreakdown({ basePct: ECONOMY.exchange.salesTaxPct, leasesHeld, royaltyPointsByLeasesHeld: ECONOMY.leases.royaltyPointsByLeasesHeld });
const conglomerateCap = (level) => CONGLOMERATE_CATALOG.levels[level - 1].maxMembers;
const BID_ITEMS = ECONOMY.npcBuyers.map((b) => ({ item: b.item, price: b.unitPrice }));

/**
 * Each clause: the tier it joins at, whether it has a near miss (compliant, right at the line), how a situation is drawn
 * for a role ("broken", "near" or "clean"), what the rule says of a situation ({ compliant, figure }: figure is what the
 * rule requires, null where it is a yes or no) and the rule in one sentence with its number. The order is the order a
 * filing lists them in, so a clause's place says nothing about whether it is broken.
 */
export const AUDIT_CLAUSES = Object.freeze({
  "lease-headcount": {
    tier: 1, near: true,
    draw: (rng, role) => {
      const leasesHeld = int(rng, 0, 4);
      const need = employeesForNextLease(leasesHeld);
      const employees = role === "broken" ? int(rng, Math.max(0, need - 5), need - 1) : role === "near" ? need : need + int(rng, 1, 8);
      return { leasesHeld, employees };
    },
    judge: (f) => { const need = employeesForNextLease(f.leasesHeld); return { compliant: f.employees >= need, figure: need }; },
    rule: (f) => { const need = employeesForNextLease(f.leasesHeld); return `A corporation filing its ${ordinal(f.leasesHeld + 1)} lease must employ at least ${need} people, ${need / (f.leasesHeld + 1)} for each lease it will hold.`; }
  },
  "office-before-lease": {
    tier: 1, near: false,
    draw: (rng, role) => ({ office: role === "broken" ? pick(["lapsed", "none"], rng) : "active" }),
    judge: (f) => {
      const corp = { offices: f.office === "none" ? [] : [{ stationId: "filing-station", rentedUntil: f.office === "active" ? 2 : 0 }] };
      return { compliant: Boolean(activeOfficeAt(corp, "filing-station", 1)), figure: null };
    },
    rule: () => "A lease may be filed only by a corporation with an active registered office at the station where it files; a lapsed office does not count."
  },
  "lease-slots": {
    tier: 1, near: true,
    draw: (rng, role) => ({ buildingsOnLease: role === "broken" ? LEASE_SLOTS + int(rng, 0, 1) : role === "near" ? LEASE_SLOTS - 1 : int(rng, 0, Math.max(0, LEASE_SLOTS - 2)) }),
    judge: (f) => ({ compliant: leaseHasRoom({ extractorIds: Array(f.buildingsOnLease).fill("yard") }), figure: LEASE_SLOTS }),
    rule: (f) => `A lease has ${LEASE_SLOTS} building slots, and this one already holds ${f.buildingsOnLease}.`
  },
  "lease-price": {
    tier: 1, near: false,
    draw: (rng, role) => {
      const b = pick(LEASE_BODIES, rng);
      const off = 5000 * int(rng, 1, 3);
      const declaredPrice = role === "broken" ? (b.cost > off && rng() < 0.5 ? b.cost - off : b.cost + off) : b.cost;
      return { body: b.body, system: b.system, declaredPrice };
    },
    judge: (f) => { const cost = leaseCostOf(f); return { compliant: f.declaredPrice === cost, figure: cost }; },
    rule: (f) => `The registry prices a lease on ${f.body} at ${leaseCostOf(f)} credits.`
  },
  "itc-line": {
    tier: 2, near: true,
    draw: (rng, role) => {
      const { item, price } = pick(BID_ITEMS, rng);
      const normalValue = Math.max(2, Math.round(price * (0.9 + rng() * 0.4)));
      const line = (normalValue * WARFARE_CATALOG.dumping.priceThresholdPct) / 100;
      let unitPrice;
      if (role === "broken") unitPrice = Math.min(round2(line * (0.6 + rng() * 0.35)), Math.floor(line * 100 - 1) / 100);
      else if (role === "near") unitPrice = Math.ceil(line * 100) / 100;
      else unitPrice = round2(normalValue * (0.95 + rng() * 0.3));
      return { item, normalValue, unitPrice };
    },
    judge: (f) => { const line = (f.normalValue * WARFARE_CATALOG.dumping.priceThresholdPct) / 100; return { compliant: f.unitPrice >= line - 1e-9, figure: round2(line) }; },
    rule: (f) => `The ITC line is ${WARFARE_CATALOG.dumping.priceThresholdPct}% of normal value: at a normal value of ${f.normalValue} a unit, a sale below ${round2((f.normalValue * WARFARE_CATALOG.dumping.priceThresholdPct) / 100)} counts toward a dumping finding.`
  },
  "lease-royalty": {
    tier: 2, near: false,
    draw: (rng, role) => {
      let leasesHeld = int(rng, 0, 6);
      while (role === "broken" && !(taxFor(leasesHeld).royaltyPoints > 0)) leasesHeld = int(rng, 1, 6);
      const gross = int(rng, 20, 400) * 100;
      const pct = role === "broken" ? taxFor(leasesHeld).basePct : taxFor(leasesHeld).ratePct;
      return { leasesHeld, gross, declaredTax: Math.round((gross * pct) / 100) };
    },
    judge: (f) => { const tax = Math.round((f.gross * taxFor(f.leasesHeld).ratePct) / 100); return { compliant: f.declaredTax === tax, figure: tax }; },
    rule: (f) => {
      const t = taxFor(f.leasesHeld);
      return `Exchange tax is the ${t.basePct}% sales tax plus the lease royalty, ${t.royaltyPoints} points for ${f.leasesHeld} leases held: ${t.ratePct}% of ${f.gross} is ${Math.round((f.gross * t.ratePct) / 100)} credits.`;
    }
  },
  "order-quota": {
    tier: 2, near: true,
    draw: (rng, role) => {
      const { item } = pick(BID_ITEMS, rng);
      const dailyQuota = bidQuotaFor(item);
      const soldToday = Math.floor(dailyQuota * rng() * 0.9);
      const room = dailyQuota - soldToday;
      const units = role === "broken" ? room + int(rng, 1, Math.max(1, Math.floor(dailyQuota / 10))) : role === "near" ? room : int(rng, 1, Math.max(1, room - 1));
      return { item, dailyQuota, soldToday, units };
    },
    judge: (f) => { const room = bidQuotaFor(f.item) - f.soldToday; return { compliant: f.units <= room, figure: room }; },
    rule: (f) => `A standing order for ${f.item} buys at most ${bidQuotaFor(f.item)} units a day; with ${f.soldToday} sold today, ${bidQuotaFor(f.item) - f.soldToday} more may be filed.`
  },
  "yard-price": {
    tier: 3, near: true,
    draw: (rng, role) => {
      const kit = ECONOMY.buildings.extractorYardsInStartingKit;
      const yardsOwned = role === "broken" ? int(rng, kit, kit + 5) : role === "near" ? Math.max(0, kit - 1) : int(rng, 0, kit + 5);
      const declaredPrice = role === "broken" ? ECONOMY.buildings.extractorYardCost : nextYardPrice(yardsOwned, ECONOMY.buildings);
      return { yardsOwned, declaredPrice };
    },
    judge: (f) => { const price = nextYardPrice(f.yardsOwned, ECONOMY.buildings); return { compliant: f.declaredPrice === price, figure: price }; },
    rule: (f) => {
      const b = ECONOMY.buildings;
      return `An extractor yard costs ${b.extractorYardCost} for each of the first ${b.extractorYardsInStartingKit}, and each after that ${b.extractorYardPriceGrowth} times the one before, to the nearest thousand: the ${ordinal(f.yardsOwned + 1)} costs ${nextYardPrice(f.yardsOwned, b)}.`;
    }
  },
  "upgrade-tier": {
    tier: 3, near: true,
    draw: (rng, role) => {
      // The ladder raises maxUpgradeTier from 1 to 7 (data/milestones.json); a request is for tier 2 or above.
      const maxUpgradeTier = role === "broken" ? int(rng, 1, 7) : role === "near" ? int(rng, 2, 7) : int(rng, 3, 7);
      const requestedTier = role === "broken" ? maxUpgradeTier + int(rng, 1, 2) : role === "near" ? maxUpgradeTier : int(rng, 2, maxUpgradeTier - 1);
      return { maxUpgradeTier, requestedTier };
    },
    judge: (f) => ({ compliant: f.requestedTier <= f.maxUpgradeTier, figure: f.maxUpgradeTier }),
    rule: (f) => `A corporation may upgrade a building only as far as its level allows, here to tier ${f.maxUpgradeTier}.`
  },
  deployments: {
    tier: 3, near: true,
    draw: (rng, role) => {
      // The ladder raises maxDeployments from 1 to 3 (data/milestones.json).
      const maxDeployments = role === "clean" ? int(rng, 2, 3) : int(rng, 1, 3);
      const activeExpeditions = role === "broken" ? maxDeployments : role === "near" ? maxDeployments - 1 : int(rng, 0, maxDeployments - 2);
      return { maxDeployments, activeExpeditions };
    },
    judge: (f) => ({ compliant: f.activeExpeditions < f.maxDeployments, figure: f.maxDeployments }),
    rule: (f) => `A corporation may run at most ${f.maxDeployments} expeditions at once, and this one already runs ${f.activeExpeditions}.`
  },
  "conglomerate-cap": {
    tier: 3, near: true,
    draw: (rng, role) => {
      const level = int(rng, 1, CONGLOMERATE_CATALOG.levels.length);
      const cap = conglomerateCap(level);
      const members = role === "broken" ? cap : role === "near" ? cap - 1 : int(rng, 1, cap - 2);
      return { level, members };
    },
    judge: (f) => ({ compliant: f.members < conglomerateCap(f.level), figure: conglomerateCap(f.level) }),
    rule: (f) => `A level-${f.level} conglomerate holds at most ${conglomerateCap(f.level)} members, and this one already has ${f.members}.`
  }
});

const AUDIT_KINDS = Object.keys(AUDIT_CLAUSES);
/** How many clauses a filing at each tier lists, how many of them are near misses, and whether figures are asked. */
const AUDIT_SHAPE = Object.freeze({
  1: { question: "clause", fields: 3, near: 0, figures: false, maxBroken: 1 },
  2: { question: "clause-and-figure", fields: 6, near: 1, figures: true, maxBroken: 1 },
  3: { question: "clauses-and-figures", fields: 10, near: 2, figures: true, maxBroken: 2 }
});
const APPLICANTS = (NPC_CATALOG?.corporations || []).map((c) => c.name);

function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * An Audit packet at `tier` from `seed`: { packet, key }. In auditCleanSharePct of filings no clause is broken; at tier 3
 * auditTwoClauseSharePct of the rest break two. Pure: the same seed and tier give the same packet.
 */
export function generateAudit({ seed, tier, rules = ECONOMY.desk } = {}) {
  const shape = AUDIT_SHAPE[tier];
  if (!shape) return null;
  const rng = deskRng(`audit:${tier}:${seed}`);
  const brokenCount = rng() * 100 < rules.auditCleanSharePct ? 0 : shape.maxBroken > 1 && rng() * 100 < rules.auditTwoClauseSharePct ? 2 : 1;
  const kinds = shuffled(AUDIT_KINDS.filter((k) => AUDIT_CLAUSES[k].tier <= tier), rng);
  const near = kinds.filter((k) => AUDIT_CLAUSES[k].near).slice(0, shape.near);
  const rest = kinds.filter((k) => !near.includes(k));
  const roles = Object.fromEntries([
    ...near.map((k) => [k, "near"]),
    ...rest.slice(0, brokenCount).map((k) => [k, "broken"]),
    ...rest.slice(brokenCount, shape.fields - shape.near).map((k) => [k, "clean"])
  ]);
  const fields = AUDIT_KINDS.filter((k) => roles[k]).map((clause) => {
    const facts = AUDIT_CLAUSES[clause].draw(rng, roles[clause]);
    if (AUDIT_CLAUSES[clause].judge(facts).compliant !== (roles[clause] !== "broken")) throw new Error(`desk audit: a ${roles[clause]} ${clause} clause drew ${JSON.stringify(facts)}, which its rule does not agree with`);
    return { clause, facts };
  });
  const applicant = APPLICANTS.length ? pick(APPLICANTS, rng) : "An applicant";
  const ref = `CLD-${String(Math.floor(rng() * 1_000_000)).padStart(6, "0")}`;
  const packet = {
    kind: "audit", tier, ref, division: AUDIT_DIVISION, question: shape.question,
    fee: rules.payByTier[tier - 1], points: rules.pointsByTier[tier - 1],
    applicant, fields, options: fields.map((f) => f.clause)
  };
  const broken = fields.filter((f) => roles[f.clause] === "broken").map((f) => ({ clause: f.clause, figure: AUDIT_CLAUSES[f.clause].judge(f.facts).figure, rule: AUDIT_CLAUSES[f.clause].rule(f.facts) }));
  const ruleOf = Object.fromEntries(fields.map((f) => [f.clause, AUDIT_CLAUSES[f.clause].rule(f.facts)]));
  const key = { kind: "audit", tier, ref, applicant, figures: shape.figures, broken, rules: ruleOf };
  return { packet, key };
}

/**
 * Grade an answer to an Audit against its stored key: { correct, explanation }. An answer certifies the filing
 * ({ compliant: true }) or names the broken clauses ({ clauses: [...] }), with, from tier 2, the figure each rule requires
 * ({ figures: { <clause>: number } }; none for a clause that is a yes or no). Anything malformed is incorrect.
 */
export function gradeAudit(key, answer) {
  if (!key || key.kind !== "audit" || !Array.isArray(key.broken)) return { correct: false, explanation: "" };
  // The broken clauses' rules, then the rule of any clause the answer named that meets it: a wrong call is answered by
  // the rule it misread, not by a penalty.
  const misread = (Array.isArray(answer?.clauses) ? answer.clauses : []).filter((c) => typeof c === "string" && key.rules?.[c] && !key.broken.some((b) => b.clause === c));
  const explanation = [
    key.broken.length ? key.broken.map((b) => b.rule).join(" ") : "The filing is compliant: every clause meets its rule.",
    ...[...new Set(misread)].map((c) => `${key.rules[c]} That clause meets it.`)
  ].join(" ");
  const result = (correct) => ({ correct, explanation });
  if (!answer || typeof answer !== "object") return result(false);
  if (answer.compliant === true) return result(key.broken.length === 0 && (answer.clauses === undefined || (Array.isArray(answer.clauses) && answer.clauses.length === 0)));
  const named = answer.clauses;
  if (!Array.isArray(named) || !named.length || !named.every((c) => typeof c === "string") || new Set(named).size !== named.length) return result(false);
  if (named.length !== key.broken.length || !key.broken.every((b) => named.includes(b.clause))) return result(false);
  if (!key.figures) return result(true);
  return result(key.broken.every((b) => {
    if (b.figure === null) return true;
    const v = answer.figures?.[b.clause];
    return typeof v === "number" && Number.isFinite(v) && Math.abs(v - b.figure) < 0.005;
  }));
}

// ─── Dispatch (GEX Routing Desk, section 5) ──────────────────────────────────────────────────────────────────────────
//
// The truth is the Logistics tab's own fee and transit (server/transfers.js) and the standing bid (npcBidFor over the
// order's rule). Fees are per unit, so the cheapest fill takes the lots cheapest delivered unit first; a grader costs a
// plan from the unit costs in its key and compares it with that minimum, so any plan that ties the minimum is right.

const DISPATCH_DIVISION = "GEX Routing Desk";
const DISPATCH_SHAPE = Object.freeze({
  1: { question: "fee-and-transit" },
  2: { question: "cheapest-fill", lots: 3 },
  3: { question: "deadline-fill-and-margin", lots: 5 }
});
const withinPct = (value, truth, pct) => typeof value === "number" && Number.isFinite(value) && Math.abs(value - truth) <= (Math.abs(truth) * pct) / 100 + 1e-9;
const stationRef = (s) => ({ id: s.id, name: s.name, systemId: s.systemId });

/** `count` distinct stations from the registry, every one with a route to the first. */
function drawStations(stations, rng, count) {
  for (let tries = 0; tries < MAX_DRAWS; tries += 1) {
    const picked = shuffled(stations, rng).slice(0, count);
    if (picked.length === count && picked.slice(1).every((s) => jumpsBetween(s.id, picked[0].id) !== null)) return picked;
  }
  return null;
}

/** The cheapest way to take `quantity` from `lots` ({ id, available, unitCost }): cheapest delivered unit first; null when they cannot fill it. */
function cheapestFill(lots, quantity) {
  const take = {};
  let left = quantity, cost = 0;
  for (const lot of [...lots].sort((a, b) => a.unitCost - b.unitCost || (a.id < b.id ? -1 : 1))) {
    const n = Math.min(left, lot.available);
    if (n > 0) { take[lot.id] = n; cost += n * lot.unitCost; left -= n; }
  }
  return left === 0 ? { take, cost } : null;
}

/** What a plan costs delivered, from the key's lots; null for a plan that is not a fill (unknown or overdrawn lot, a fraction, the wrong total). */
function planCost(lots, quantity, take) {
  if (!take || typeof take !== "object" || Array.isArray(take)) return null;
  let total = 0, cost = 0;
  for (const [id, n] of Object.entries(take)) {
    const lot = lots.find((l) => l.id === id);
    if (!lot || !Number.isInteger(n) || n < 0 || n > lot.available) return null;
    total += n;
    cost += n * lot.unitCost;
  }
  return total === quantity ? cost : null;
}

/** A Dispatch packet at `tier` from `seed`: { packet, key }, or null when the registry has no route to draw. Pure in its arguments and the registry's routes. */
export function generateDispatch({ seed, tier, stations = catalogStations(), rules = ECONOMY.desk } = {}) {
  const shape = DISPATCH_SHAPE[tier];
  if (!shape) return null;
  const rng = deskRng(`dispatch:${tier}:${seed}`);
  const ref = `GRD-${String(Math.floor(rng() * 1_000_000)).padStart(6, "0")}`;
  const base = { kind: "dispatch", tier, ref, division: DISPATCH_DIVISION, question: shape.question, fee: rules.payByTier[tier - 1], points: rules.pointsByTier[tier - 1], rates: { ...ECONOMY.logistics } };
  const items = BID_ITEMS.filter((b) => b.price >= 5);

  if (tier === 1) {
    const { item } = pick(items, rng);
    const route = drawStations(stations, rng, 2);
    if (!route) return null;
    const [to, from] = route;
    const quantity = int(rng, 1, 40) * 10;
    const jumps = jumpsBetween(from.id, to.id);
    const packet = { ...base, item, quantity, from: stationRef(from), to: stationRef(to), jumps };
    const key = { kind: "dispatch", tier, ref, quantity, jumps, transferFee: transferFee(from.id, to.id, quantity), transitMinutes: transitTime(from.id, to.id), tolerancePct: rules.dispatchTolerancePct };
    return { packet, key };
  }

  for (let draw = 0; draw < MAX_DRAWS * 4; draw += 1) {
    // The item is drawn each time: at a high enough price the fee stops mattering, and no fill is worth asking about.
    const { item, price } = pick(items, rng);
    const route = drawStations(stations, rng, shape.lots + 1);
    if (!route) return null;
    const [at, ...sources] = route;
    const quantity = int(rng, 5, 30) * 10;
    const lots = sources.map((s, i) => {
      const unitPrice = Math.max(1, Math.round(price * (tier === 2 ? 0.9 + rng() * 0.6 : 0.4 + rng() * 0.45)));
      const available = Math.max(10, Math.round((quantity * (0.3 + rng() * 0.9)) / 10) * 10);
      return { id: `L${i + 1}`, station: stationRef(s), jumps: jumpsBetween(s.id, at.id), unitPrice, available, unitCost: unitPrice + transferFee(s.id, at.id, 1), transitMinutes: transitTime(s.id, at.id) };
    });
    let dueInHours = null, open = lots;
    if (tier === 3) {
      // A deadline that rules out at least one lot the cheapest fill would otherwise take.
      const times = [...new Set(lots.map((l) => l.transitMinutes))].sort((a, b) => a - b);
      if (times.length < 2) continue;
      dueInHours = Math.ceil(times[int(rng, 0, times.length - 2)] / 60);
      open = lots.filter((l) => l.transitMinutes <= dueInHours * 60);
      const unbounded = cheapestFill(lots, quantity);
      if (!unbounded || Object.keys(unbounded.take).every((id) => open.some((l) => l.id === id))) continue;
    }
    const best = cheapestFill(open, quantity);
    if (!best) continue;
    if (tier === 2) {
      // Only worth asking when the cheapest price on the sticker is not the cheapest delivered.
      const sticker = cheapestFill(lots.map((l) => ({ ...l, unitCost: l.unitPrice })), quantity);
      if (sticker && planCost(lots, quantity, sticker.take) === best.cost) continue;
    }
    const packet = { ...base, item, quantity, at: stationRef(at), lots: lots.map(({ unitCost, ...l }) => l) };
    const key = { kind: "dispatch", tier, ref, quantity, lots: lots.map((l) => ({ id: l.id, available: l.available, unitCost: l.unitCost, transitMinutes: l.transitMinutes })), minCost: best.cost, best: best.take };
    if (tier === 2) return { packet, key };
    const quota = bidQuotaFor(item);
    const soldToday = Math.floor(quota * rng() * 0.6);
    if (soldToday + quantity > quota) continue;
    const bid = npcBidFor(price, soldToday, bidRuleFor({ item }));
    const margin = quantity * bid - best.cost;
    if (!(margin > quantity * bid * 0.1)) continue;
    packet.dueInHours = dueInHours;
    packet.standingBid = { basePrice: price, soldToday, quota, driftAtFullQuotaPct: ECONOMY.npcBid.driftAtFullQuotaPct, floorPct: ECONOMY.npcBid.floorPct };
    return { packet, key: { ...key, dueInHours, bid, margin, tolerancePct: rules.dispatchTolerancePct } };
  }
  return null;
}

/** The graded receipt's sentence for a dispatch: the truth, and the rule it was graded by. */
function dispatchExplanation(key) {
  if (key.tier === 1) return `${key.quantity} units over ${key.jumps} jump${key.jumps === 1 ? "" : "s"} cost ${key.transferFee} credits to move and land in ${key.transitMinutes} minutes; a tier-1 dispatch is correct when both figures are within ${key.tolerancePct}%.`;
  const take = Object.entries(key.best).map(([id, n]) => `${n} from ${id}`).join(", ");
  const fill = `The cheapest delivered fill is ${take}, ${key.minCost} credits: a lot's delivered cost is its price plus the transfer fee from its station.`;
  if (key.tier === 2) return fill;
  return `${fill} Only lots that land within ${key.dueInHours} hours can fill it, and at a standing bid of ${key.bid} the margin is ${key.margin} credits; a tier-3 dispatch is correct when the fill is that cheap, meets the deadline and the margin is within ${key.tolerancePct}%.`;
}

/**
 * Grade an answer to a Dispatch against its stored key: { correct, explanation }. Tier 1 reads { transferFee,
 * transitMinutes }; tier 2 { take: { <lot id>: units } }; tier 3 that plus { margin }. Anything malformed is incorrect.
 */
export function gradeDispatch(key, answer) {
  if (!key || key.kind !== "dispatch" || !DISPATCH_SHAPE[key.tier]) return { correct: false, explanation: "" };
  const result = (correct) => ({ correct, explanation: dispatchExplanation(key) });
  if (!answer || typeof answer !== "object") return result(false);
  if (key.tier === 1) return result(withinPct(answer.transferFee, key.transferFee, key.tolerancePct) && withinPct(answer.transitMinutes, key.transitMinutes, key.tolerancePct));
  const cost = planCost(key.lots, key.quantity, answer.take);
  if (cost === null || cost > key.minCost) return result(false);
  // A plan that leans on a lot landing after the deadline misses it, however cheap.
  if (key.tier === 3 && key.lots.some((l) => l.transitMinutes > key.dueInHours * 60 && answer.take[l.id] > 0)) return result(false);
  return result(key.tier === 2 || withinPct(answer.margin, key.margin, key.tolerancePct));
}
