// server/game/combat.js: the combat resolver (ISP-168, AB#862), docs/design/v0.10-combat.md section 4.
//
// resolveBattle is pure: it reads its arguments and the unit catalog and nothing else. No state, no I/O, no clock and
// no dice, so the same two forces always fight the same battle, and every matchup can be tested exhaustively. The
// counters (section 2) are the whole of the tactical decision; accuracy and evasion only shade it (section 3).

import { UNITS, UNITS_DATA, UNIT_IDS } from "./units.js";

/** Six rounds, then a draw and the attacker withdraws (OGame's limit; section 4). */
export const MAX_ROUNDS = 6;
/** A unit type with fewer than this many units left (a fraction the arithmetic leaves) is gone. */
export const GONE = 0.5;
/** A side's multipliers when none are given. Research and CEO bonuses (ISP-169) and readiness (ISP-173) set them. */
export const NEUTRAL_MODIFIERS = Object.freeze({ attack: 1, accuracy: 1, evasion: 1 });

/** Section 2: 2 when `shooter` preys on `target`, 0.5 when `target` preys on `shooter`, 1 otherwise. */
export function counterMultiplier(shooter, target, units = UNITS, counters = UNITS_DATA.counters) {
  if (units[shooter].strongAgainst === target) return counters.strong;
  if (units[target].strongAgainst === shooter) return counters.weak;
  return 1;
}

/** Section 3: the share of a shot's damage that lands, as expected damage. No roll. */
export const hitFraction = (accuracy, evasion) => accuracy / (accuracy + evasion);

/** A force as a count for every unit type. Refuses a unit the catalog lacks, or a count that is not a number ≥ 0. */
function forceOf(force, side) {
  const out = Object.fromEntries(UNIT_IDS.map((id) => [id, 0]));
  for (const [id, n] of Object.entries(force || {})) {
    if (!UNIT_IDS.includes(id)) throw new Error(`${side}: "${id}" is not a unit (data/units.json).`);
    if (!(typeof n === "number" && Number.isFinite(n) && n >= 0)) throw new Error(`${side}: ${id} should be a count of at least 0.`);
    out[id] = n;
  }
  return out;
}

function modifiersOf(m, side) {
  const out = { ...NEUTRAL_MODIFIERS };
  for (const key of Object.keys(NEUTRAL_MODIFIERS)) {
    if (m?.[key] == null) continue;
    if (!(typeof m[key] === "number" && Number.isFinite(m[key]) && m[key] > 0)) throw new Error(`${side} modifier ${key} should be a number above 0.`);
    out[key] = m[key];
  }
  return out;
}

const alive = (force) => UNIT_IDS.some((id) => force[id] >= GONE);

/** The damage `shooters` deal each of `targets`' unit types in one round, from the counts at the start of it. */
function damageDealt(shooters, shooterMods, targets, targetMods) {
  const damage = Object.fromEntries(UNIT_IDS.map((id) => [id, 0]));
  const total = UNIT_IDS.reduce((sum, id) => sum + (targets[id] >= GONE ? targets[id] : 0), 0);
  if (!total) return damage;
  for (const s of UNIT_IDS) {
    if (shooters[s] < GONE) continue;
    const fire = shooters[s] * UNITS[s].attack * shooterMods.attack;
    for (const t of UNIT_IDS) {
      if (targets[t] < GONE) continue;
      damage[t] += fire
        * (targets[t] / total) // fire is shared by head-count, as OGame's random targeting is on average
        * counterMultiplier(s, t)
        * hitFraction(UNITS[s].accuracy * shooterMods.accuracy, UNITS[t].evasion * targetMods.evasion);
    }
  }
  return damage;
}

/**
 * One battle. `attacker` and `defender` are counts by unit id ({ lf: 14, dt: 10 }); `modifiers` is
 * { attacker, defender }, each { attack, accuracy, evasion } multipliers, neutral (1) when left out.
 *
 * Returns { winner, rounds, survivors, exact }: the winner is "attacker", "defender" or "draw"; each round has the
 * units each side lost and has left, unrounded; survivors are whole units (a half rounds up, in the survivor's
 * favour) and exact the unrounded counts after the last round. The arguments are not changed.
 */
export function resolveBattle(attacker, defender, modifiers = {}) {
  const A = forceOf(attacker, "attacker");
  const D = forceOf(defender, "defender");
  const ma = modifiersOf(modifiers.attacker, "attacker");
  const md = modifiersOf(modifiers.defender, "defender");
  const rounds = [];
  for (let round = 1; round <= MAX_ROUNDS && alive(A) && alive(D); round += 1) {
    const onD = damageDealt(A, ma, D, md);
    const onA = damageDealt(D, md, A, ma);
    const lostA = {}, lostD = {};
    for (const id of UNIT_IDS) {
      lostA[id] = Math.min(A[id], onA[id] / UNITS[id].hp);
      lostD[id] = Math.min(D[id], onD[id] / UNITS[id].hp);
    }
    for (const id of UNIT_IDS) {
      A[id] -= lostA[id]; if (A[id] < GONE) A[id] = 0;
      D[id] -= lostD[id]; if (D[id] < GONE) D[id] = 0;
    }
    rounds.push({ round, attacker: { lost: lostA, remaining: { ...A } }, defender: { lost: lostD, remaining: { ...D } } });
  }
  const whole = (force) => Object.fromEntries(UNIT_IDS.map((id) => [id, Math.round(force[id])]));
  const winner = alive(A) && !alive(D) ? "attacker" : alive(D) && !alive(A) ? "defender" : "draw";
  return { winner, rounds, survivors: { attacker: whole(A), defender: whole(D) }, exact: { attacker: { ...A }, defender: { ...D } } };
}
