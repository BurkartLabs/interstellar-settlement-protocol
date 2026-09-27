// ISP-159 (AB#853): dividends from performance: a listed corporation pays its outside holders every week.
//
// docs/design/v0.9-equity.md, section 4:
//
//   netIncome7 = sum(pnl.net) over the issuer's last 7 closed statements   (the ISP-1 statements; financing is not in
//                                                                           them, Bug #2575, so raised capital is never
//                                                                           paid out as profit)
//   pool       = floor(payoutRatioPct / 100 x max(0, netIncome7))          a loss-making week pays nothing
//   toHolders  = floor(pool x outside shares / shares outstanding)         the founder's part stays in the corporation
//   each holder gets its pro-rata part of toHolders by largest remainder, so the parts sum to toHolders exactly
//
// A period is 7 days from the listing: the dividend for the week ending at listedAt + 7k is paid at that moment, from
// the statements closed before it. The payout ratio for a period is the one in force when it began: a change waits for
// the next period (payoutRatioNextPct), and may be made once in 7 days. An issuer with fewer than 7 closed statements
// pays nothing. One whose credits cannot cover toHolders pays what it has, split the same way; the rest is not owed (a
// dividend is a share of profit, not a debt) and the shortfall is recorded, for the Exchange to show.
//
// Every payment is settleTransfer (`dividend`), issuer to holder; the IGSX market maker's part goes to its tap, which
// destroys it (section 7). Idempotency keys name the issuer, the period and the holder, so a tick that runs twice pays
// once. Time is passed in (P-TEST-TIME).

import { getAccountById, getAllAccountIds, getStatements, mutateAccountState } from "./gameState.js";
import { saveAccountsNow } from "./game/store.js";
import { settleTransfer } from "./settlement.js";
import { SHARE_TERMS } from "./shareRegistry.js";

const DAY = 86_400_000;
export const PERIOD_DAYS = 7;
const MM = SHARE_TERMS.marketMaker;
/** How many past periods a registry keeps, for the Exchange to show. */
const HISTORY = 12;

/**
 * Split `total` over `weights` ([{ key, shares }]) by largest remainder: each gets its share rounded down, and the
 * credits left over go one each to the largest fractional remainders (ties: more shares, then key). Sums to `total`.
 */
export function largestRemainder(total, weights) {
  const sum = weights.reduce((a, w) => a + w.shares, 0);
  if (!(total > 0) || !(sum > 0)) return weights.map((w) => ({ key: w.key, amount: 0 }));
  const parts = weights.map((w) => {
    const exact = (total * w.shares) / sum;
    return { key: w.key, shares: w.shares, amount: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = total - parts.reduce((a, p) => a + p.amount, 0);
  const order = [...parts].sort((a, b) => b.rem - a.rem || b.shares - a.shares || (a.key < b.key ? -1 : 1));
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) order[i].amount++;
  return parts.map(({ key, amount }) => ({ key, amount }));
}

/** The dividend a period pays, from the issuer's registry and its last 7 closed statements. Pure. */
export function dividendFor(registry, statements) {
  const outstanding = registry.authorized - registry.unissued;
  const outside = registry.holders.reduce((a, h) => a + h.shares, 0);
  if (statements.length < PERIOD_DAYS) return { netIncome7: null, pool: 0, toHolders: 0, reason: "fewer than 7 closed statements" };
  const netIncome7 = statements.slice(0, PERIOD_DAYS).reduce((a, s) => a + (Number(s.pnl?.net) || 0), 0);
  const pool = Math.floor((registry.payoutRatioPct / 100) * Math.max(0, netIncome7));
  const toHolders = outstanding > 0 ? Math.floor((pool * outside) / outstanding) : 0;
  return { netIncome7, pool, toHolders, reason: netIncome7 <= 0 ? "no profit this week" : null };
}

const accountOfCorp = (corpId) => getAllAccountIds().find((id) => getAccountById(id)?.state?.corp?.publicId === corpId) ?? null;
const holderKey = (h) => (h.holder?.kind === "npc" ? `npc:${h.holder.id}` : `corp:${h.holder?.corpId}`);

/** The 7 newest statements closed before `at` (newest first). */
function statementsBefore(accountId, at) {
  const all = getStatements(accountId, 400, at)?.statements ?? [];
  return all.filter((s) => s.dayStart + DAY <= at).slice(0, PERIOD_DAYS);
}

/** Pay one period's dividend for the issuer, the week ending at `due`. Returns the period's record. */
function payPeriod(accountId, due) {
  const corp = getAccountById(accountId).state.corp;
  const r = corp.shareRegistry;
  const d = dividendFor(r, statementsBefore(accountId, due));
  const credits = Math.round(Number(corp.finances?.credits) || 0);
  const payable = Math.min(d.toHolders, Math.max(0, credits));
  const holders = r.holders.map((h) => ({ key: holderKey(h), shares: h.shares, row: h }));
  const split = largestRemainder(payable, holders);
  const paidTo = {};
  let paid = 0;
  for (const part of split) {
    if (part.amount <= 0) continue;
    const h = holders.find((x) => x.key === part.key).row;
    const to = h.holder?.kind === "npc" ? MM.account : accountOfCorp(h.holder?.corpId);
    if (!to) continue; // a holder that no longer exists: its part stays with the issuer
    const moved = settleTransfer({ fromAccountId: accountId, toAccountId: to, credits: part.amount, reason: "dividend", idempotencyKey: `dividend:${corp.publicId}:${due}:${part.key}` }, due);
    if (moved.ok) { paid += part.amount; paidTo[part.key] = part.amount; }
  }
  return { periodEnd: due, ratioPct: r.payoutRatioPct, netIncome7: d.netIncome7, pool: d.pool, toHolders: d.toHolders, paid, unpaid: d.toHolders - paid, reason: d.reason, paidTo };
}

/**
 * Pay every period of `accountId`'s dividend that has ended by `now`, oldest first. After each, the registry records
 * it (lastDividendAt, the holders' dividendsReceived, the history) and a waiting ratio change takes effect.
 * Returns the records paid.
 */
export function payDividends(accountId, now) {
  const out = [];
  for (let guard = 0; guard < 60; guard++) {
    const r = getAccountById(accountId)?.state?.corp?.shareRegistry;
    if (!r || r.state !== "listed" || !r.listedAt) break;
    const due = (r.lastDividendAt ?? r.listedAt) + PERIOD_DAYS * DAY;
    if (due > now) break;
    const rec = payPeriod(accountId, due);
    mutateAccountState(accountId, (state) => {
      const reg = state.corp.shareRegistry;
      for (const h of reg.holders) h.dividendsReceived = (h.dividendsReceived || 0) + (rec.paidTo[holderKey(h)] || 0);
      reg.lastDividendAt = due;
      if (reg.payoutRatioNextPct !== null && reg.payoutRatioNextPct !== undefined) { reg.payoutRatioPct = reg.payoutRatioNextPct; reg.payoutRatioNextPct = null; }
      const { paidTo, ...kept } = rec;
      reg.dividendHistory = [...(reg.dividendHistory || []), kept].slice(-HISTORY);
    }, { sanitize: false, settleMining: false });
    out.push(rec);
  }
  if (out.length) saveAccountsNow();
  return out;
}

/** The dividend tick: every listed corporation's ended periods. `now` is passed in (the server passes Date.now()). */
export function dividendTick(now) {
  for (const id of getAllAccountIds()) {
    const r = getAccountById(id)?.state?.corp?.shareRegistry;
    if (r?.state === "listed" && r.listedAt && (r.lastDividendAt ?? r.listedAt) + PERIOD_DAYS * DAY <= now) payDividends(id, now);
  }
}

/**
 * The issuer sets its payout ratio for the next period: 0 to 80 in steps of 5, once in 7 days. { ok, registry } or
 * { ok: false, error }. The period in progress keeps the ratio it began with.
 */
export function setPayoutRatio(accountId, pct, now = Date.now()) {
  const p = SHARE_TERMS.payoutRatioPct;
  const corp = getAccountById(accountId)?.state?.corp;
  const r = corp?.shareRegistry;
  if (!r) return { ok: false, error: "No such corporation." };
  if (r.state !== "listed") return { ok: false, error: "Only a listed corporation pays dividends." };
  if (!(Number.isInteger(pct) && pct >= p.min && pct <= p.max && pct % p.step === 0)) return { ok: false, error: `The payout ratio is ${p.min} to ${p.max}%, in steps of ${p.step}.` };
  if (r.payoutRatioChangedAt && now < r.payoutRatioChangedAt + PERIOD_DAYS * DAY) return { ok: false, error: "The payout ratio may be changed once in 7 days." };
  mutateAccountState(accountId, (state) => {
    state.corp.shareRegistry.payoutRatioNextPct = pct;
    state.corp.shareRegistry.payoutRatioChangedAt = now;
  }, { sanitize: false, settleMining: false });
  return { ok: true, registry: getAccountById(accountId).state.corp.shareRegistry };
}
