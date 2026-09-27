// ISP-155 (AB#849): servicing a bond series: coupons to every holder, redemption at maturity, arrears, and default.
//
// docs/design/v0.9-debt.md, sections 2, 7 and 10, on the series ISP-154 (server/bonds.js) left `live`. The shape is the
// loan servicing's (server/loanServicing.js, AB#844), with the series' holders in the lender's place:
//
//   Coupons     every 7 days from the close, couponPct30 x days/30 x face x units, and at maturity a last coupon for the
//               days since the last one, so a series pays its coupon for the whole term (section 8's table: 100 units
//               at 6% for 60 days pay 12,000). Paid through settleTransfer (`coupon`) to each holder.
//   Rounding    each payment's total is rounded to the credit once; each holder gets its units' share rounded down, and
//               what that leaves goes to the largest holder, so the holders' payments sum to the total exactly
//               (section 7). Every split in this file, arrears collected or credits recovered, uses the same rule.
//   Redemption  at maturity, face x units to each holder (`bond-redemption`), and the series is `redeemed`.
//   Underwriter its units are held by the Development Bank's tap (`tap:dsdb`): what it is paid is destroyed, as the
//               principal it created when it subscribed is (section 9).
//   Arrears     a due payment is paid whole or not at all. Missed, it joins the arrears with a late fee of 5% of it
//               (to sink:fee), each holder's share recorded as coupon or face owed to it. Arrears accrue penalty
//               interest daily at the coupon plus 15 points per 30 days, owed to the holders. Each day the issuer's
//               credits pay arrears first: coupon, then face, split pro rata, then the fees; partial collection is
//               taken. The holders come before the fee sink (the more protective reading, section 10), so what is
//               recovered from a defaulted issuer reaches the holders first, to the credit.
//   Default     arrears more than 7 days old make the series `defaulted` (section 10): the issuer's grade is D, the
//               issuer and the holders are told, and every listener registered with onBondDefault is called, which is
//               where default recovery (ISP-286, AB#993; the Board's answer to D-0.9-1, AB#702) raises what is owed.
//               Whatever it raises lands in the issuer's credits and is collected and split to the holders the same day.
//
// Every movement has an idempotency key naming the series, the day and the holder, so a tick that runs twice pays
// once. Time is passed in (P-TEST-TIME): nothing here reads the clock.

import { addAccountNotification, getAccountById, getAllAccountIds, mutateAccountState } from "./gameState.js";
import { saveAccountsNow } from "./game/store.js";
import { settleTransfer } from "./settlement.js";
import { emitToAccount } from "./realtime.js";
import { BOND_TERMS, bondSeriesList } from "./bonds.js";
import { couponFor, couponSchedule } from "./bondTerms.js";

const DAY = 86_400_000;
/** Late fee on a missed payment, the penalty points over the coupon per 30 days, and the days before default. */
export const LATE_FEE_PCT = 5;
export const PENALTY_POINTS_PCT30 = 15;
export const DEFAULT_AFTER_DAYS = 7;
/** What a bond holding counts for in default recovery: 90% of face (section 10). */
export const HOLDING_RECOVERY_PCT = 90;

const SERVICED = new Set(["live", "arrears", "defaulted"]);
const creditsOf = (accountId) => Math.round(Number(getAccountById(accountId)?.state?.corp?.finances?.credits) || 0);

/** The series' holders, largest first (ties by account, so the order is always the same): [{ account, units }]. */
export function holdersOf(series) {
  const out = [];
  for (const accountId of getAllAccountIds()) {
    const h = getAccountById(accountId)?.state?.corp?.bondHoldings?.find((x) => x.seriesId === series.id);
    if (h?.units > 0) out.push({ account: accountId, units: h.units });
  }
  if (series.underwriterUnits > 0) out.push({ account: BOND_TERMS.underwriter.account, units: series.underwriterUnits });
  return out.sort((a, b) => b.units - a.units || (a.account < b.account ? -1 : 1));
}

/**
 * Split `total` credits over `weights` ([{ account, units }], largest first): each gets its share rounded down, and the
 * remainder goes to the first (the largest). The parts sum to `total` exactly. [{ account, credits }].
 */
export function splitProRata(total, weights) {
  const sum = weights.reduce((s, w) => s + w.units, 0);
  if (total <= 0 || sum <= 0) return weights.map((w) => ({ account: w.account, amount: 0 }));
  const parts = weights.map((w) => ({ account: w.account, amount: Math.floor((total * w.units) / sum) }));
  parts[0].amount += total - parts.reduce((s, p) => s + p.amount, 0);
  return parts;
}

/** A coupon for `days` on the series' sold units, rounded to the credit once (section 7). */
export const couponTotal = (series, days) => couponFor(series.couponPct30, days, series.faceValue, series.sold);

/** The coupon days due on day `d` of the series (0 if none): 7 on each coupon date, the stub at maturity. */
function couponDaysOn(series, d) {
  const day = Math.round((d - series.closedAt) / DAY);
  if (day === series.maturityDays) return series.maturityDays - Math.floor((series.maturityDays - 1) / series.couponEveryDays) * series.couponEveryDays;
  return day > 0 && day < series.maturityDays && day % series.couponEveryDays === 0 ? series.couponEveryDays : 0;
}

/** The series' arrears as one number: fees plus every holder's coupon and face owed. */
function arrearsTotal(s) {
  const owed = (m) => Object.values(m || {}).reduce((a, b) => a + b, 0);
  return (s.arrearsFees || 0) + owed(s.arrearsCoupon) + owed(s.arrearsFace);
}

const pay = (from, to, credits, reason, key, now) => (credits <= 0 ? true : settleTransfer({ fromAccountId: from, toAccountId: to, credits, reason, idempotencyKey: key }, now).ok);

/** Pay what the issuer can of the arrears: coupon owed, then face owed, each split pro rata, then fees. Changes `s`. */
function collectArrears(s, now, tag) {
  const issuer = s.issuerAccountId;
  for (const [field, reason] of [["arrearsCoupon", "coupon"], ["arrearsFace", "bond-redemption"]]) {
    const owed = Object.entries(s[field] || {}).filter(([, v]) => v > 0).map(([account, units]) => ({ account, units })).sort((a, b) => b.units - a.units || (a.account < b.account ? -1 : 1));
    const total = owed.reduce((a, o) => a + o.units, 0);
    const take = Math.min(total, creditsOf(issuer));
    if (take <= 0) continue;
    // split what can be paid by what each is owed; never more than a holder is owed
    for (const part of take === total ? owed.map((o) => ({ account: o.account, amount: o.units })) : splitProRata(take, owed)) {
      part.amount = Math.min(part.amount, s[field][part.account]); // the remainder never pays a holder past what it is owed
      if (part.amount > 0 && pay(issuer, part.account, part.amount, reason, `${tag}:arrears:${reason}:${part.account}`, now)) {
        s[field][part.account] -= part.amount;
        if (s[field][part.account] === 0) delete s[field][part.account];
      }
    }
  }
  const fee = Math.min(s.arrearsFees || 0, creditsOf(issuer));
  if (fee > 0 && pay(issuer, "sink:fee", fee, "fee", `${tag}:arrears:fee`, now)) s.arrearsFees -= fee;
  s.arrears = arrearsTotal(s);
}

const listeners = new Set();
/** Register a default-recovery listener (ISP-286): called with ({ series, owed, now }) when a series defaults. */
export function onBondDefault(listener) { listeners.add(listener); return () => listeners.delete(listener); }

function tell(accountId, title, body) {
  const n = addAccountNotification(accountId, { type: "finance", title, body });
  if (n) emitToAccount(accountId, "notifications:new", { accountId, notification: n });
}

/** Take a redeemed series' units off its holders' books. */
function clearHoldings(series) {
  for (const accountId of getAllAccountIds()) {
    const list = getAccountById(accountId)?.state?.corp?.bondHoldings;
    if (!list?.some((h) => h.seriesId === series.id)) continue;
    mutateAccountState(accountId, (state) => {
      state.corp.bondHoldings = state.corp.bondHoldings.filter((h) => h.seriesId !== series.id);
    }, { sanitize: false, settleMining: false });
  }
}

/**
 * Service one series up to `now`, day by day from where it was last serviced. Returns what happened:
 * { paid, missed, defaulted, redeemed }. Changes the series in place.
 */
export function serviceSeries(s, now) {
  const out = { paid: 0, missed: 0, defaulted: false, redeemed: false };
  if (!SERVICED.has(s.state) || !s.closedAt) return out;
  if (!s.servicedThrough) s.servicedThrough = s.closedAt;
  s.arrears = Number(s.arrears) || 0;
  s.arrearsCoupon = s.arrearsCoupon || {};
  s.arrearsFace = s.arrearsFace || {};
  const holders = holdersOf(s);
  while (SERVICED.has(s.state) && s.servicedThrough + DAY <= now) {
    const d = s.servicedThrough + DAY;
    const tag = `bond:${s.id}:${d}`;
    // 1. arrears accrue the day's penalty interest, owed to each holder on what it is owed, then are collected first
    if (s.arrears > 0) {
      const rate = (s.couponPct30 + PENALTY_POINTS_PCT30) / 100 / 30;
      for (const field of ["arrearsCoupon", "arrearsFace"]) {
        for (const [account, owed] of Object.entries(s[field] || {})) s.arrearsCoupon[account] = (s.arrearsCoupon[account] || 0) + Math.round(owed * rate);
      }
      s.arrears = arrearsTotal(s);
      collectArrears(s, d, tag);
    }
    // 2. the day's coupon, and at maturity the face, paid whole or not at all; nothing more falls due once default
    //    recovery has made the whole face due (Bug #2574)
    const days = s.accelerated ? 0 : couponDaysOn(s, d);
    const maturity = !s.accelerated && d === s.maturesAt;
    if (days > 0 || maturity) {
      const coupons = splitProRata(couponTotal(s, days), holders);
      const faces = maturity ? holders.map((h) => ({ account: h.account, amount: h.units * s.faceValue })) : [];
      const due = [...coupons, ...faces].reduce((a, p) => a + p.amount, 0);
      if (s.arrears === 0 && creditsOf(s.issuerAccountId) >= due) {
        for (const p of coupons) if (!pay(s.issuerAccountId, p.account, p.amount, "coupon", `${tag}:coupon:${p.account}`, d)) throw new Error(`bond ${s.id}: a covered coupon was refused`);
        for (const p of faces) if (!pay(s.issuerAccountId, p.account, p.amount, "bond-redemption", `${tag}:face:${p.account}`, d)) throw new Error(`bond ${s.id}: a covered redemption was refused`);
        s.couponsPaid = (s.couponsPaid || 0) + (days > 0 ? 1 : 0);
        s.couponPaidTotal = (s.couponPaidTotal || 0) + coupons.reduce((a, p) => a + p.amount, 0);
        out.paid++;
      } else {
        for (const p of coupons) if (p.amount > 0) s.arrearsCoupon[p.account] = (s.arrearsCoupon[p.account] || 0) + p.amount;
        for (const p of faces) s.arrearsFace[p.account] = (s.arrearsFace[p.account] || 0) + p.amount;
        s.arrearsFees = (s.arrearsFees || 0) + Math.round((due * LATE_FEE_PCT) / 100);
        s.arrears = arrearsTotal(s);
        s.missedPayments = (s.missedPayments || 0) + 1;
        out.missed++;
      }
      if (maturity) s.maturedAt = d;
    }
    // 3. the state
    if (s.arrears > 0) {
      if (!s.arrearsSince) s.arrearsSince = d;
      if (s.state === "live") s.state = "arrears";
      if (s.state === "arrears" && d - s.arrearsSince > DEFAULT_AFTER_DAYS * DAY) {
        s.state = "defaulted";
        s.defaultedAt = d;
        out.defaulted = true;
        for (const l of listeners) l({ series: s, owed: s.arrears, now: d });
        collectArrears(s, d, `${tag}:recovered`); // what recovery raised, split to the holders today
      }
    }
    if (s.arrears === 0) {
      s.arrearsSince = null;
      if (s.maturedAt) { s.state = "redeemed"; s.redeemedAt = d; out.redeemed = true; }
      else s.state = "live";
    }
    s.servicedThrough = d;
  }
  return out;
}

/** The servicing tick: every series that is live, in arrears or defaulted, up to `now`. Tells issuers and holders. */
export function bondServicingTick(now) {
  for (const s of bondSeriesList()) {
    if (!SERVICED.has(s.state) || !s.closedAt || s.servicedThrough + DAY > now) continue;
    const before = s.state;
    const holders = holdersOf(s).filter((h) => h.account !== BOND_TERMS.underwriter.account);
    const r = serviceSeries(s, now);
    if (r.redeemed) clearHoldings(s);
    saveAccountsNow();
    const name = `${s.quantity.toLocaleString("en-US")}-unit bond series at ${s.couponPct30}%`;
    if (r.missed && before === "live") {
      tell(s.issuerAccountId, "Bond payment missed", `A payment on your ${name} could not be made. ${s.arrears.toLocaleString("en-US")} credits are now in arrears to its holders, including a ${LATE_FEE_PCT}% late fee, and accrue penalty interest until paid. After ${DEFAULT_AFTER_DAYS} days the series defaults.`);
    }
    if (r.defaulted) {
      tell(s.issuerAccountId, "Bond series in default", `Your ${name} is more than ${DEFAULT_AFTER_DAYS} days in arrears and has defaulted. What is owed to its holders will be recovered from your corporation under the ISA's default rules.`);
      for (const h of holders) tell(h.account, "A bond you hold has defaulted", `${s.issuerName ?? "The issuer"}'s ${name} has defaulted. What is recovered is paid to holders by units.`);
    }
    if (r.redeemed) for (const h of holders) tell(h.account, "Bond redeemed", `${s.issuerName ?? "The issuer"}'s ${name} has matured and repaid its face value to you.`);
  }
}

/**
 * What a corporation's bond holdings count for in default recovery (section 10): 90% of face on every unit of a
 * series not yet redeemed. { total, holdings: [{ seriesId, units, value }] }.
 */
export function bondHoldingsValue(corp) {
  const holdings = (corp?.bondHoldings || []).map((h) => {
    const s = bondSeriesList().find((x) => x.id === h.seriesId);
    const counts = s && s.state !== "redeemed" && s.state !== "lapsed";
    return { seriesId: h.seriesId, units: h.units, value: counts ? Math.floor((h.units * s.faceValue * HOLDING_RECOVERY_PCT) / 100) : 0 };
  });
  return { total: holdings.reduce((a, h) => a + h.value, 0), holdings };
}

/**
 * ISP-156 (AB#850): the series' next scheduled payment after the day it was last serviced: { at, day, coupon, face },
 * as totals for the whole series, or null (not closed yet, or nothing left to pay). With `accountId`, the amounts are
 * that holder's share, by the same split the servicing pays (splitProRata over holdersOf).
 */
export function nextPayment(series, accountId = null) {
  if (!series?.closedAt || !SERVICED.has(series.state)) return null;
  const through = series.servicedThrough || series.closedAt;
  const next = couponSchedule(series.maturityDays, series.couponEveryDays).find((c) => series.closedAt + c.day * DAY > through);
  if (!next) return null;
  const total = couponTotal(series, next.days);
  const maturity = next.day === series.maturityDays;
  const at = series.closedAt + next.day * DAY;
  if (!accountId) return { at, day: next.day, coupon: total, face: maturity ? series.sold * series.faceValue : 0 };
  const holders = holdersOf(series);
  const mine = holders.find((h) => h.account === accountId);
  if (!mine) return null;
  const coupon = splitProRata(total, holders).find((p) => p.account === accountId).amount;
  return { at, day: next.day, coupon, face: maturity ? mine.units * series.faceValue : 0 };
}

// ─── Default recovery (Bug #2574; server/defaultRecovery.js runs it) ───────────────────────────────────────────────

/**
 * What a defaulted series owes in all: its arrears (coupon, face that fell due, penalty and fees) and, until it is
 * accelerated or matures, the face still outstanding. Coupons not yet due are not owed (as a loan's unearned interest).
 */
export const bondOwedOnDefault = (s) => (Number(s?.arrears) || 0) + (s?.maturedAt ? 0 : (Number(s?.sold) || 0) * (Number(s?.faceValue) || 0));

/**
 * When recovery runs, the whole face falls due: each holder's units x face joins what it is owed, and no further
 * coupon falls due. Changes `s`. Idempotent.
 */
export function accelerateSeries(s, now) {
  if (s.maturedAt) return;
  s.arrearsCoupon = s.arrearsCoupon || {};
  s.arrearsFace = s.arrearsFace || {};
  for (const h of holdersOf(s)) s.arrearsFace[h.account] = (s.arrearsFace[h.account] || 0) + h.units * s.faceValue;
  s.maturedAt = now;
  s.accelerated = true;
  s.arrears = arrearsTotal(s);
}

/**
 * Collect what the issuer's credits cover of a defaulted series' arrears, split to the holders pro rata (and the fee
 * sink last), and close the series, redeemed, when nothing is owed. Returns the credits collected. Changes `s`.
 */
export function collectBondOwed(s, now, tag) {
  const before = bondOwedOnDefault(s);
  collectArrears(s, now, tag);
  if (s.arrears === 0 && s.maturedAt && SERVICED.has(s.state)) {
    Object.assign(s, { state: "redeemed", redeemedAt: now, arrearsSince: null });
    clearHoldings(s);
  }
  saveAccountsNow();
  return before - bondOwedOnDefault(s);
}

/** What one unit of a series fetches in default recovery: 90% of face (section 10). */
export const recoveryPrice = (s) => Math.floor((s.faceValue * HOLDING_RECOVERY_PCT) / 100);

/**
 * Default recovery's liquid stage for bonds: sell the debtor's bond holdings to the NPC underwriter at 90% of face,
 * only as many units as it takes to raise `needed`. The underwriter pays from its tap through settleTransfer
 * (`bond-sale`) and holds the units from then on, so their coupons and face are paid to it. Returns the credits raised;
 * each sale is pushed onto `sold`.
 */
export function sellHoldingsToUnderwriter(accountId, needed, now, tag, sold = []) {
  let raised = 0;
  const holdings = [...(getAccountById(accountId)?.state?.corp?.bondHoldings || [])].sort((a, b) => (a.seriesId < b.seriesId ? -1 : 1));
  for (const h of holdings) {
    if (raised >= needed) break;
    const s = bondSeriesList().find((x) => x.id === h.seriesId);
    if (!s || !(h.units > 0) || s.state === "redeemed" || s.state === "lapsed") continue;
    const price = recoveryPrice(s);
    const units = Math.min(h.units, Math.ceil((needed - raised) / price));
    const credits = units * price;
    if (!pay(BOND_TERMS.underwriter.account, accountId, credits, "bond-sale", `${tag}:bond-sale:${s.id}`, now)) continue;
    mutateAccountState(accountId, (state) => {
      const x = state.corp.bondHoldings.find((y) => y.seriesId === s.id);
      x.units -= units;
      if (x.units <= 0) state.corp.bondHoldings = state.corp.bondHoldings.filter((y) => y.seriesId !== s.id);
    }, { sanitize: false, settleMining: false });
    s.underwriterUnits = (s.underwriterUnits || 0) + units;
    raised += credits;
    sold.push({ kind: "bond", name: `${units} unit${units === 1 ? "" : "s"} of ${s.issuerName ?? "a"} bond series`, credits });
  }
  if (raised) saveAccountsNow();
  return raised;
}
