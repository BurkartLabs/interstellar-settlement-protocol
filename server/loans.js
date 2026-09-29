// ISP-149 (AB#843): NPC loans from the Deep Space Development Bank: quote, then accept.
//
// docs/design/v0.9-debt.md, sections 2 and 5. The bank lends from a tap (`tap:dsdb`): principal is created when it is
// lent and destroyed when it is repaid (section 9). Its catalog is data/loan-products.json: three products, a spread
// per credit grade, and a principal cap as a multiple of trailing 30-day income.
//
// Every number here is the server's. A quote rates the corporation as if the loan were already taken (section 4,
// "Quoting uses the grade after the loan"), so borrowing more costs more per credit; that is the decision (section 8).
// Accepting looks the quote up on the server, prices it again, and refuses if anything moved; nothing in the request
// but the quote's id is read. A quote is accepted once: the second accept is refused, and the disbursal's idempotency
// key is the quote, so even a retry after a crash moves the principal once.
//
// This is an instrument module: it is what moves value through server/settlement.js; no route imports that directly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeCreditRating } from "./creditRating.js";
import { getAccountById, getStatements, mutateAccountState } from "./gameState.js";
import { settleTransfer } from "./settlement.js";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "loan-products.json");
/** The Development Bank's catalog, as data. */
export const LOAN_CATALOG = Object.freeze(JSON.parse(fs.readFileSync(FILE, "utf8")));
const DAY = 86_400_000;

const productOf = (id) => LOAN_CATALOG.products.find((p) => p.id === id) ?? null;
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * The amortising schedule (section 2): equal daily payments at the daily rate r = ratePct30 / 100 / 30, the last one
 * absorbing the rounding so the payments sum exactly to what is owed.
 */
export function paymentSchedule(principal, ratePct30, termDays) {
  const r = ratePct30 / 100 / 30;
  const exact = r === 0 ? principal / termDays : (principal * r) / (1 - (1 + r) ** -termDays);
  const dailyPayment = Math.round(exact);
  // what is owed in all: the balance run forward day by day, so the last payment settles it to the credit
  let balance = principal;
  for (let d = 1; d < termDays; d++) balance = balance * (1 + r) - dailyPayment;
  const lastPayment = Math.round(balance * (1 + r));
  const totalRepaid = dailyPayment * (termDays - 1) + lastPayment;
  return { dailyPayment, payments: termDays, lastPayment, totalRepaid, totalInterest: totalRepaid - principal };
}

/**
 * Price a loan for a corporation from its statements: { ok: true, terms } or { ok: false, error }. Pure.
 * Terms: product, principal, rate, the schedule, the origination fee, the grade before and after, and the cap.
 */
export function priceLoan({ corp, statements, productId, principal, now = Date.now() }) {
  const product = productOf(productId);
  if (!product) return { ok: false, error: "No such loan product." };
  if (!Number.isSafeInteger(principal) || principal < LOAN_CATALOG.minPrincipal) {
    return { ok: false, error: `Principal must be a whole number of credits, at least ${LOAN_CATALOG.minPrincipal.toLocaleString("en-US")}.` };
  }
  const before = computeCreditRating(corp, now, statements);
  if (before.grade === "D") return { ok: false, error: "The Development Bank extends no new credit at grade D." };

  let spread, gradeAfter, maxPrincipal;
  if (before.grade === "NR") {
    // NR fails closed (section 3): the longest product only, at the widest spread, and a small cap
    const nr = LOAN_CATALOG.notRated;
    if (product.id !== nr.productId) return { ok: false, error: `Unrated corporations may borrow only on ${nr.productId}.` };
    maxPrincipal = nr.maxPrincipal;
    spread = nr.spreadPct30;
    gradeAfter = "NR";
  } else {
    const window = [...statements].sort((a, b) => a.dayStart - b.dayStart).slice(-30);
    const income30 = window.reduce((s, st) => s + (Number(st.pnl?.totalIncome) || 0), 0);
    maxPrincipal = Math.floor(product.maxPrincipalMultiple * income30);
    if (principal <= maxPrincipal) {
      const after = computeCreditRating(corp, now, statements, { proForma: { debt: principal, assets: principal } });
      gradeAfter = after.grade;
      if (gradeAfter === "D" || gradeAfter === "NR") return { ok: false, error: "Borrowing this much would leave no credit: the grade after it would be D. Borrow less." };
      spread = LOAN_CATALOG.spreadPct30[gradeAfter];
    }
  }
  if (principal > maxPrincipal) {
    return { ok: false, error: `At most ${maxPrincipal.toLocaleString("en-US")} credits on ${product.id}${before.grade === "NR" ? " while unrated" : " (a multiple of your last 30 days' income)"}.` };
  }
  const ratePct30 = round2(product.baseRatePct30 + spread);
  return {
    ok: true,
    terms: {
      productId: product.id, termDays: product.termDays, principal, ratePct30,
      ...paymentSchedule(principal, ratePct30, product.termDays),
      originationFee: Math.round((principal * LOAN_CATALOG.originationPct) / 100),
      gradeBefore: before.grade, gradeAfter, maxPrincipal
    }
  };
}

// Quotes live for LOAN_CATALOG.quoteMinutes, in memory: a restart forgets them and the player quotes again.
const quotes = new Map();
let quoteSeq = 0;

function statementsOf(accountId, now) {
  return getStatements(accountId, 30, now)?.statements ?? [];
}

/** Quote a loan for an account's corporation: { ok, quote } or { ok: false, error }. */
export function quoteLoan(accountId, { productId, principal } = {}, now = Date.now()) {
  const corp = getAccountById(accountId)?.state?.corp;
  if (!corp) return { ok: false, error: "No such corporation." };
  const priced = priceLoan({ corp, statements: statementsOf(accountId, now), productId, principal, now });
  if (!priced.ok) return priced;
  for (const [id, q] of quotes) if (q.expiresAt < now) quotes.delete(id);
  const quote = { id: `lq-${now.toString(36)}-${(++quoteSeq).toString(36)}`, accountId, terms: priced.terms, createdAt: now, expiresAt: now + LOAN_CATALOG.quoteMinutes * 60_000, state: "open" };
  quotes.set(quote.id, quote);
  return { ok: true, quote: { id: quote.id, expiresAt: quote.expiresAt, ...quote.terms } };
}

const SAME = ["productId", "termDays", "principal", "ratePct30", "dailyPayment", "lastPayment", "originationFee"];

/**
 * Accept a quote: price it again, refuse if anything moved, then disburse through settleTransfer (loan-disbursal from
 * the bank's tap), take the origination fee (fee, to the sink) and record the loan on the borrower (section 1).
 */
export function acceptLoan(accountId, { quoteId } = {}, now = Date.now()) {
  const quote = typeof quoteId === "string" ? quotes.get(quoteId) : null;
  if (!quote || quote.accountId !== accountId) return { ok: false, error: "No such quote. Ask for a new one." };
  if (quote.state !== "open") return { ok: false, error: "That quote has already been used. Ask for a new one." };
  if (quote.expiresAt < now) { quotes.delete(quote.id); return { ok: false, error: "That quote has expired. Ask for a new one." }; }
  quote.state = "accepting"; // taken now, synchronously: a second accept of this quote is refused from here on

  const corp = getAccountById(accountId)?.state?.corp;
  const again = corp ? priceLoan({ corp, statements: statementsOf(accountId, now), productId: quote.terms.productId, principal: quote.terms.principal, now }) : { ok: false, error: "No such corporation." };
  if (!again.ok) { quote.state = "refused"; return { ok: false, error: `${again.error} The quote no longer holds.` }; }
  if (SAME.some((k) => again.terms[k] !== quote.terms[k])) {
    quote.state = "refused";
    return { ok: false, error: "Your terms have changed since the quote. Ask for a new one.", terms: again.terms };
  }

  const t = quote.terms;
  const lent = settleTransfer({ fromAccountId: LOAN_CATALOG.tap, toAccountId: accountId, credits: t.principal, reason: "loan-disbursal", idempotencyKey: `loan:${quote.id}` }, now);
  if (!lent.ok) { quote.state = "refused"; return { ok: false, error: `The bank could not disburse: ${lent.error}` }; }
  const fee = t.originationFee > 0
    ? settleTransfer({ fromAccountId: accountId, toAccountId: "sink:fee", credits: t.originationFee, reason: "fee", idempotencyKey: `loan-fee:${quote.id}` }, now)
    : { ok: true };
  const loan = {
    id: `loan-${quote.id.slice(3)}`,
    lender: { kind: "npc", productId: t.productId },
    borrowerCorpId: corp.publicId ?? null,
    principal: t.principal,
    ratePct30: t.ratePct30,
    termDays: t.termDays,
    dailyPayment: t.dailyPayment,
    lastPayment: t.lastPayment,
    balance: t.principal,
    paymentsMade: 0,
    nextDueAt: now + DAY,
    arrears: 0,
    arrearsSince: null,
    state: "active",
    openedAt: now,
    closedAt: null,
    quoteId: quote.id,
    ...(fee.ok ? {} : { feeUnpaid: t.originationFee })
  };
  mutateAccountState(accountId, (state) => {
    if (!Array.isArray(state.corp.loans)) state.corp.loans = [];
    state.corp.loans.push(loan);
  }, { sanitize: false });
  quote.state = "accepted";
  return { ok: true, loan, fee: fee.ok ? t.originationFee : 0 };
}

/**
 * ISP-151 (AB#845): what the Development Bank offers this corporation now: its grade, and for each product the most it
 * would lend (NR: the one product NR may use, up to its cap; D: nothing). Limits only: every rate is quoted.
 */
export function loanOffers(accountId, now = Date.now()) {
  const corp = getAccountById(accountId)?.state?.corp;
  if (!corp) return null;
  const statements = statementsOf(accountId, now);
  const rating = computeCreditRating(corp, now, statements);
  const window = [...statements].sort((a, b) => a.dayStart - b.dayStart).slice(-30);
  const income30 = window.reduce((s, st) => s + (Number(st.pnl?.totalIncome) || 0), 0);
  const products = LOAN_CATALOG.products.map((p) => {
    let maxPrincipal = 0, why = null;
    if (rating.grade === "D") why = "No new credit at grade D.";
    else if (rating.grade === "NR") {
      if (p.id === LOAN_CATALOG.notRated.productId) maxPrincipal = LOAN_CATALOG.notRated.maxPrincipal;
      else why = `Unrated corporations borrow on ${LOAN_CATALOG.notRated.productId} only.`;
    } else maxPrincipal = Math.floor(p.maxPrincipalMultiple * income30);
    if (!why && maxPrincipal < LOAN_CATALOG.minPrincipal) { why = "Too little income over the last 30 days to borrow on this product."; maxPrincipal = 0; }
    return { ...p, maxPrincipal, available: !why, ...(why ? { why } : {}) };
  });
  return { grade: rating.grade, minPrincipal: LOAN_CATALOG.minPrincipal, originationPct: LOAN_CATALOG.originationPct, quoteMinutes: LOAN_CATALOG.quoteMinutes, products };
}

/** For tests: forget every quote. */
export function clearQuotes() { quotes.clear(); }
