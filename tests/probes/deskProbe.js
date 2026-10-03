// tests/probes/deskProbe.js: the Desk's two probes (AB#4689 slice 10, docs/design/desk-work.md section 8). BOT NUMBERS
// (P-PROXY): bots answering generated packets, not players. What they cannot see: how long a person takes on a packet,
// whether a person finds the work interesting, and whether the tone lands.
//
// desk-mastery: two bots work the Desk for a simulated hour at each tier on the same packets. The random bot answers
// from the options at random; the rules-aware bot reads the document and the game's rules (the readings, the clause
// rules in AUDIT_CLAUSES, the rate card, the standing-bid rule) and never the key. Targets: the rules-aware bot earns at
// least three times the random bot's standing at every tier, and its lead grows at tier 2 and again at tier 3.
//
// desk-decisions: for each bot profile, the kind of packet that pays it best per minute, by each payoff (credits,
// standing, intel). Targets (design section 5): at least two distinct best kinds across profiles, and no kind best for
// every profile on every payoff. Its two assumptions are stated where they are made, for the PM or the Board to replace.

import { ECONOMY, npcBidFor } from "../../server/economy.js";
import { ensureBeltState } from "../../server/game/belts.js";
import { AUDIT_CLAUSES, deskRng, generateAudit, generateDispatch, generateSurvey, gradeAudit, gradeDispatch, gradeSurvey } from "../../server/game/desk.js";
import { DESK_KINDS } from "../../server/game/deskDraws.js";

const D = ECONOMY.desk;
const BELTS = ensureBeltState({}, 0).belts;
const CORP = { unlockedTech: [], currentSystemId: "sol" };
/** The design's bot pace (section 4): twenty packets an hour. */
export const PACKETS_PER_HOUR = 20;

const GENERATE = { survey: (seed, tier) => generateSurvey({ seed, tier, corp: CORP, belts: BELTS }), audit: (seed, tier) => generateAudit({ seed, tier }), dispatch: (seed, tier) => generateDispatch({ seed, tier }) };
const GRADE = { survey: gradeSurvey, audit: gradeAudit, dispatch: gradeDispatch };
const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const shuffled = (list, rng) => list.map((v) => [rng(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

// ─── The rules-aware bot: the document and the rules, never the key ───────────────────────────────────────────────

function readSurvey(p) {
  const mean = {};
  for (const r of p.readings) for (const [k, v] of Object.entries(r)) mean[k] = (mean[k] || 0) + v / p.readings.length;
  const ranked = Object.entries(mean).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (p.tier === 1) return { pick: ranked[0] };
  if (p.tier === 2) return { ranking: ranked.slice(0, 3) };
  const total = Object.values(mean).reduce((s, v) => s + v, 0);
  const share = Object.fromEntries(Object.entries(mean).map(([k, v]) => [k, (v / total) * 100]));
  const rarity = Object.entries(p.classProfiles).map(([tier, prof]) => {
    const keys = new Set([...Object.keys(share), ...Object.keys(prof)]);
    let d = 0;
    for (const k of keys) d += Math.abs((share[k] || 0) - (prof[k] || 0));
    return [tier, d];
  }).sort((a, b) => a[1] - b[1])[0][0];
  const reserve = p.reserveEstimates.reduce((s, v) => s + v, 0) / p.reserveEstimates.length;
  return { ranking: ranked.slice(0, 3), rarity, reserve };
}

function readAudit(p) {
  const broken = p.fields.filter((f) => !AUDIT_CLAUSES[f.clause].judge(f.facts).compliant);
  if (!broken.length) return { compliant: true };
  return { clauses: broken.map((f) => f.clause), figures: Object.fromEntries(broken.map((f) => [f.clause, AUDIT_CLAUSES[f.clause].judge(f.facts).figure]).filter(([, v]) => v !== null)) };
}

const feePerUnit = (rates, jumps) => rates.sameSystemFeePerUnit + rates.perJumpFeePerUnit * jumps;
const transit = (rates, jumps) => rates.sameSystemTransitMinutes + rates.perJumpTransitMinutes * jumps;
function fill(lots, quantity, costOf) {
  const take = {};
  let left = quantity, cost = 0;
  for (const lot of [...lots].sort((a, b) => costOf(a) - costOf(b))) {
    const n = Math.min(left, lot.available);
    if (n > 0) { take[lot.id] = n; cost += n * costOf(lot); left -= n; }
  }
  return { take, cost };
}
function readDispatch(p) {
  if (p.tier === 1) return { transferFee: feePerUnit(p.rates, p.jumps) * p.quantity, transitMinutes: transit(p.rates, p.jumps) };
  const open = p.tier === 3 ? p.lots.filter((l) => transit(p.rates, l.jumps) <= p.dueInHours * 60) : p.lots;
  const best = fill(open, p.quantity, (l) => l.unitPrice + feePerUnit(p.rates, l.jumps));
  if (p.tier === 2) return { take: best.take };
  const sb = p.standingBid;
  const bid = npcBidFor(sb.basePrice, sb.soldToday, { quotaPerDay: sb.quota, driftAtFullQuotaPct: sb.driftAtFullQuotaPct, floorPct: sb.floorPct });
  return { take: best.take, margin: p.quantity * bid - best.cost };
}
export const rulesAnswer = (p) => ({ survey: readSurvey, audit: readAudit, dispatch: readDispatch })[p.kind](p);

// ─── The random bot: an answer of the right shape, from what the document offers ───────────────────────────────────

export function randomAnswer(p, rng) {
  if (p.kind === "survey") {
    if (p.tier === 1) return { pick: pick(p.options, rng) };
    const ranking = shuffled(p.options, rng).slice(0, 3);
    return p.tier === 2 ? { ranking } : { ranking, rarity: pick(p.rarityOptions, rng), reserve: pick(p.reserveEstimates, rng) };
  }
  if (p.kind === "audit") {
    const choice = pick([...p.options, "compliant"], rng);
    if (choice === "compliant") return { compliant: true };
    const clauses = p.tier === 3 && rng() < 0.5 ? shuffled(p.options, rng).slice(0, 2) : [choice];
    const numbers = (f) => Object.values(f.facts).filter((v) => typeof v === "number");
    return { clauses, figures: Object.fromEntries(clauses.map((c) => [c, pick(numbers(p.fields.find((f) => f.clause === c)), rng) ?? 0])) };
  }
  if (p.tier === 1) return { transferFee: p.quantity * pick([2, 5, 8, 11, 14, 17, 20], rng), transitMinutes: pick([30, 150, 270, 390, 510, 630], rng) };
  const take = fill(p.lots, p.quantity, () => rng()).take;
  return p.tier === 2 ? { take } : { take, margin: Math.round(p.quantity * p.standingBid.basePrice * (0.2 + rng() * 0.6)) };
}

// ─── desk-mastery ────────────────────────────────────────────────────────────────────────────────────────────────────

/** One bot's hours at one tier: the same packets for every bot (seeded by tier, hour and packet), kinds in turn. */
export function workHours(bot, tier, hours) {
  let points = 0, credits = 0, correct = 0, n = 0;
  for (let h = 0; h < hours; h += 1) {
    const rng = deskRng(`probe-bot:${bot}:${tier}:${h}`);
    for (let i = 0; i < PACKETS_PER_HOUR; i += 1) {
      const kind = DESK_KINDS[i % DESK_KINDS.length];
      const { packet, key } = GENERATE[kind](`probe:${tier}:${h}:${i}`, tier);
      const answer = bot === "rules" ? rulesAnswer(packet) : randomAnswer(packet, rng);
      n += 1;
      if (GRADE[kind](key, answer).correct) {
        correct += 1;
        points += D.pointsByTier[tier - 1];
        credits += D.payByTier[tier - 1]; // twenty an hour is within the day's paid cap
      }
    }
  }
  return { points: points / hours, credits: credits / hours, correctPct: (100 * correct) / n };
}

/** Both bots at every tier: their standing an hour, the ratio and the lead. */
export function mastery(hours) {
  return [1, 2, 3].map((tier) => {
    const random = workHours("random", tier, hours);
    const rules = workHours("rules", tier, hours);
    return { tier, random, rules, ratio: random.points > 0 ? rules.points / random.points : Infinity, lead: rules.points - random.points };
  });
}

/** What failed of the mastery targets, as sentences; empty when they hold. */
export function masteryMisses(rows) {
  const misses = [];
  for (const r of rows) if (!(r.ratio >= 3)) misses.push(`tier ${r.tier}: the rules-aware bot earns ${r.ratio.toFixed(2)}x the random bot's standing, under 3x`);
  for (let i = 1; i < rows.length; i += 1) if (!(rows[i].lead > rows[i - 1].lead)) misses.push(`tier ${rows[i].tier}: the lead (${rows[i].lead.toFixed(1)} points) does not grow on tier ${rows[i - 1].tier}'s (${rows[i - 1].lead.toFixed(1)})`);
  return misses;
}

export function formatMastery(rows, hours) {
  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : "inf");
  return [
    `ISP desk-mastery probe (AB#4689). BOT NUMBERS (P-PROXY): bots working generated Desk packets for ${hours} simulated hour(s) per tier at ${PACKETS_PER_HOUR} an hour, not players.`,
    "tier  random: points/h  correct   rules-aware: points/h  correct   ratio   lead",
    ...rows.map((r) => `  ${r.tier}    ${fmt(r.random.points).padStart(14)}  ${fmt(r.random.correctPct).padStart(6)}%   ${fmt(r.rules.points).padStart(19)}  ${fmt(r.rules.correctPct).padStart(6)}%   ${fmt(r.ratio).padStart(5)}  ${fmt(r.lead).padStart(5)}`)
  ].join("\n");
}

// ─── desk-decisions ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ASSUMPTION 1 (no source: the design says only "a minute or three to read"): the minutes a packet takes are one plus a
 * tenth of the numbers its document holds, so a longer document takes longer to work.
 */
export function minutesFor(packet) {
  let numbers = 0;
  const walk = (v) => { if (typeof v === "number") numbers += 1; else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk({ ...packet, fee: 0, points: 0, tier: 0 });
  return 1 + numbers / 10;
}

/**
 * ASSUMPTION 2 (the design's section 5 table): what each profile values. A scouted belt is worth a probe's build cost
 * in intel ("a scouted belt saves an 8,000 probe's trip"); the profiles are the runway probe's planner, greedy and
 * reserve, plus the design's scout. Weights are credits, standing points and intel credits.
 */
export const PROFILES = Object.freeze({
  planner: { credits: 1, standing: 200, intel: 0 },
  greedy: { credits: 1, standing: 0, intel: 0 },
  reserve: { credits: 1, standing: 0, intel: 0 },
  scout: { credits: 1, standing: 0, intel: 1 }
});

/** Per kind at a tier, worked by the rules-aware bot: credits, standing and intel per minute. */
export function payoffsByKind(tier, samples) {
  const out = {};
  for (const kind of DESK_KINDS) {
    let minutes = 0, credits = 0, standing = 0, intel = 0;
    for (let i = 0; i < samples; i += 1) {
      const { packet, key } = GENERATE[kind](`decide:${tier}:${kind}:${i}`, tier);
      minutes += minutesFor(packet);
      if (!GRADE[kind](key, rulesAnswer(packet)).correct) continue;
      credits += D.payByTier[tier - 1];
      standing += D.pointsByTier[tier - 1];
      if (kind === "survey" && tier >= 2 && key.subject.beltKey) intel += ECONOMY.probes.buildCost;
    }
    out[kind] = { credits: credits / minutes, standing: standing / minutes, intel: intel / minutes };
  }
  return out;
}

/** The best kind for each profile (weighted) and for each payoff alone, at a tier. */
export function decisions(tier, samples) {
  const pay = payoffsByKind(tier, samples);
  const best = (score) => DESK_KINDS.map((k) => [k, score(pay[k])]).sort((a, b) => b[1] - a[1])[0][0];
  const byProfile = Object.fromEntries(Object.entries(PROFILES).map(([name, w]) => [name, best((p) => w.credits * p.credits + w.standing * p.standing + w.intel * p.intel)]));
  const byPayoff = Object.fromEntries(["credits", "standing", "intel"].map((k) => [k, best((p) => p[k])]));
  return { tier, pay, byProfile, byPayoff };
}

/** What failed of the decision targets, as sentences; empty when they hold. */
export function decisionMisses(rows) {
  const misses = [];
  for (const r of rows) {
    const distinct = new Set(Object.values(r.byProfile));
    if (distinct.size < 2) misses.push(`tier ${r.tier}: one kind (${[...distinct][0]}) is best for every profile`);
    const everywhere = DESK_KINDS.filter((k) => Object.values(r.byProfile).every((b) => b === k) && Object.values(r.byPayoff).every((b) => b === k));
    if (everywhere.length) misses.push(`tier ${r.tier}: ${everywhere[0]} is best for every profile on every payoff`);
  }
  return misses;
}

export function formatDecisions(rows, samples) {
  const f = (n) => n.toFixed(2);
  return [
    `ISP desk-decisions probe (AB#4689). BOT NUMBERS (P-PROXY): the rules-aware bot over ${samples} packets of each kind per tier, with two stated assumptions (minutes per packet, profile weights), not players.`,
    ...rows.flatMap((r) => [
      `tier ${r.tier}: per minute  ${DESK_KINDS.map((k) => `${k} ${f(r.pay[k].credits)} cr / ${f(r.pay[k].standing)} pts / ${f(r.pay[k].intel)} intel`).join("  |  ")}`,
      `        best by profile  ${Object.entries(r.byProfile).map(([p, k]) => `${p}: ${k}`).join(", ")};  best by payoff  ${Object.entries(r.byPayoff).map(([p, k]) => `${p}: ${k}`).join(", ")}`
    ])
  ].join("\n");
}
