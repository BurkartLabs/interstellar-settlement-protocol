// ISP-154 (AB#848): corporate bond series: issue one, subscribe during its window, and close the window.
//
// docs/design/v0.9-debt.md, sections 1, 7 and 11. An issuer at level 10 or above, graded B or better, offers `quantity`
// units of 1,000 face at a coupon it chooses, for 30, 60 or 90 days. For 24 or 48 hours other corporations subscribe at
// face, and the credits go to the issuer through settleTransfer as each one subscribes (REASON, below).
// When the window ends, or the series fills, it closes: the NPC underwriter (the Development Bank, paying from its
// tap) takes a share of the units still unsold that rises with the coupon against the grade's implied yield, and the
// rest lapse. Coupons and redemption are ISP-155's (AB#849); this module leaves the series `live` for it.
//
// The grade that gates the issue, and that the underwriter prices against, is the one the issuer would have with the
// whole series sold (a pro-forma rating, as a loan quote uses): so a series too large for the corporation's record is
// refused, rather than printed by the underwriter's tap.
//
// Every number is the server's and every field a number or an enum (section 11). Subscribing to more than is left is
// refused, not cut down; an issuer cannot hold its own bonds; and once the window has closed, subscribing moves
// nothing, whether or not the tick has run yet. Time is passed in (P-TEST-TIME).
//
// This is an instrument module: it is what moves value through server/settlement.js; no route imports that directly.

import { computeCreditRating } from "./creditRating.js";
import { getAccountById, getStatements, mutateAccountState } from "./gameState.js";
import { accountsStore, saveAccountsNow } from "./game/store.js";
import { settleTransfer } from "./settlement.js";
import { BOND_TERMS, COUPON_STEPS, underwriterShare } from "./bondTerms.js";
export { BOND_TERMS, COUPON_STEPS, underwriterShare };
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The settlement reason every purchase of a bond at issue moves under, a player's or the underwriter's. */
const REASON = "bond-subscription";

/** Every series, the stored list itself (design: `market.bondSeries[]`). */
export function bondSeriesList() {
  if (!Array.isArray(accountsStore.bondSeries)) accountsStore.bondSeries = [];
  return accountsStore.bondSeries;
}

const seriesById = (id) => (typeof id === "string" ? bondSeriesList().find((s) => s.id === id) ?? null : null);
const OUTSTANDING = new Set(["subscribing", "live", "arrears"]);

/** The bonds an account's corporation has issued, as the credit rating reads them (server/creditRating.js). */
export function bondsIssuedBy(accountId) {
  return bondSeriesList()
    .filter((s) => s.issuerAccountId === accountId && OUTSTANDING.has(s.state))
    .map((s) => ({ outstandingFace: s.sold * s.faceValue, state: s.state === "subscribing" ? "live" : s.state, arrearsSince: s.arrearsSince ?? null, defaultedAt: s.defaultedAt ?? null }));
}

const statementsOf = (accountId, now) => getStatements(accountId, 30, now)?.statements ?? [];

/** Why this corporation may not issue this series now, or null. Pure apart from reading the stored series. */
function issueProblem(accountId, corp, t) {
  if ((Number(corp.level) || 0) < BOND_TERMS.minIssuerLevel) return `Issuing bonds takes corporation level ${BOND_TERMS.minIssuerLevel}.`;
  if (!Number.isInteger(t.quantity) || t.quantity < BOND_TERMS.minQuantity || t.quantity > BOND_TERMS.maxQuantity) return `A series is ${BOND_TERMS.minQuantity} to ${BOND_TERMS.maxQuantity} units.`;
  if (!COUPON_STEPS.includes(t.couponPct30)) return `The coupon is ${BOND_TERMS.minCouponPct30} to ${BOND_TERMS.maxCouponPct30}% per 30 days, in steps of ${BOND_TERMS.couponStepPct30}.`;
  if (!BOND_TERMS.maturityDays.includes(t.maturityDays)) return `A series matures in ${BOND_TERMS.maturityDays.join(", ")} days.`;
  if (!BOND_TERMS.windowHours.includes(t.windowHours)) return `A series is open for subscribing for ${BOND_TERMS.windowHours.join(" or ")} hours.`;
  if (bondSeriesList().some((s) => s.issuerAccountId === accountId && s.state === "subscribing")) return "Your corporation already has a series open for subscribing.";
  return null;
}

/**
 * Issue a series: { ok: true, series } or { ok: false, error }. The request gives quantity, coupon, maturity and
 * window; the face value, the grade and everything after are the server's.
 */
export function issueBond(accountId, { quantity, couponPct30, maturityDays, windowHours } = {}, now = Date.now()) {
  const corp = getAccountById(accountId)?.state?.corp;
  if (!corp) return { ok: false, error: "No such corporation." };
  const t = { quantity, couponPct30, maturityDays, windowHours };
  const problem = issueProblem(accountId, corp, t);
  if (problem) return { ok: false, error: problem };

  const face = BOND_TERMS.faceValue * quantity;
  const statements = statementsOf(accountId, now);
  const bonds = bondsIssuedBy(accountId);
  const before = computeCreditRating(corp, now, statements, { bonds });
  const after = computeCreditRating(corp, now, statements, { bonds, proForma: { debt: face, assets: face } });
  for (const [r, when] of [[before, "now"], [after, "with this series sold"]]) {
    if (!BOND_TERMS.issuerGrades.includes(r.grade)) {
      return { ok: false, error: r.grade === "NR" ? "An unrated corporation may not issue bonds." : `Issuing takes a grade of B or better; your corporation is ${r.grade} ${when}.`, grade: r.grade };
    }
  }

  const series = {
    id: `bond-${now.toString(36)}-${(bondSeriesList().length + 1).toString(36)}`,
    issuerAccountId: accountId,
    issuerCorpId: corp.publicId ?? null,
    issuerName: corp.name ?? null,
    faceValue: BOND_TERMS.faceValue,
    quantity,
    couponPct30,
    couponEveryDays: BOND_TERMS.couponEveryDays,
    maturityDays,
    windowHours,
    grade: after.grade,
    impliedYieldPct30: BOND_TERMS.impliedYieldPct30[after.grade],
    sold: 0,
    playerUnits: 0,
    underwriterUnits: 0,
    lapsedUnits: 0,
    subscriptions: 0,
    state: "subscribing",
    issuedAt: now,
    closesAt: now + windowHours * HOUR,
    closedAt: null,
    maturesAt: null,
    nextCouponAt: null
  };
  bondSeriesList().push(series);
  saveAccountsNow();
  return { ok: true, series };
}

/** Record `units` of a series on a holder's corporation (`corp.bondHoldings[]`). */
function addHolding(accountId, seriesId, units) {
  mutateAccountState(accountId, (state) => {
    if (!Array.isArray(state.corp.bondHoldings)) state.corp.bondHoldings = [];
    const h = state.corp.bondHoldings.find((x) => x.seriesId === seriesId);
    if (h) h.units += units;
    else state.corp.bondHoldings.push({ seriesId, units });
  }, { sanitize: false, settleMining: false });
}

/**
 * Close a series: the underwriter takes its share of what is unsold, the rest lapses, and the series goes live (or
 * lapses, if nothing sold). Idempotent: a closed series is left alone.
 */
function closeSeries(series, now) {
  if (series.state !== "subscribing") return series;
  const unsold = series.quantity - series.sold;
  const units = Math.floor(unsold * underwriterShare(series.couponPct30, series.grade));
  if (units > 0) {
    const paid = settleTransfer({ fromAccountId: BOND_TERMS.underwriter.account, toAccountId: series.issuerAccountId, credits: units * series.faceValue, reason: REASON, idempotencyKey: `bond:${series.id}:underwriter` }, now);
    if (paid.ok) { series.underwriterUnits = units; series.sold += units; }
  }
  series.lapsedUnits = series.quantity - series.sold;
  series.closedAt = now;
  if (series.sold > 0) {
    series.state = "live";
    series.maturesAt = now + series.maturityDays * DAY;
    series.nextCouponAt = now + series.couponEveryDays * DAY;
  } else {
    series.state = "lapsed";
  }
  saveAccountsNow();
  return series;
}

/**
 * Subscribe to `units` of a series at face: { ok: true, series, units, paid } or { ok: false, status, error }.
 * Refused, with nothing moved: the issuer itself, a closed window (even before the tick closes it), more units than
 * are left, or credits that do not cover it. Filling the series closes it.
 */
export function subscribeBond(accountId, { seriesId, units } = {}, now = Date.now()) {
  const series = seriesById(seriesId);
  if (!series) return { ok: false, status: 404, error: "No such bond series." };
  if (series.issuerAccountId === accountId) return { ok: false, status: 409, error: "A corporation cannot subscribe to its own bonds." };
  if (series.state !== "subscribing" || now >= series.closesAt) return { ok: false, status: 409, error: "That series has closed to subscribers." };
  if (!Number.isInteger(units) || units < 1) return { ok: false, status: 400, error: "Units must be a whole number of at least 1." };
  const left = series.quantity - series.sold;
  if (units > left) return { ok: false, status: 409, error: `Only ${left} unit${left === 1 ? "" : "s"} of that series are left.` };
  if (!getAccountById(accountId)?.state?.corp) return { ok: false, status: 404, error: "No such corporation." };

  const credits = units * series.faceValue;
  const n = series.subscriptions + 1;
  const paid = settleTransfer({ fromAccountId: accountId, toAccountId: series.issuerAccountId, credits, reason: REASON, idempotencyKey: `bond:${series.id}:sub:${n}` }, now);
  if (!paid.ok) return { ok: false, status: 409, error: paid.error === "the payer does not have the credits" ? `Subscribing takes ${credits.toLocaleString("en-US")} credits.` : paid.error };
  series.subscriptions = n;
  series.sold += units;
  series.playerUnits += units;
  addHolding(accountId, series.id, units);
  if (series.sold === series.quantity) closeSeries(series, now);
  else saveAccountsNow();
  return { ok: true, series, units, paid: credits };
}

/** The window tick: close every series whose window has ended. `now` is passed in (the server passes Date.now()). */
export function bondWindowTick(now) {
  for (const s of bondSeriesList()) if (s.state === "subscribing" && now >= s.closesAt) closeSeries(s, now);
}

/** A series as any corporation may see it: no account ids. */
export function publicSeries(s, now = Date.now()) {
  return {
    id: s.id, issuerCorpId: s.issuerCorpId, issuerName: s.issuerName, grade: s.grade, faceValue: s.faceValue,
    quantity: s.quantity, sold: s.sold, left: s.quantity - s.sold, couponPct30: s.couponPct30, couponEveryDays: s.couponEveryDays,
    maturityDays: s.maturityDays, state: s.state === "subscribing" && now >= s.closesAt ? "closing" : s.state,
    issuedAt: s.issuedAt, closesAt: s.closesAt, closedAt: s.closedAt, maturesAt: s.maturesAt,
    underwriterUnits: s.underwriterUnits, lapsedUnits: s.lapsedUnits
  };
}
