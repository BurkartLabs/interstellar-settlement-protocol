// ISP-270 (AB#966): the fleet composition tournament, and raid success against defence investment. The same shape as
// combatProbe.js (ISP-183), which checks the five pure compositions; this checks every mixed one on a stated grid.
//
// BOT NUMBERS (P-PROXY, DOCTRINE P-005). Compositions fight through the real resolver (server/game/combat.js
// resolveBattle), valued at replacement value (server/mercenaries.js unitValue: credits plus goods at the NPC bid, the
// combat design's "value"). Nobody chooses anything here: every composition meets every other, so a win rate is a share
// of a stated field, not how often anybody wins a fight they picked.
//
// THE RESOLVER HAS NO DICE (v0.10-combat.md section 4): the same two forces always fight the same battle. "Many times"
// is therefore many conditions, not many rolls: three budgets, both roles, and each side's modifiers from MODIFIER_SETS
// (research, readiness). Refighting one condition would only repeat its answer.
//
// THE GRID. Each composition splits a budget in quarters over the five units (70 splits), buying whole units of each
// with its share; the rounding is the design's own ("each composition bought in whole units", section 5). Troops (at,
// dt) are in the tournament, as in the design's section 5; the raid ladder uses what can actually raid (fleet units)
// against what can actually defend (all five).

import { resolveBattle } from "../../server/game/combat.js";
import { UNIT_IDS, UNITS } from "../../server/game/units.js";
import { FLEET_UNIT_IDS } from "../../server/fleets.js";
import { POSTURES, withPosture } from "../../server/garrison.js";
import { unitValue } from "../../server/mercenaries.js";

/** The design's three budgets (v0.10-combat.md section 5). */
export const BUDGETS = [30_000, 120_000, 480_000];
/** Quarters of the budget: 4 parts over the units. */
const PARTS = 4;
/**
 * A side's modifiers, the legal range the server gives (server/game/combat.js combatModifiersFor): research lifts
 * accuracy or evasion by 10%, readiness below full scales attack and accuracy (70% is a fleet a few days unpaid).
 */
export const MODIFIER_SETS = Object.freeze({
  neutral: { attack: 1, accuracy: 1, evasion: 1 },
  fireControl: { attack: 1, accuracy: 1.1, evasion: 1 },
  evasive: { attack: 1, accuracy: 1, evasion: 1.1 },
  tired: { attack: 0.7, accuracy: 0.7, evasion: 1 }
});
/** The target: no composition wins more than this share of its fights against the field. */
export const DOMINANCE_LIMIT = 0.6;
/** Defence investment as a multiple of the attacker's budget: the raid ladder's rungs. */
export const INVESTMENT_RUNGS = [0, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/**
 * "Fully invested": a defender who has spent on defence what the attacker spent on the raid, with every defensive lever
 * the game gives: fortified posture (server/garrison.js), Fire Control and Evasive Manoeuvres, full readiness. Beyond
 * parity a defender is out-spending the raid, not investing against it; the ladder prints those rungs too.
 */
export const FULL_INVESTMENT = { rung: 1, posture: "fortified", modifiers: { attack: 1, accuracy: 1.1, evasion: 1.1 } };

/** Every split of PARTS parts over `types`, as { type: parts }, zeros left out. */
export function splits(types, parts = PARTS) {
  const out = [];
  const walk = (i, left, acc) => {
    if (i === types.length - 1) {
      out.push(Object.fromEntries(Object.entries({ ...acc, [types[i]]: left }).filter(([, n]) => n > 0)));
      return;
    }
    for (let n = left; n >= 0; n -= 1) walk(i + 1, left - n, { ...acc, [types[i]]: n });
  };
  walk(0, parts, {});
  return out;
}

/** A split's name: "lf2 ds1 se1" is half the budget on fighters and a quarter each on destroyers and siege engines. */
export const nameOf = (split) => Object.entries(split).map(([t, n]) => `${t}${n}`).join(" ");

/** The whole units a split buys at `budget`. */
export function forceOf(split, budget, parts = PARTS) {
  return Object.fromEntries(Object.entries(split).map(([t, n]) => [t, Math.floor((budget * n) / parts / unitValue(t))]));
}

/**
 * The tournament: every composition on the grid against every other, both roles, at every budget and every pair of
 * modifier sets. Returns { compositions: [{ name, split, fights, wins, draws, losses, winRate }], fights, draws }.
 */
export function tournament({ budgets = BUDGETS, grid = splits(UNIT_IDS), modifierSets = MODIFIER_SETS } = {}) {
  const rows = grid.map((split) => ({ name: nameOf(split), split, fights: 0, wins: 0, draws: 0, losses: 0 }));
  const sets = Object.values(modifierSets);
  let fights = 0;
  for (const budget of budgets) {
    const forces = grid.map((s) => forceOf(s, budget));
    for (let a = 0; a < grid.length; a += 1) {
      for (let d = 0; d < grid.length; d += 1) {
        if (a === d) continue;
        for (const ma of sets) for (const md of sets) {
          const { winner } = resolveBattle(forces[a], forces[d], { attacker: ma, defender: md });
          fights += 1;
          rows[a].fights += 1; rows[d].fights += 1;
          if (winner === "draw") { rows[a].draws += 1; rows[d].draws += 1; }
          else if (winner === "attacker") { rows[a].wins += 1; rows[d].losses += 1; }
          else { rows[d].wins += 1; rows[a].losses += 1; }
        }
      }
    }
  }
  // Most battles between mixed fleets end in a draw after six rounds, so wins alone are a low bar: points (a draw
  // is half) are printed beside them, and would show a composition that never loses as well as one that wins.
  for (const r of rows) { r.winRate = r.wins / r.fights; r.points = (r.wins + r.draws / 2) / r.fights; }
  rows.sort((x, y) => y.winRate - x.winRate || x.name.localeCompare(y.name));
  return { budgets, sets: Object.keys(modifierSets), compositions: rows, fights, draws: rows.reduce((n, r) => n + r.draws, 0) / 2 };
}

/** The top quartile of the tournament, and which unit types appear in none of it. */
export function topQuartile(result) {
  const top = result.compositions.slice(0, Math.ceil(result.compositions.length / 4));
  const cutoff = top.at(-1).winRate;
  // A composition tied with the last one in is in too: a quartile cut through a tie is arbitrary.
  const inTop = result.compositions.filter((r) => r.winRate >= cutoff);
  const missing = UNIT_IDS.filter((t) => !inTop.some((r) => r.split[t]));
  return { top: inTop, cutoff, missing };
}

/**
 * Raid success against defence investment. At each rung the defender holds `rung x budget` of value in every grid
 * composition (all five units: garrison troops and its own fleets), and every raiding composition (fleet units only)
 * attacks it, over every pair of modifier sets, balanced posture. Success is an attacker win (a draw is a failed raid,
 * raids design section 2). Also the fully invested defender (FULL_INVESTMENT) against the same raiders.
 */
export function raidLadder({ budgets = BUDGETS, rungs = INVESTMENT_RUNGS, modifierSets = MODIFIER_SETS } = {}) {
  const raiders = splits([...FLEET_UNIT_IDS]);
  const defenders = splits(UNIT_IDS);
  const sets = Object.values(modifierSets);
  const lines = budgets.map((budget) => {
    const attackForces = raiders.map((s) => forceOf(s, budget));
    const points = rungs.map((rung) => {
      const defendForces = rung === 0 ? [{}] : defenders.map((s) => forceOf(s, budget * rung));
      let raids = 0, won = 0;
      for (const a of attackForces) for (const d of defendForces) for (const ma of sets) for (const md of sets) {
        raids += 1;
        if (resolveBattle(a, d, { attacker: ma, defender: md }).winner === "attacker") won += 1;
      }
      return { rung, raids, won, success: won / raids };
    });
    const full = (() => {
      const md = withPosture(FULL_INVESTMENT.modifiers, FULL_INVESTMENT.posture);
      const defendForces = defenders.map((s) => forceOf(s, budget * FULL_INVESTMENT.rung));
      let raids = 0, won = 0;
      for (const a of attackForces) for (const d of defendForces) for (const ma of sets) {
        raids += 1;
        if (resolveBattle(a, d, { attacker: ma, defender: md }).winner === "attacker") won += 1;
      }
      return { raids, won, success: won / raids };
    })();
    const falls = points.every((p, i) => i === 0 || p.success <= points[i - 1].success);
    const strictly = points.every((p, i) => i === 0 || p.success < points[i - 1].success);
    return { budget, points, full, falls, strictly };
  });
  return { raiders: raiders.length, defenders: defenders.length, lines };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const n0 = (x) => Math.round(x).toLocaleString("en-US");

/** The acceptance targets, each PASS or FAIL with its detail. Printed, never asserted (misses are filed). */
export function targets({ result, ladder }) {
  const best = result.compositions[0];
  const { missing, cutoff, top } = topQuartile(result);
  const notFalling = ladder.lines.filter((l) => !l.falls);
  const fullEnds = ladder.lines.filter((l) => l.full.success === 0 || l.full.success === 1);
  return [
    { target: `no composition wins more than ${pct(DOMINANCE_LIMIT)} of its fights against the field`, result: best.winRate <= DOMINANCE_LIMIT ? "PASS" : "FAIL", detail: `highest ${best.name} ${pct(best.winRate)}` },
    { target: "every unit type is in at least one top-quartile composition", result: missing.length ? "FAIL" : "PASS", detail: missing.length ? `missing ${missing.join(", ")} (top ${top.length}, cut at ${pct(cutoff)})` : `top ${top.length}, cut at ${pct(cutoff)}` },
    { target: "raid success falls monotonically as defence investment rises", result: notFalling.length ? "FAIL" : "PASS", detail: ladder.lines.map((l) => `${n0(l.budget)}: ${l.falls ? (l.strictly ? "strictly" : "never rises") : "rises somewhere"}`).join("; ") },
    { target: "a fully invested defender is never guaranteed safe or guaranteed lost", result: fullEnds.length ? "FAIL" : "PASS", detail: ladder.lines.map((l) => `${n0(l.budget)}: ${pct(l.full.success)} of ${n0(l.full.raids)} raids succeed`).join("; ") }
  ];
}

/** The report as text, headed with what it is (P-PROXY). */
export function formatReport({ result, ladder }) {
  const lines = [];
  lines.push("ISP fleet composition tournament (ISP-270, AB#966). BOT NUMBERS (P-PROXY): every composition on the grid meets every other; a win rate is a share of that field, not of fights anybody chose.");
  lines.push(`Grid: ${result.compositions.length} compositions (the budget in quarters over ${UNIT_IDS.join(", ")}), whole units at replacement value; budgets ${result.budgets.map(n0).join(", ")}; both roles; modifier sets ${result.sets.join(", ")} for each side. The resolver has no dice, so each condition is fought once: ${n0(result.fights)} battles, ${pct(result.draws / result.fights)} drawn.`);
  lines.push("");
  lines.push("Win rate against the field (wins over fights; a draw is not a win), best first, with points (a draw is half):");
  for (const r of result.compositions) lines.push(`  ${pct(r.winRate).padStart(6)}  ${r.name.padEnd(16)} won ${r.wins}, drew ${r.draws}, lost ${r.losses}; points ${pct(r.points)}`);
  const byPoints = [...result.compositions].sort((a, b) => b.points - a.points)[0];
  lines.push(`Most points: ${byPoints.name} ${pct(byPoints.points)}.`);
  const bestOf = (t) => result.compositions.findIndex((r) => r.split[t]) + 1;
  lines.push(`Best-placed composition with each unit (rank of ${result.compositions.length}): ${UNIT_IDS.map((t) => `${t} #${bestOf(t)}`).join(", ")}`);
  const { top, cutoff } = topQuartile(result);
  lines.push(`Top quartile (${top.length}, cut at ${pct(cutoff)}): unit types in it: ${UNIT_IDS.map((t) => `${t} ${top.filter((r) => r.split[t]).length}`).join(", ")}`);
  lines.push("");
  lines.push(`Raid ladder: ${ladder.raiders} raiding compositions (${FLEET_UNIT_IDS.join(", ")}) against ${ladder.defenders} defending ones (all five), every modifier pair, balanced posture. Success = attacker wins.`);
  lines.push(`  investment (x the raid's budget): ${INVESTMENT_RUNGS.join(" | ")}`);
  for (const l of ladder.lines) lines.push(`  ${n0(l.budget).padStart(7)}: ${l.points.map((p) => pct(p.success)).join(" | ")}`);
  lines.push(`  fully invested (${FULL_INVESTMENT.rung}x, ${FULL_INVESTMENT.posture}, Fire Control and Evasive Manoeuvres, full readiness): ${ladder.lines.map((l) => `${n0(l.budget)} ${pct(l.full.success)}`).join(", ")}`);
  lines.push("");
  for (const t of targets({ result, ladder })) lines.push(`${t.result.padEnd(5)} ${t.target}: ${t.detail}`);
  return lines.join("\n");
}

/** The raid ladder as an SVG line chart: success rate against investment, one line per budget. */
export function ladderSvg(ladder) {
  const W = 720, H = 420, L = 64, R = 150, T = 48, B = 56;
  const maxX = Math.max(...INVESTMENT_RUNGS);
  const x = (v) => L + (v / maxX) * (W - L - R);
  const y = (v) => T + (1 - v) * (H - T - B);
  const colours = ["#1f6feb", "#d97706", "#15803d"];
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${L}" y="24" font-size="15" font-weight="600">Raid success against defence investment (bot numbers, AB#966)</text>`);
  for (let v = 0; v <= 1.0001; v += 0.25) {
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" fill="#374151">${Math.round(v * 100)}%</text>`);
  }
  for (const r of INVESTMENT_RUNGS) {
    parts.push(`<line x1="${x(r)}" x2="${x(r)}" y1="${y(0)}" y2="${y(0) + 5}" stroke="#6b7280"/>`);
    parts.push(`<text x="${x(r)}" y="${y(0) + 18}" text-anchor="middle" fill="#374151">${r}</text>`);
  }
  parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#6b7280"/>`);
  parts.push(`<line x1="${L}" x2="${L}" y1="${y(0)}" y2="${y(1)}" stroke="#6b7280"/>`);
  parts.push(`<text x="${(L + W - R) / 2}" y="${H - 12}" text-anchor="middle" fill="#111827">defence investment, as a multiple of the raid's budget</text>`);
  parts.push(`<text x="16" y="${(T + H - B) / 2}" text-anchor="middle" fill="#111827" transform="rotate(-90 16 ${(T + H - B) / 2})">raids that succeed</text>`);
  parts.push(`<line x1="${x(FULL_INVESTMENT.rung)}" x2="${x(FULL_INVESTMENT.rung)}" y1="${y(0)}" y2="${y(1)}" stroke="#9ca3af" stroke-dasharray="4 4"/>`);
  ladder.lines.forEach((l, i) => {
    const c = colours[i % colours.length];
    parts.push(`<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${l.points.map((p) => `${x(p.rung).toFixed(1)},${y(p.success).toFixed(1)}`).join(" ")}"/>`);
    for (const p of l.points) parts.push(`<circle cx="${x(p.rung).toFixed(1)}" cy="${y(p.success).toFixed(1)}" r="3.5" fill="${c}"/>`);
    parts.push(`<rect x="${x(FULL_INVESTMENT.rung) - 5}" y="${y(l.full.success) - 5}" width="10" height="10" fill="none" stroke="${c}" stroke-width="2"/>`);
    parts.push(`<line x1="${W - R + 16}" x2="${W - R + 40}" y1="${T + 10 + i * 22}" y2="${T + 10 + i * 22}" stroke="${c}" stroke-width="2.5"/>`);
    parts.push(`<text x="${W - R + 46}" y="${T + 14 + i * 22}" fill="#111827">budget ${n0(l.budget)}</text>`);
  });
  parts.push(`<rect x="${W - R + 22}" y="${T + 10 + ladder.lines.length * 22 - 5}" width="10" height="10" fill="none" stroke="#111827" stroke-width="2"/>`);
  parts.push(`<text x="${W - R + 46}" y="${T + 14 + ladder.lines.length * 22}" fill="#111827">fully invested</text>`);
  parts.push(`<text x="${W - R + 46}" y="${T + 30 + ladder.lines.length * 22}" fill="#6b7280">(1x, fortified,</text>`);
  parts.push(`<text x="${W - R + 46}" y="${T + 44 + ladder.lines.length * 22}" fill="#6b7280">both research)</text>`);
  parts.push("</svg>");
  return parts.join("\n");
}

export { POSTURES, UNITS };
