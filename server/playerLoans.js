// ISP-152 (AB#846): player-to-player loans. A corporation posts an offer, another accepts it, and the loan is serviced
// on the same tick as the Development Bank's (server/loanServicing.js), with the lender as the payee.
//
// docs/design/v0.9-debt.md, sections 1, 6 and 11. Every field of an offer is a number or an enum: there is no free text.
//   - Posting holds the principal in escrow through settleTransfer (escrow-hold); cancelling or expiry releases it back.
//   - Accepting releases the escrow to the borrower and takes the 0.5% settlement fee from the borrower (to the sink).
//   - Floor rate 2.0% per 30 days: no 0% loan can be written, so a loan is never a free gift between two accounts.
//   - Per-pair cap: 100,000 principal per rolling 30 days between two corporations, both directions, every loan.
//   - Self-dealing (the same account, or the same corporation, on both sides) is refused.
// Nothing here moves a credit except through settleTransfer; nothing trusts the request beyond the offer's own fields.
//
// No account id is stored in an offer or a loan. Both name the lender by its corporation's publicId, resolved to an
// account on the server when credits move. The market and the account state reach clients whole (sharedStateView,
// sanitizeAccount), so a stored account id would leak (Bug #711/#1134).
//
// Default (a player loan more than 7 days in arrears) is marked on the loan and told to both sides by the servicing
// tick; the lender keeps receiving what the borrower's credits cover each day. Recovering liquid holdings and
// force-selling assets (the Board's answer on AB#702) is AB#993, which needs a way to remove a building (AB#2569).
import { computeCreditRating, GRADES } from "./creditRating.js";
import { getAccountById, getStatements, getState, mutateState, mutateAccountState } from "./gameState.js";
import { accountsStore } from "./game/store.js";
import { settleTransfer } from "./settlement.js";
import { paymentSchedule } from "./loans.js";

const DAY = 86_400_000;
export const OFFER_RULES = Object.freeze({
  minPrincipal: 1_000,
  maxPrincipal: 100_000,
  minRatePct30: 2.0, // the floor (section 6)
  maxRatePct30: 25.0,
  rateStep: 0.25,
  terms: [7, 30, 90],
  expiryDays: 7,
  pairCapPrincipal: 100_000,
  pairCapDays: 30,
  settlementFeePct: 0.5
});
/** What an offer may ask of a borrower: a grade (best first) or an explicit choice to lend to unrated corporations. */
export const MIN_GRADES = Object.freeze([...GRADES.filter((g) => g !== "D"), "NR-accepted"]);

const escrowOf = (offerId) => `escrow:loan-offer-${offerId}`;
const corpOf = (accountId) => getAccountById(accountId)?.state?.corp ?? null;
/** The account whose corporation has this publicId, read from the store directly (no copy), or null. */
export function accountIdOfCorp(publicId) {
  if (!publicId) return null;
  for (const [id, account] of Object.entries(accountsStore.accounts || {})) if (account?.state?.corp?.publicId === publicId) return id;
  return null;
}
const creditsOf = (accountId) => Math.round(Number(corpOf(accountId)?.finances?.credits) || 0);

function offers(draft) {
  if (!draft.market || typeof draft.market !== "object") draft.market = {};
  if (!Array.isArray(draft.market.loanOffers)) draft.market.loanOffers = [];
  return draft.market.loanOffers;
}
const allOffers = () => (Array.isArray(getState()?.market?.loanOffers) ? getState().market.loanOffers : []);
function setOffer(id, patch) {
  mutateState((draft) => { const o = offers(draft).find((x) => x.id === id); if (o) Object.assign(o, patch); });
}

/** An offer's terms as sent, checked: { ok, terms } or { ok: false, error }. Numbers and enums only. */
export function checkOfferTerms({ principal, ratePct30, termDays, minGrade } = {}) {
  const r = OFFER_RULES;
  if (!Number.isSafeInteger(principal) || principal < r.minPrincipal || principal > r.maxPrincipal) {
    return { ok: false, error: `Principal must be a whole number of credits from ${r.minPrincipal.toLocaleString("en-US")} to ${r.maxPrincipal.toLocaleString("en-US")}.` };
  }
  if (typeof ratePct30 !== "number" || !Number.isFinite(ratePct30) || ratePct30 < r.minRatePct30 || ratePct30 > r.maxRatePct30
    || Math.abs(ratePct30 / r.rateStep - Math.round(ratePct30 / r.rateStep)) > 1e-9) {
    return { ok: false, error: `The rate must be from ${r.minRatePct30}% to ${r.maxRatePct30}% per 30 days, in steps of ${r.rateStep}. No loan is written below the floor.` };
  }
  if (!r.terms.includes(termDays)) return { ok: false, error: `The term must be ${r.terms.join(", ")} days.` };
  if (!MIN_GRADES.includes(minGrade)) return { ok: false, error: `The minimum grade must be one of ${MIN_GRADES.join(", ")}.` };
  return { ok: true, terms: { principal, ratePct30: Math.round(ratePct30 * 100) / 100, termDays, minGrade } };
}

/** Principal lent between two corporations (either direction) in loans opened in the last 30 days. */
export function pairPrincipal(accountA, accountB, now) {
  const since = now - OFFER_RULES.pairCapDays * DAY;
  let sum = 0;
  for (const [borrower, lender] of [[accountA, accountB], [accountB, accountA]]) {
    const lenderCorpId = corpOf(lender)?.publicId;
    for (const loan of corpOf(borrower)?.loans || []) {
      if (loan?.lender?.kind === "player" && lenderCorpId && loan.lender.corpId === lenderCorpId && Number(loan.openedAt) > since) sum += Number(loan.principal) || 0;
    }
  }
  return sum;
}

/** An offer as a client sees it: the lender by public id and name, never an account id or the escrow key. */
export function offerView(offer, viewerId = null) {
  const lender = corpOf(accountIdOfCorp(offer.lenderCorpId));
  const s = paymentSchedule(offer.principal, offer.ratePct30, offer.termDays);
  return {
    id: offer.id, lenderCorpId: offer.lenderCorpId, lenderName: lender?.corporationName ?? "A former corporation",
    principal: offer.principal, ratePct30: offer.ratePct30, termDays: offer.termDays, minGrade: offer.minGrade,
    dailyPayment: s.dailyPayment, totalRepaid: s.totalRepaid, settlementFee: Math.round((offer.principal * OFFER_RULES.settlementFeePct) / 100),
    state: offer.state, postedAt: offer.postedAt, expiresAt: offer.expiresAt, mine: Boolean(viewerId) && corpOf(viewerId)?.publicId === offer.lenderCorpId
  };
}

/** Release the escrow of every open offer whose time has passed, back to its lender, and mark it expired. */
export function expireLoanOffers(now) {
  for (const offer of allOffers().filter((o) => o.state === "open" && o.expiresAt <= now)) {
    const back = settleTransfer({ fromAccountId: escrowOf(offer.id), toAccountId: accountIdOfCorp(offer.lenderCorpId), credits: offer.principal, reason: "escrow-release", idempotencyKey: `loan-offer:${offer.id}:release` }, now);
    if (back.ok) setOffer(offer.id, { state: "expired", closedAt: now });
  }
}

/** The open offers, newest first. */
export function listLoanOffers(viewerId, now) {
  expireLoanOffers(now);
  return allOffers().filter((o) => o.state === "open").sort((a, b) => b.postedAt - a.postedAt).map((o) => offerView(o, viewerId));
}

let seq = 0;
/** Post an offer: the principal goes into escrow first; the offer exists only if it did. */
export function postLoanOffer(accountId, input, now) {
  const lender = corpOf(accountId);
  if (!lender?.publicId) return { ok: false, status: 404, error: "No such corporation." };
  const checked = checkOfferTerms(input);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const t = checked.terms;
  if (creditsOf(accountId) < t.principal) return { ok: false, status: 409, error: `Offering this loan holds ${t.principal.toLocaleString("en-US")} credits in escrow, and you have ${creditsOf(accountId).toLocaleString("en-US")}.` };
  const id = `lo-${now.toString(36)}-${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const held = settleTransfer({ fromAccountId: accountId, toAccountId: escrowOf(id), credits: t.principal, reason: "escrow-hold", idempotencyKey: `loan-offer:${id}:hold` }, now);
  if (!held.ok) return { ok: false, status: 409, error: `The principal could not be held in escrow: ${held.error}` };
  const offer = { id, lenderCorpId: lender.publicId, ...t, escrowKey: escrowOf(id), state: "open", postedAt: now, expiresAt: now + OFFER_RULES.expiryDays * DAY };
  mutateState((draft) => { offers(draft).push(offer); });
  return { ok: true, offer: offerView(offer, accountId) };
}

/** Cancel one's own open offer: the escrow goes back to the lender. */
export function cancelLoanOffer(accountId, offerId, now) {
  const offer = allOffers().find((o) => o.id === offerId);
  if (!offer || !corpOf(accountId)?.publicId || corpOf(accountId).publicId !== offer.lenderCorpId) return { ok: false, status: 404, error: "No such offer of yours." };
  if (offer.state !== "open") return { ok: false, status: 409, error: "That offer is no longer open." };
  const back = settleTransfer({ fromAccountId: escrowOf(offer.id), toAccountId: accountId, credits: offer.principal, reason: "escrow-release", idempotencyKey: `loan-offer:${offer.id}:release` }, now);
  if (!back.ok) return { ok: false, status: 409, error: `The escrow could not be released: ${back.error}` };
  setOffer(offer.id, { state: "cancelled", closedAt: now });
  return { ok: true, offer: offerView({ ...offer, state: "cancelled" }, accountId) };
}

/**
 * Accept an offer. Refused, with nothing moved, when: the offer is not open or has expired; the borrower is the lender;
 * the borrower's grade is below the offer's minimum (or unrated without NR-accepted, or D); the pair would pass its
 * 30-day cap; or the escrow no longer holds the principal. Otherwise the escrow goes to the borrower, the settlement fee
 * to the sink, and the loan is written on the borrower with the lender as counterparty.
 */
export function acceptLoanOffer(accountId, offerId, now) {
  expireLoanOffers(now);
  const offer = allOffers().find((o) => o.id === offerId);
  if (!offer) return { ok: false, status: 404, error: "No such offer." };
  if (offer.state !== "open") return { ok: false, status: 409, error: "That offer is no longer open." };
  const lenderAccountId = accountIdOfCorp(offer.lenderCorpId);
  const borrower = corpOf(accountId);
  if (!borrower?.publicId) return { ok: false, status: 404, error: "No such corporation." };
  if (!lenderAccountId) return { ok: false, status: 409, error: "The corporation that made this offer no longer exists." };
  if (accountId === lenderAccountId || borrower.publicId === offer.lenderCorpId) {
    return { ok: false, status: 409, error: "A corporation cannot borrow from itself." };
  }
  const grade = computeCreditRating(borrower, now, getStatements(accountId, 30, now)?.statements ?? []).grade;
  if (grade === "D") return { ok: false, status: 409, error: "No new credit at grade D." };
  if (grade === "NR" ? offer.minGrade !== "NR-accepted" : offer.minGrade !== "NR-accepted" && GRADES.indexOf(grade) > GRADES.indexOf(offer.minGrade)) {
    return { ok: false, status: 409, error: `This offer asks for a grade of ${offer.minGrade} or better; yours is ${grade}.` };
  }
  const already = pairPrincipal(accountId, lenderAccountId, now);
  if (already + offer.principal > OFFER_RULES.pairCapPrincipal) {
    return { ok: false, status: 409, error: `Two corporations may lend each other at most ${OFFER_RULES.pairCapPrincipal.toLocaleString("en-US")} credits in 30 days; ${already.toLocaleString("en-US")} is already lent between you.` };
  }
  const held = Math.round(Number(getState()?.settlement?.escrow?.[escrowOf(offer.id)]) || 0);
  if (held !== offer.principal) return { ok: false, status: 409, error: "That offer's escrow no longer holds its principal. Nothing was moved." };
  const fee = Math.round((offer.principal * OFFER_RULES.settlementFeePct) / 100);

  setOffer(offer.id, { state: "taking" }); // taken now, synchronously: a second accept is refused from here on
  const lent = settleTransfer({ fromAccountId: escrowOf(offer.id), toAccountId: accountId, credits: offer.principal, reason: "escrow-release", idempotencyKey: `loan-offer:${offer.id}:release` }, now);
  if (!lent.ok) { setOffer(offer.id, { state: "open" }); return { ok: false, status: 409, error: `The escrow could not be released: ${lent.error}` }; }
  const paidFee = fee > 0
    ? settleTransfer({ fromAccountId: accountId, toAccountId: "sink:fee", credits: fee, reason: "fee", idempotencyKey: `loan-offer:${offer.id}:fee` }, now)
    : { ok: true };
  const s = paymentSchedule(offer.principal, offer.ratePct30, offer.termDays);
  const loan = {
    id: `loan-p-${offer.id.slice(3)}`,
    lender: { kind: "player", corpId: offer.lenderCorpId },
    borrowerCorpId: borrower.publicId ?? null,
    principal: offer.principal, ratePct30: offer.ratePct30, termDays: offer.termDays,
    dailyPayment: s.dailyPayment, lastPayment: s.lastPayment, balance: offer.principal, paymentsMade: 0,
    nextDueAt: now + DAY, arrears: 0, arrearsSince: null, state: "active", openedAt: now, closedAt: null,
    offerId: offer.id, ...(paidFee.ok ? {} : { feeUnpaid: fee })
  };
  mutateAccountState(accountId, (state) => {
    if (!Array.isArray(state.corp.loans)) state.corp.loans = [];
    state.corp.loans.push(loan);
  }, { sanitize: false });
  setOffer(offer.id, { state: "taken", closedAt: now, borrowerCorpId: borrower.publicId, loanId: loan.id });
  return { ok: true, loan: loanView(loan) };
}

/** A loan as its borrower sees it, with the lender's name. */
export function loanView(loan) {
  const { lender, ...rest } = loan;
  return { ...rest, lender: lender?.kind === "player" ? { ...lender, name: corpOf(accountIdOfCorp(lender.corpId))?.corporationName ?? "A former corporation" } : lender };
}
