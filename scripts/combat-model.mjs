// ISP-164 (AB#858): the reference arithmetic for docs/design/v0.10-combat.md. Not game code: it is the spec's numbers
// as something that runs, so the doc's tables are reproducible (`npm run combat:model`) and the
// resolver story (ISP-168, AB#862) can test its own output against the same tables. No randomness anywhere.

/** Reference prices for the goods in a unit's cost: each product's NPC standing bid in data/economy.json. */
export const GOODS_PRICE = { 'Carbon Fibre Sheets': 21, 'Armour Plating': 118, 'Pressure Vessels': 129, 'Battery Cells': 123, 'Structural Alloys': 25 };

import fs from 'node:fs';

/**
 * The unit catalog, read from data/units.json (ISP-167, AB#861), the one copy the server loads too. `atk` is damage
 * per unit per round, `hp` is the damage a unit absorbs before it is lost, `acc` and `eva` meet in the hit fraction,
 * `supply` is what a unit counts towards the fleet size that upkeep is charged on.
 */
const FILE = JSON.parse(fs.readFileSync(new URL('../data/units.json', import.meta.url), 'utf8'));
export const UNITS = Object.fromEntries(FILE.units.map((u) => [u.id, {
  name: u.name, credits: u.credits, goods: u.goods, buildMin: u.buildMinutes, supply: u.supply, upkeep: u.upkeepPerDay,
  atk: u.attack, hp: u.hp, acc: u.accuracy, eva: u.evasion, mobile: true,
}]));
export const TYPES = Object.keys(UNITS);

/** Each unit is strong against exactly one other and weak against exactly one: lf > se > dt > at > ds > lf. */
export const STRONG_VS = Object.fromEntries(FILE.units.map((u) => [u.id, u.strongAgainst]));
export const STRONG = FILE.counters.strong, WEAK = FILE.counters.weak;
export function counter(a, b) {
  if (STRONG_VS[a] === b) return STRONG;
  if (STRONG_VS[b] === a) return WEAK;
  return 1;
}
export const hitFraction = (acc, eva) => acc / (acc + eva);
export const MAX_ROUNDS = 6;
/** Below this many units of a type (a fraction left by the arithmetic) the type is gone. */
export const GONE = 0.5;

export const value = (t) => UNITS[t].credits + Object.entries(UNITS[t].goods).reduce((a, [g, q]) => a + GOODS_PRICE[g] * q, 0);

/**
 * One battle. `a` and `d` are { type: count }; `mods` are per-side multipliers ({ atk, acc, eva }, 1 when absent:
 * research, CEO skills and readiness land here). Fire is simultaneous within a round and computed from the counts at
 * the start of it. Each type's fire is shared across the enemy's types by their share of the enemy's unit count, then
 * multiplied by the counter and the hit fraction. Returns the rounds and the rounded survivors.
 */
export function resolve(a, d, mods = {}) {
  const side = (c) => Object.fromEntries(TYPES.map((t) => [t, c[t] ?? 0]));
  let A = side(a), D = side(d);
  const ma = { atk: 1, acc: 1, eva: 1, ...(mods.a ?? {}) }, md = { atk: 1, acc: 1, eva: 1, ...(mods.d ?? {}) };
  const alive = (s) => TYPES.some((t) => s[t] >= GONE);
  const rounds = [];
  const damageOn = (shooters, sm, targets, tm) => {
    const total = TYPES.reduce((x, t) => x + (targets[t] >= GONE ? targets[t] : 0), 0);
    const dmg = Object.fromEntries(TYPES.map((t) => [t, 0]));
    if (!total) return dmg;
    for (const s of TYPES) {
      if (shooters[s] < GONE) continue;
      const fire = shooters[s] * UNITS[s].atk * sm.atk;
      for (const t of TYPES) {
        if (targets[t] < GONE) continue;
        dmg[t] += fire * (targets[t] / total) * counter(s, t) * hitFraction(UNITS[s].acc * sm.acc, UNITS[t].eva * tm.eva);
      }
    }
    return dmg;
  };
  for (let r = 1; r <= MAX_ROUNDS && alive(A) && alive(D); r++) {
    const onD = damageOn(A, ma, D, md), onA = damageOn(D, md, A, ma);
    const lostA = {}, lostD = {};
    for (const t of TYPES) {
      lostD[t] = Math.min(D[t], onD[t] / UNITS[t].hp);
      lostA[t] = Math.min(A[t], onA[t] / UNITS[t].hp);
    }
    for (const t of TYPES) { D[t] -= lostD[t]; A[t] -= lostA[t]; if (D[t] < GONE) D[t] = 0; if (A[t] < GONE) A[t] = 0; }
    rounds.push({ round: r, lostA, lostD, A: { ...A }, D: { ...D } });
  }
  const whole = (s) => Object.fromEntries(TYPES.map((t) => [t, Math.round(s[t])]));
  const winner = alive(A) && !alive(D) ? 'attacker' : alive(D) && !alive(A) ? 'defender' : 'draw';
  return { rounds, attacker: whole(A), defender: whole(D), winner };
}

export const worth = (s) => TYPES.reduce((x, t) => x + (s[t] ?? 0) * value(t), 0);
/** How many whole units of `t` a budget buys. */
export const buy = (t, budget) => Math.floor(budget / value(t));
/** A composition by budget shares, e.g. { ds: 0.5, lf: 0.5 }, in whole units. */
export function mix(shares, budget) {
  return Object.fromEntries(Object.entries(shares).map(([t, f]) => [t, Math.floor((budget * f) / value(t))]));
}

/** The exchange from the attacker's side: value it destroyed per credit it lost (higher is better; Infinity if it lost nothing). */
export function exchange(a, d) {
  const r = resolve(a, d);
  const lostA = worth(a) - worth(r.attacker), lostD = worth(d) - worth(r.defender);
  return { ...r, lostA, lostD, ratio: lostA ? lostD / lostA : Infinity };
}

// ─── upkeep (T-018) ──────────────────────────────────────────────────────────────────────────────────────────────
/** Daily upkeep: the units' base upkeep, scaled up by how far the fleet's supply S is past the corporation's logistics capacity K. */
export const upkeepPerDay = (base, S, K) => base * (1 + (S / K) ** 2);
export const K_PER_SHIPYARD_LEVEL = 40;

/** Candidate compositions for the best-response table: every pure one, and every even pair. */
export function candidates(mobileOnly) {
  const ts = TYPES.filter((t) => !mobileOnly || UNITS[t].mobile);
  const out = ts.map((t) => ({ label: t, shares: { [t]: 1 } }));
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) out.push({ label: `${ts[i]}+${ts[j]}`, shares: { [ts[i]]: 0.5, [ts[j]]: 0.5 } });
  return out;
}
/** The attacker's best answer to a defending composition, and the defender's best answer to an attacking one, by exchange ratio. */
export function bestAttack(defShares, B) {
  const d = mix(defShares, B);
  return candidates(true).map((c) => ({ c, e: exchange(mix(c.shares, B), d) })).sort((x, y) => y.e.ratio - x.e.ratio)[0];
}
export function bestDefence(attShares, B) {
  const a = mix(attShares, B);
  return candidates(false).map((c) => ({ c, e: exchange(a, mix(c.shares, B)) })).sort((x, y) => x.e.ratio - y.e.ratio)[0];
}

if (process.argv[1]?.endsWith('combat-model.mjs')) {
  const f0 = (n) => Math.round(n).toLocaleString('en-GB');
  const r2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'inf');
  console.log('## Unit values (credits + goods at the NPC bid)');
  for (const t of TYPES) console.log(`${t}: ${f0(value(t))}`);
  for (const B of [30000, 120000, 480000]) {
    console.log(`\n## Pure against pure, budget ${f0(B)} each (attacker row, defender column: winner, exchange ratio)`);
    console.log('| attacker \ defender | ' + TYPES.join(' | ') + ' |');
    for (const a of TYPES.filter((t) => UNITS[t].mobile)) {
      console.log(`| ${a} | ` + TYPES.map((d) => { const e = exchange({ [a]: buy(a, B) }, { [d]: buy(d, B) }); return `${e.winner} ${r2(e.ratio)}`; }).join(' | ') + ' |');
    }
  }
  console.log('\n## Best responses (candidates: 5 pure + 10 even pairs; attackers cannot bring dt)');
  for (const B of [30000, 120000, 480000]) {
    for (const t of TYPES) {
      const ba = bestAttack({ [t]: 1 }, B);
      const bd = UNITS[t].mobile ? bestDefence({ [t]: 1 }, B) : null;
      console.log(`B ${f0(B)} | ${t} | attack it with ${ba.c.label} (${ba.e.winner}, ratio ${r2(ba.e.ratio)}) | ${bd ? `defend with ${bd.c.label} (${bd.e.winner}, ratio ${r2(bd.e.ratio)})` : 'cannot attack'}`);
    }
  }
  console.log('\n## Every candidate has an answer: the worst exchange each attacking composition meets (budget 120,000)');
  for (const c of candidates(true)) {
    const worst = candidates(false).map((o) => ({ o, e: exchange(mix(c.shares, 120000), mix(o.shares, 120000)) })).sort((x, y) => x.e.ratio - y.e.ratio)[0];
    console.log(`${c.label}: worst against ${worst.o.label}, ratio ${r2(worst.e.ratio)} (${worst.e.winner})`);
  }
  console.log('\n## Worked battle: 6 destroyers + 12 attack troops raid 14 light fighters + 10 defense troops');
  const wb = resolve({ ds: 6, at: 12 }, { lf: 14, dt: 10 });
  for (const r of wb.rounds) console.log(`round ${r.round}: attacker ${TYPES.filter((t) => r.A[t] || r.lostA[t]).map((t) => `${t} ${r.A[t].toFixed(2)} (-${r.lostA[t].toFixed(2)})`).join(', ')} | defender ${TYPES.filter((t) => r.D[t] || r.lostD[t]).map((t) => `${t} ${r.D[t].toFixed(2)} (-${r.lostD[t].toFixed(2)})`).join(', ')}`);
  console.log('result', wb.winner, JSON.stringify(wb.attacker), JSON.stringify(wb.defender));
  console.log('\n## Upkeep (T-018): fleet earning r = 45 a supply-day, base upkeep u = 20 a supply-day, K = 40 x shipyard level');
  for (const L of [1, 3]) {
    const K = K_PER_SHIPYARD_LEVEL * L;
    console.log(`shipyard level ${L} (K ${K})`);
    for (const S of [10, 20, 26, 30, 40, 60, 80, 100, 120].map((x) => Math.round(x * L))) {
      const up = upkeepPerDay(20 * S, S, K), earn = 45 * S;
      console.log(`S ${S}: earns ${f0(earn)}, upkeep ${f0(up)}, net ${f0(earn - up)}`);
    }
    console.log(`optimum S* = K sqrt((r/u - 1)/3) = ${(K * Math.sqrt((45 / 20 - 1) / 3)).toFixed(1)}`);
  }
}
