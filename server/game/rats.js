// server/game/rats.js: Rats in asteroid fields, on the server (AB#820; docs/design/rats.md). The numbers are
// data/rats.json, checked when this module loads: the server does not start with a table it cannot use (fails closed).
//
// An expedition's encounters are drawn from a seed the server alone can make (an HMAC of the server's secret and the
// expedition's id), so nothing about them is stored before they happen and nothing a client sends can move them. The
// same seed gives the same encounters, the same fights and the same losses every time.
// - How many: Poisson with mean μ = (d/100)(T + T²/2τ) × deterrence (design section 1).
// - When: each at a share of the expedition, from the rising rate's inverse (the later an hour, the likelier).
// - What each costs an expedition without a holding escort: one roll on the unescorted table (section 4).
// - Each is fought by what is left of the escort through the combat resolver (section 3), against the belt's group,
//   larger for each later encounter (section 2).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { catalogueDir } from "./catalog.js";
import { UNITS } from "./units.js";
import { resolveBattle } from "./combat.js";

const FILE = path.join(catalogueDir, "rats.json");

/** Why `r` cannot be the Rats' table, as sentences; [] when it can. */
export function ratsTableProblems(r) {
  const out = [];
  const pos = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
  for (const k of ["hazardPerDensityHour", "attentionHours", "deterrence", "escortCostPerSupplyHour", "bountyPctOfValue", "quietHours", "quietRateFactor"]) if (!pos(r?.[k])) out.push(`${k} must be a positive number`);
  if (!(typeof r?.gathering === "number" && r.gathering >= 0)) out.push("gathering must be a number of at least 0");
  if (!Number.isInteger(r?.maxEncounters) || r.maxEncounters < 1) out.push("maxEncounters must be a whole number of at least 1");
  for (const id of ["lf", "ds"]) if (!pos(r?.groupPerDensity?.[id]) || !UNITS[id]) out.push(`groupPerDensity.${id} must be a positive number for a unit in the catalog`);
  for (const len of ["short", "standard", "extended"]) if (!pos(r?.lengthsHours?.[len])) out.push(`lengthsHours.${len} must be a positive number`);
  const rows = Array.isArray(r?.unescorted) ? r.unescorted : [];
  if (!rows.length || rows.some((x) => typeof x?.id !== "string" || !pos(x.chance) || !(x.haulLost > 0 && x.haulLost < 1))) out.push("unescorted must list rows of { id, chance, haulLost between 0 and 1 }");
  else if (Math.abs(rows.reduce((s, x) => s + x.chance, 0) - 1) > 1e-9) out.push("the unescorted chances must add to 1");
  return out;
}

export const RATS = (() => {
  const table = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const problems = ratsTableProblems(table);
  if (problems.length) throw new Error(`data/rats.json: ${problems.join("; ")}. The server does not start without a table it can use.`);
  return Object.freeze(table);
})();

const count = (v) => Math.max(0, Math.floor(Number(v) || 0));
/** A force's strength, Σ count × attack × hp (the deterrence and the launch screen compare these). */
export function forcePower(force = {}) {
  return Object.entries(force).reduce((s, [id, n]) => s + (UNITS[id] ? count(n) * UNITS[id].attack * UNITS[id].hp : 0), 0);
}
/** A force's supply, what provisions are charged on. */
export function forceSupply(force = {}) {
  return Object.entries(force).reduce((s, [id, n]) => s + (UNITS[id] ? count(n) * UNITS[id].supply : 0), 0);
}
/** A belt's Rat group from its system's pirate density: round(d/3) Light Fighters and floor(d/10) Destroyers. */
export function ratGroup(density) {
  const d = Math.max(0, Number(density) || 0);
  return { lf: Math.round(d * RATS.groupPerDensity.lf), ds: Math.floor(d * RATS.groupPerDensity.ds) };
}
/** The group the i-th encounter of one expedition meets (0 is the first): larger each time, as Rats gather. */
export function gatheredGroup(group, i) {
  return Object.fromEntries(Object.entries(group).map(([id, n]) => [id, Math.round(n * (1 + RATS.gathering * i))]));
}
/** How much an escort of `escortPower` lowers the rate: 1 / (1 + k × escort / group). */
export function deterrence(density, escortPower = 0) {
  const group = forcePower(ratGroup(density));
  return group > 0 && escortPower > 0 ? 1 / (1 + RATS.deterrence * escortPower / group) : 1;
}
/**
 * Encounters an expedition of `hours` expects (the Poisson mean). `factor` is the belt's: quietRateFactor for a belt
 * a hunt cleared (ISP-284, AB#991: server/hunts.js rateFactorFor), 1 otherwise.
 */
export function encounterRate(density, hours, escortPower = 0, factor = 1) {
  const T = Math.max(0, Number(hours) || 0);
  const exposure = T + (T * T) / (2 * RATS.attentionHours);
  const f = Number.isFinite(Number(factor)) ? Math.max(0, Number(factor)) : 1;
  return Math.max(0, Number(density) || 0) * RATS.hazardPerDensityHour * exposure * deterrence(density, escortPower) * f;
}
/** The chance of meeting Rats at least once, what the launch screen shows. */
export function encounterChance(density, hours, escortPower = 0, factor = 1) {
  return 1 - Math.exp(-encounterRate(density, hours, escortPower, factor));
}
/** The design's length in hours for an expedition duration id (the dev server's short runs use the same shape). */
export const nominalHours = (duration) => RATS.lengthsHours[duration] ?? RATS.lengthsHours.standard;

/** The seed for an expedition: an HMAC of the server's secret and its id. Throws without a secret (fails closed). */
export function seedFor(expeditionId, secret = process.env.ISP_RAT_SEED_SECRET || process.env.JWT_SECRET) {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("the Rats' seed needs a server secret");
  return crypto.createHmac("sha256", secret).update(`rats:${expeditionId}`).digest("hex");
}
/** A small deterministic generator from a hex seed (sfc32), returning numbers in [0, 1). */
function generator(seedHex) {
  let [a, b, c, d] = [0, 8, 16, 24].map((i) => parseInt(seedHex.slice(i, i + 8), 16) >>> 0);
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * The encounters a seed gives an expedition: [{ index, share, roll }], `share` the point of the expedition it happens
 * at (0 to 1), `roll` the unescorted table's row for it. Deterministic in its arguments.
 */
export function planEncounters(seedHex, density, hours, escortPower = 0, factor = 1) {
  const rng = generator(seedHex);
  const mu = encounterRate(density, hours, escortPower, factor);
  // Poisson by inversion: the first k at which the running total passes a uniform draw
  let k = 0, p = Math.exp(-mu), sum = p;
  const u = rng();
  while (u > sum && k < RATS.maxEncounters) { k += 1; p *= mu / k; sum += p; }
  const T = Math.max(0, Number(hours) || 0), tau = RATS.attentionHours;
  const whole = T + (T * T) / (2 * tau);
  const at = () => { // the rising rate's inverse: t with t + t²/2τ equal to a uniform share of the whole
    const c = rng() * whole;
    return T > 0 ? (-tau + Math.sqrt(tau * tau + 2 * tau * c)) / T : 0;
  };
  const shares = Array.from({ length: k }, at).sort((x, y) => x - y);
  return shares.map((share, index) => {
    let r = rng(), roll = RATS.unescorted[RATS.unescorted.length - 1];
    for (const row of RATS.unescorted) { if (r < row.chance) { roll = row; break; } r -= row.chance; }
    return { index, share, roll: roll.id };
  });
}

/** One encounter fought by `escort` against the Rats: { winner, held, lost, survivors, rounds } (the resolver's). */
export function fightEncounter(escort, group, modifiers = {}) {
  const battle = resolveBattle(escort, group, { attacker: modifiers });
  const lost = Object.fromEntries(Object.keys(escort).map((id) => [id, Math.max(0, count(escort[id]) - count(battle.survivors.attacker[id]))]).filter(([, n]) => n > 0));
  const round2 = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v).map(([id, v]) => [id, Math.round(v * 100) / 100]));
  return {
    winner: battle.winner,
    held: battle.winner !== "defender", // the Rats must beat the escort to reach the haul: a draw, they broke off
    lost,
    survivors: battle.survivors.attacker,
    rounds: battle.rounds.map((r) => ({ round: r.round, escortLost: round2(r.attacker.lost), ratsLost: round2(r.defender.lost) }))
  };
}

/** The unescorted table's row for an id. */
export const unescortedRow = (id) => RATS.unescorted.find((r) => r.id === id) || null;

/**
 * AB#821 (docs/design/rats.md, section 7): what the launch panel shows for a belt of `density`, a stay of `hours` and an
 * escort (units, or null for none) fighting with `modifiers`, from the functions the tick uses: the chance of meeting
 * Rats (encounterChance, with and without the escort), the chance the escort holds, the expected share of the haul
 * kept, and the provisions. Exact, not sampled: the resolver has no dice, so the escort holds the first `held`
 * encounters (fought in order, survivors carried on, as settleRats fights them) and loses the next; the count of
 * encounters is planEncounters' Poisson, capped at maxEncounters; and each encounter the escort does not hold keeps, on
 * average, the unescorted table's share of the haul. `factor` is the belt's rate factor (AB#991: a hunted belt is quiet),
 * the one launch fixes on the expedition.
 */
export function launchOutlook(density, hours, escort = null, modifiers = {}, factor = 1) {
  const units = escort ? Object.fromEntries(Object.entries(escort).filter(([, n]) => count(n) > 0)) : null;
  const power = units ? forcePower(units) : 0;
  const mu = encounterRate(density, hours, power, factor);
  // P(N = k) as planEncounters draws it: Poisson(mu), everything past the cap counted at the cap
  const pk = [];
  let p = Math.exp(-mu), below = 0;
  for (let k = 0; k < RATS.maxEncounters; k += 1) { pk.push(p); below += p; p *= mu / (k + 1); }
  pk.push(Math.max(0, 1 - below));
  let held = 0;
  if (units && Object.keys(units).length) {
    let left = { ...units };
    const group = ratGroup(density);
    for (let i = 0; i < RATS.maxEncounters && Object.keys(left).length; i += 1) {
      const fight = fightEncounter(left, gatheredGroup(group, i), modifiers);
      if (!fight.held) break;
      held += 1;
      left = Object.fromEntries(Object.entries(left).map(([id, n]) => [id, count(n) - count(fight.lost[id])]).filter(([, n]) => n > 0));
    }
  }
  const keptPerEncounter = RATS.unescorted.reduce((s, row) => s + row.chance * (1 - row.haulLost), 0);
  const holdChance = pk.reduce((s, q, k) => s + (k <= held ? q : 0), 0);
  const keptShare = pk.reduce((s, q, k) => s + q * keptPerEncounter ** Math.max(0, k - held), 0);
  return {
    chance: encounterChance(density, hours, power, factor), chanceUnescorted: encounterChance(density, hours, 0, factor),
    holdChance: units ? holdChance : null, held: units ? held : null, keptShare,
    provisions: units ? Math.round(RATS.escortCostPerSupplyHour * forceSupply(units) * hours) : 0
  };
}
