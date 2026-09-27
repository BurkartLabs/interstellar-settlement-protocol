// server/game/arbitration.js: the Galactic Arbitration Council's arithmetic (ISP-241, AB#937; docs/design/WARFARE.md,
// "The Galactic Arbitration Council"). Pure: no files and no clock, so tests read it with fixtures. server/arbitration.js
// files cases on server records; the rulings (ISP-242) apply the same functions to the evidence re-read at the window's end.
import { royaltyOn } from "../../public/scripts/patentRoyalty.js";

const HOUR = 3_600_000;

/** The Council fee for a claim of `amount` credits: the larger of filingFeeMin and filingFeePct of the claim. */
export function councilFee(amount, terms) {
  return Math.max(terms.filingFeeMin, Math.round((Math.max(0, Number(amount) || 0) * terms.filingFeePct) / 100));
}

/** A readiness log's value at `t`: the latest entry at or before it, or null when the log starts after `t`. */
export function readinessAt(log, t) {
  let r = null;
  for (const e of log || []) {
    if (e.at <= t) r = e.readiness;
    else break;
  }
  return r;
}

/**
 * mercenary-readiness: the owner's readiness at the start of each hour of the term that has run by `now`, and the refund
 * WARFARE.md's rule gives on it: price x the sum over the term's hours of (hire readiness - that hour's) / hire
 * readiness, / the term's hours. An hour with no reading counts as at hire readiness (nothing shown was lost).
 * Returns { hours: [readiness...], hoursBelow, refund }.
 */
export function readinessRefund({ price, termHours, hireReadiness, hiredAt }, log, now) {
  const run = Math.max(0, Math.min(termHours, Math.floor((now - hiredAt) / HOUR)));
  const hours = Array.from({ length: run }, (_, h) => readinessAt(log, hiredAt + h * HOUR) ?? hireReadiness);
  const shortfall = hours.reduce((s, r) => s + Math.max(0, hireReadiness - r) / hireReadiness, 0);
  return { hours, hoursBelow: hours.filter((r) => r < hireReadiness).length, refund: Math.round((price * shortfall) / termHours) };
}

/**
 * A holder's filed rate in force at `t`, from its rate record's history and pending change (server/game/tariffs.js
 * keeps both): the last change that took effect by `t`, and 0 before any (a new grant starts at 0%).
 */
export function rateInForceAt(record, t) {
  if (!record) return 0;
  const changes = [...(record.history || []).map((h) => ({ pct: h.pct, from: h.from }))];
  if (record.pending && Number.isFinite(record.pending.effectiveAt)) changes.push({ pct: record.pending.pct, from: record.pending.effectiveAt });
  changes.sort((a, b) => a.from - b.from);
  let pct = 0;
  for (const c of changes) if (c.from <= t && c.from >= (record.grantedAt || 0)) pct = c.pct;
  return pct;
}

/**
 * tariff-overcharge: the lawful rate for a settled tariff and the excess charged. Lawful is 0 when no holder was
 * `granted` at the moment; else the lower of the posting rate and the system's rate then (the lowest of its holders'
 * filed rates), capped at the system's cap. Excess = (charged - lawful) x base, in whole credits.
 */
export function tariffExcess({ chargedPct, postedPct, base, granted, holderRates, capPct }) {
  const systemPct = holderRates.length ? Math.min(...holderRates) : 0;
  const lawfulPct = granted ? Math.min(capPct, Number.isFinite(postedPct) ? Math.min(postedPct, systemPct) : systemPct) : 0;
  const excess = chargedPct > lawfulPct ? Math.round(((chargedPct - lawfulPct) * base) / 100) : 0;
  return { lawfulPct, excess };
}

/**
 * patent-royalty: the royalty each recorded use owed at the patent's rate, against what the settlement recorded
 * (ISP-236). Returns { due, recorded, paid, shortfall }: shortfall is due - recorded, what the settlement undercharged.
 * What a user could not pay is its debt to the holder, collected by withholding (ISP-236), not a shortfall here.
 */
export function royaltyShortfall(uses, ratePct) {
  const due = (uses || []).reduce((s, u) => s + royaltyOn(Math.max(0, Number(u.base) || 0), ratePct), 0);
  const recorded = (uses || []).reduce((s, u) => s + (Number(u.royalty) || 0), 0);
  const paid = (uses || []).reduce((s, u) => s + (Number(u.paid) || 0), 0);
  return { due, recorded, paid, shortfall: Math.max(0, due - recorded) };
}
