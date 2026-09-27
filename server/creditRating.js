// ISP-147 (AB#841): a credit rating for every corporation, from its own server-side financial history.
//
// docs/design/v0.9-debt.md, section 4, is the formula; data/credit-rating.json holds its weights, grade boundaries and
// caps, and a test reads both the design's table and that file (P-TWO-SOURCES). Every lender and investor in v0.9
// prices off this number, so it reads only what the server itself recorded: the corporation's closed daily statements
// (AB#713) and its debt, never a value from a request. A corporation with too little history, or history that cannot
// be read, is NR (not rated), which fails closed (section 3): never a good grade by default.
//
// computeCreditRating is pure: it is given the statements, so it reads no file and changes nothing. refreshCreditRating
// is what financialSnapshotTick calls every 30 seconds; it recomputes only when an input can have changed (a statement
// closed, payroll arrears began or ended, a loan or bond changed state), because the inputs change on those events and
// reading 30 statements from disk every 30 seconds buys nothing (section 4, "When it is computed").

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATING_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "credit-rating.json");
/** The design's table, as data: weights, grade boundaries and caps. */
export const RATING = Object.freeze(JSON.parse(fs.readFileSync(RATING_FILE, "utf8")));
export const GRADES = Object.freeze(RATING.grades.map((g) => g.grade)); // best first; NR is outside the scale
const DAY_MS = 86_400_000;

const clip = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : x > 0 ? 1 : 0);
const finite = (x) => typeof x === "number" && Number.isFinite(x);
/** A raw ratio as stored: a finite number, or null where it is unbounded (a denominator of zero). */
const raw = (x) => (Number.isFinite(x) ? Math.round(x * 10_000) / 10_000 : null);

/** A statement the formula can read: every field it uses is a finite number. */
function readable(st) {
  return st && finite(st.dayStart) && st.pnl && st.balanceSheet
    && ["totalIncome", "totalExpenses", "net"].every((k) => finite(st.pnl[k]))
    && ["credits", "totalAssets", "liabilities", "netWorth"].every((k) => finite(st.balanceSheet[k]));
}

/**
 * The corporation's debt instruments as the rating reads them: its loans (corp.loans, the borrower's side, section 1)
 * and any bonds it issued (`bonds`, passed in by the bond stories, as { outstandingFace, state, arrearsSince, defaultedAt }).
 * Each is { owed, state, arrearsSince, defaultedAt }.
 */
function instruments(corp, bonds = []) {
  const loans = Array.isArray(corp?.loans) ? corp.loans : [];
  const live = (s) => s === "active" || s === "arrears" || s === "defaulted";
  return [
    ...loans.map((l) => ({ owed: live(l?.state) ? Math.max(0, Number(l.balance) || 0) + Math.max(0, Number(l.arrears) || 0) : 0, state: l?.state, arrearsSince: l?.arrearsSince ?? null, defaultedAt: l?.defaultedAt ?? l?.closedAt ?? null })),
    ...(Array.isArray(bonds) ? bonds : []).map((b) => ({ owed: live(b?.state) ? Math.max(0, Number(b.outstandingFace) || 0) : 0, state: b?.state, arrearsSince: b?.arrearsSince ?? null, defaultedAt: b?.defaultedAt ?? null }))
  ];
}

/** The grade a score earns, before caps. */
export function gradeFor(score) {
  return (RATING.grades.find((g) => score >= g.minScore) ?? RATING.grades[RATING.grades.length - 1]).grade;
}
const worse = (a, b) => (GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b);

/**
 * The rating: { grade, score, inputs, computedAt }, or { grade: "NR", reason, inputs: null, computedAt }.
 *
 * `statements` are the corporation's closed daily statements (any order; the newest `windowStatements` are read).
 * `options.bonds` are bonds it issued; `options.proForma` ({ debt, assets }) rates it as if that much more were owed
 * and held, which is how a quote prices a loan by the grade after it (section 4, "Quoting uses the grade after the loan").
 */
export function computeCreditRating(corp, now = Date.now(), statements = [], options = {}) {
  const nr = (reason) => ({ grade: "NR", reason, inputs: null, computedAt: now });
  if (!Array.isArray(statements)) return nr("no statements");
  if (statements.some((st) => !readable(st))) return nr("a statement could not be read");
  const window = [...statements].sort((a, b) => a.dayStart - b.dayStart).slice(-RATING.windowStatements);
  const h = window.length;
  if (h < RATING.minStatements) return nr(`${h} of ${RATING.minStatements} statements`);

  const extraDebt = Math.max(0, Number(options.proForma?.debt) || 0);
  const extraAssets = Math.max(0, Number(options.proForma?.assets) || 0);
  const debts = instruments(corp, options.bonds);
  const debt = debts.reduce((s, d) => s + d.owed, 0) + extraDebt;
  const latest = window[h - 1];
  const sum = (f) => window.reduce((s, st) => s + f(st), 0);
  const income = sum((st) => st.pnl.totalIncome);
  const net = sum((st) => st.pnl.net);
  const avgExpenses = sum((st) => st.pnl.totalExpenses) / h;
  const avgAssets = sum((st) => st.balanceSheet.totalAssets) / h + extraAssets;
  const credits = latest.balanceSheet.credits;

  // Section 4's inputs, each a raw value and the sub-score it maps to, clipped to 0..1. No income scores 0 on margin,
  // leverage and turnover.
  const days = avgExpenses > 0 ? credits / avgExpenses : credits > 0 ? Infinity : 0;
  const margin = income > 0 ? net / income : null;
  const coverDenominator = latest.balanceSheet.liabilities + debt;
  const cover = coverDenominator > 0 ? latest.balanceSheet.netWorth / coverDenominator : latest.balanceSheet.netWorth > 0 ? Infinity : 0;
  const leverage = income > 0 ? debt / income : null;
  const turnover = income > 0 ? (avgAssets > 0 ? income / avgAssets : Infinity) : null;
  const sub = {
    history: { raw: h, sub: clip((h - 7) / 23) },
    cashCover: { raw: raw(days), sub: clip(days / 30) },
    margin: { raw: raw(margin), sub: margin === null ? 0 : clip((margin + 0.10) / 0.30) },
    solvency: { raw: raw(cover), sub: clip(cover / 3) },
    leverage: { raw: raw(leverage), sub: leverage === null ? 0 : clip(1 - leverage / 0.6) },
    turnover: { raw: raw(turnover), sub: turnover === null ? 0 : clip(turnover / 3) }
  };
  const inputs = Object.fromEntries(RATING.inputs.map((i) => [i.id, { ...sub[i.id], sub: Math.round(sub[i.id].sub * 10_000) / 10_000, weight: i.weight }]));
  const score = Math.max(0, Math.min(1000, Math.round(RATING.inputs.reduce((s, i) => s + i.weight * sub[i.id].sub, 0))));

  // Caps, after the score (section 4): wages owed, debt in arrears, arrears over 7 days or a recent default.
  let grade = gradeFor(score);
  const caps = [];
  if ((Number(corp?.finances?.payrollArrears) || 0) > 0) { grade = worse(grade, RATING.caps.payrollArrears); caps.push("payroll arrears"); }
  if (debts.some((d) => d.state === "arrears")) { grade = worse(grade, RATING.caps.debtArrears); caps.push("debt in arrears"); }
  const longArrears = debts.some((d) => d.state === "arrears" && finite(d.arrearsSince) && now - d.arrearsSince > RATING.caps.arrearsDaysToD * DAY_MS);
  const recentDefault = debts.some((d) => d.state === "defaulted" && (!finite(d.defaultedAt) || now - d.defaultedAt <= RATING.caps.defaultWindowDays * DAY_MS));
  if (longArrears || recentDefault) { grade = "D"; caps.push(longArrears ? "arrears over 7 days" : "a default in the last 30 days"); }

  return { grade, score, inputs, ...(caps.length ? { caps } : {}), computedAt: now };
}

/**
 * What the rating depends on that can change without a new statement, plus the open day (which moves when one
 * closes). The rating is recomputed when this differs from what it was computed on.
 */
export function ratingBasis(corp, bonds = []) {
  const day = Number(corp?.finances?.dayBook?.dayStart) || 0;
  const wages = (Number(corp?.finances?.payrollArrears) || 0) > 0 ? 1 : 0;
  const debt = instruments(corp, bonds).map((d) => `${d.state}:${d.owed}:${d.arrearsSince ?? ""}`).join(",");
  return `${day}|${wages}|${debt}`;
}

/**
 * Keep corp.creditRating current: recompute it when its basis has changed since it was computed, reading the
 * statements through `loadStatements` only then. Returns true when it recomputed.
 */
export function refreshCreditRating(corp, now, loadStatements, options = {}) {
  if (!corp) return false;
  const basis = ratingBasis(corp, options.bonds);
  if (corp.creditRating && corp.creditRating.basis === basis) return false;
  let statements;
  try { statements = loadStatements(); } catch { statements = null; }
  corp.creditRating = { ...computeCreditRating(corp, now, statements, options), basis };
  return true;
}
