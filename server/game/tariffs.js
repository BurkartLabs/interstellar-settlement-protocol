// server/game/tariffs.js: a concession holder's tariff, as rules (ISP-230, AB#925; docs/design/WARFARE.md, "Tariffs").
// Pure: no files and no clock, so tests read it with fixtures. server/tariffService.js stores and charges it.
//
// A holder sets one rate for its system, in the catalog's steps, from 0 to the system's cap. An increase takes effect
// `noticeHours` after it is filed and is public meanwhile; a decrease takes effect at once, because it can only help a
// trader; one change is pending at a time, and filing another replaces it. Nobody pays a rate they were not shown: a
// listing pays the lower of the rate when it was posted and the rate when it fills. Of what is collected, the ISA
// keeps a levy of isaLevyAtCapPct x rate / cap (WARFARE.md, "Why the best tariff is below the cap"): that levy is what
// puts the holder's best rate below the cap, and it is flagged for the Board's veto, so it is one function here.

const HOUR = 3_600_000;

/** Why `pct` cannot be a system's rate under `cap` and `terms` ({ stepPct }), or null when it can. */
export function rateProblem(pct, cap, terms) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "A tariff is a number of percentage points.";
  if (!(cap > 0)) return "This system allows no tariff.";
  if (pct < 0 || pct > cap) return `A tariff here is from 0% to ${cap}%.`;
  if (Math.abs(pct / terms.stepPct - Math.round(pct / terms.stepPct)) > 1e-9) return `A tariff is set in steps of ${terms.stepPct} points.`;
  return null;
}

/** The rate in force at `at`: the pending rate once its notice has run, else the current one. 0 for no record. */
export function rateAt(record, at) {
  if (!record) return 0;
  const pending = record.pending;
  return pending && at >= pending.effectiveAt ? pending.pct : Number(record.pct) || 0;
}

/** The record with a pending change applied if its notice has run by `now` (and its history noted). */
export function settle(record, now) {
  if (!record?.pending || now < record.pending.effectiveAt) return record;
  const { pct, effectiveAt } = record.pending;
  return { ...record, pct, pending: null, history: [...(record.history || []), { pct, from: effectiveAt }].slice(-20) };
}

/**
 * File a new rate at `now`: a decrease (or no change) takes effect at once and clears any pending increase; an increase
 * is pending until noticeHours have passed. Returns the new record.
 */
export function fileRate(record, pct, now, terms) {
  const current = rateAt(settle(record, now), now);
  const base = { ...(settle(record, now) || {}), pct: current };
  if (pct <= current) return { ...base, pct, pending: null, history: [...(base.history || []), { pct, from: now }].slice(-20) };
  return { ...base, pending: { pct, filedAt: now, effectiveAt: now + terms.noticeHours * HOUR } };
}

/** What a listing pays: the lower of the rate when it was posted and the rate now (a missing posting rate counts as now's). */
export function listingRate(postedPct, nowPct) {
  return Number.isFinite(postedPct) ? Math.min(postedPct, nowPct) : nowPct;
}

/** The tariff on `base` credits at `pct`, in whole credits (rounded as the exchange tax is). */
export function tariffOn(base, pct) {
  return pct > 0 && base > 0 ? Math.round((base * pct) / 100) : 0;
}

/** The ISA's levy out of `amount` collected at `pct` in a system capped at `cap`: isaLevyAtCapPct x pct / cap of it. */
export function levyOf(amount, pct, cap, terms) {
  if (!(amount > 0) || !(cap > 0)) return 0;
  return Math.round((amount * terms.isaLevyAtCapPct * Math.min(pct, cap)) / (100 * cap));
}
