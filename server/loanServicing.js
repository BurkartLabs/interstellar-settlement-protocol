// ISP-150 (AB#844): servicing loans on the tick: the day's payment, arrears, penalty interest, and early payoff.
//
// docs/design/v0.9-debt.md, sections 2, 9 and 10. Written for the Development Bank's loans (ISP-149); a player lender
// (v0.9-08) and the bond stories reuse it with a corporation as the counterparty.
//
// A loan is the record acceptLoan wrote on the borrower (corp.loans[]). `balance` is the principal still scheduled;
// `arrears` is what fell due and was not paid, held as three parts so each is paid where it belongs:
//   arrearsFees      late fees, 5% of each missed payment          -> sink:fee
//   arrearsInterest  the interest part of missed payments, and the penalty interest that accrues on arrears daily at
//                    the loan's rate plus 15 points per 30 days     -> sink:loan-interest
//   arrearsPrincipal the principal part of missed payments        -> the lender (the bank's tap, which destroys it)
// and `arrears` is always their sum. Collected in that order: fees, then interest, then principal.
//
// The schedule is exact: payment k's principal part is the amortisation curve's drop from day k-1 to day k, rounded at
// both ends, so the principal parts sum to the principal and the payments to the quoted total, to the credit.
//
// Non-destructive, always (section 10). Nothing here takes a building, a lease, inventory, or credits beyond what a day
// collects, and nothing removes a corporation. A loan left in arrears caps the credit grade at CCC and, after 7 days,
// makes it D (server/creditRating.js), and D means no new credit (server/loans.js). That is what default is, for the bank.
//
// Every movement goes through settleTransfer with an idempotency key naming the loan and the day, so a tick that runs
// twice, or a retry, collects once. Time is always passed in (P-TEST-TIME): nothing here reads the clock.

import { addAccountNotification, getAccountById, getAllAccountIds, mutateAccountState } from "./gameState.js";
import { settleTransfer } from "./settlement.js";
import { emitToAccount } from "./realtime.js";
import { LOAN_CATALOG } from "./loans.js";
import { accountIdOfCorp } from "./playerLoans.js"; // ISP-152 (AB#846): a player lender is named by publicId

const DAY = 86_400_000;
/** Late fee on a missed payment, and the penalty rate over the loan's rate, per 30 days (section 2). */
export const LATE_FEE_PCT = 5;
export const PENALTY_POINTS_PCT30 = 15;
/** Early payoff's fee, on the principal still owed (section 2). */
export const EARLY_PAYOFF_FEE_PCT = 1;

/** The principal still scheduled after `k` of the loan's payments, on its amortisation curve (0 after the last). */
export function scheduledBalance(loan, k) {
  if (k <= 0) return loan.principal;
  if (k >= loan.termDays) return 0;
  const r = loan.ratePct30 / 100 / 30;
  const exact = r === 0 ? loan.principal - loan.dailyPayment * k : loan.principal * (1 + r) ** k - loan.dailyPayment * (((1 + r) ** k - 1) / r);
  return Math.max(0, Math.round(exact));
}

/** Payment k (1..termDays): its amount, and its principal and interest parts. */
export function paymentParts(loan, k) {
  const amount = k === loan.termDays ? loan.lastPayment : loan.dailyPayment;
  const principalPart = scheduledBalance(loan, k - 1) - scheduledBalance(loan, k);
  return { amount, principalPart, interestPart: amount - principalPart };
}

const open = (loan) => loan && (loan.state === "active" || loan.state === "arrears");
const lenderAccount = (loan) => (loan.lender?.kind === "npc" ? LOAN_CATALOG.tap : accountIdOfCorp(loan.lender?.corpId));
const creditsOf = (accountId) => Math.round(Number(getAccountById(accountId)?.state?.corp?.finances?.credits) || 0);
/** ISP-152 (AB#846): a player loan past this many days of arrears is in default (docs/design/v0.9-debt.md, section 10). */
export const PLAYER_DEFAULT_DAYS = 7;
const lenderName = (loan) => (loan.lender?.kind === "player"
  ? `${getAccountById(accountIdOfCorp(loan.lender.corpId))?.state?.corp?.corporationName || "a former corporation"}'s loan`
  : "Development Bank loan");

/** Pay `credits` for a part of a loan: fees to the fee sink, interest to its sink (or the lender), principal to the lender. */
function pay(accountId, loan, part, credits, key, now) {
  if (credits <= 0) return true;
  const to = part === "fee" ? "sink:fee" : part === "interest" ? (loan.lender?.kind === "npc" ? "sink:loan-interest" : lenderAccount(loan)) : lenderAccount(loan);
  const reason = part === "fee" ? "fee" : part === "interest" ? "loan-interest" : "loan-repayment";
  return settleTransfer({ fromAccountId: accountId, toAccountId: to, credits, reason, idempotencyKey: key }, now).ok;
}

/** Collect what the borrower can of its arrears, fees first, then interest, then principal. Changes `loan`. */
function collectArrears(accountId, loan, now, tag) {
  for (const [part, field] of [["fee", "arrearsFees"], ["interest", "arrearsInterest"], ["principal", "arrearsPrincipal"]]) {
    const take = Math.min(loan[field] || 0, creditsOf(accountId));
    if (take > 0 && pay(accountId, loan, part, take, `${tag}:arrears:${part}`, now)) loan[field] -= take;
  }
  loan.arrears = (loan.arrearsFees || 0) + (loan.arrearsInterest || 0) + (loan.arrearsPrincipal || 0);
}

/**
 * ISP-286 (AB#993): what a defaulted loan owes in all: its arrears (late fees, interest and principal that fell due) and
 * the principal still scheduled. Interest that had not yet fallen due is not owed.
 */
export const owedOnDefault = (loan) => (Number(loan?.arrears) || 0) + (Number(loan?.balance) || 0);

/**
 * ISP-286 (AB#993): collect what the borrower's credits cover of everything the loan owes: its arrears first (fees,
 * interest, principal, as servicing does), then the principal still scheduled, to the lender. The loan closes, repaid,
 * when nothing is owed. Returns the credits collected. Changes `loan`; the caller saves it. `tag` names the step, so
 * each settleTransfer key is used once.
 */
export function collectOwed(accountId, loan, now, tag) {
  const before = owedOnDefault(loan);
  collectArrears(accountId, loan, now, tag);
  if (loan.arrears === 0) {
    const take = Math.min(Number(loan.balance) || 0, creditsOf(accountId));
    if (take > 0 && pay(accountId, loan, "principal", take, `${tag}:balance`, now)) loan.balance -= take;
  }
  if (owedOnDefault(loan) === 0) Object.assign(loan, { state: "repaid", closedAt: now, arrearsSince: null });
  return before - owedOnDefault(loan);
}

/**
 * Service one loan up to `now`: every day that has come due since nextDueAt, in order. Returns what happened, for the
 * tick's notifications: { paid, missed, repaid }. Changes `loan` in place; the caller saves it.
 */
export function serviceLoan(accountId, loan, now) {
  const out = { paid: 0, missed: 0, repaid: false };
  if (!open(loan)) return out;
  for (const f of ["arrearsFees", "arrearsInterest", "arrearsPrincipal"]) loan[f] = Math.max(0, Math.round(Number(loan[f]) || 0));
  while (open(loan) && loan.nextDueAt <= now) {
    const day = loan.nextDueAt;
    const tag = `loan:${loan.id}:${day}`;
    // 1. arrears accrue penalty interest for the day, then are collected first
    if (loan.arrears > 0) {
      const penaltyRate = (loan.ratePct30 + PENALTY_POINTS_PCT30) / 100 / 30;
      loan.arrearsInterest += Math.round(loan.arrears * penaltyRate);
      loan.arrears = loan.arrearsFees + loan.arrearsInterest + loan.arrearsPrincipal;
      collectArrears(accountId, loan, day, tag);
    }
    // 2. the day's scheduled payment, whole or not at all
    if (loan.paymentsMade < loan.termDays) {
      const k = loan.paymentsMade + 1;
      const { amount, principalPart, interestPart } = paymentParts(loan, k);
      if (loan.arrears === 0 && creditsOf(accountId) >= amount) {
        const ok = pay(accountId, loan, "interest", interestPart, `${tag}:interest`, day) && pay(accountId, loan, "principal", principalPart, `${tag}:principal`, day);
        if (!ok) throw new Error(`loan ${loan.id}: a covered payment was refused`); // cannot happen: the credits were there
        out.paid++;
      } else {
        // missed: the payment joins the arrears, with the late fee
        loan.arrearsPrincipal += principalPart;
        loan.arrearsInterest += interestPart;
        loan.arrearsFees += Math.round((amount * LATE_FEE_PCT) / 100);
        loan.arrears = loan.arrearsFees + loan.arrearsInterest + loan.arrearsPrincipal;
        out.missed++;
      }
      loan.paymentsMade = k;
      loan.balance = scheduledBalance(loan, k);
    }
    // 3. the state, and the next day
    if (loan.arrears > 0) {
      if (loan.state !== "arrears") { loan.state = "arrears"; loan.arrearsSince = day; }
    } else {
      loan.arrearsSince = null;
      loan.state = "active";
    }
    if (loan.paymentsMade >= loan.termDays && loan.arrears === 0) {
      loan.state = "repaid";
      loan.closedAt = day;
      out.repaid = true;
    }
    loan.nextDueAt = day + DAY;
  }
  return out;
}

/** The borrower's corporation's loans that are open, each with its account. */
function openLoans() {
  const out = [];
  for (const accountId of getAllAccountIds()) {
    const loans = getAccountById(accountId)?.state?.corp?.loans;
    if (Array.isArray(loans)) for (const loan of loans) if (open(loan)) out.push({ accountId, loan });
  }
  return out;
}

/**
 * The servicing tick: every open loan's due days, collected or put into arrears. Tells the borrower when a payment is
 * missed and when a loan is repaid. `now` is passed in (the server passes Date.now()).
 */
export function loanServicingTick(now) {
  for (const { accountId, loan } of openLoans()) {
    if (loan.nextDueAt > now) continue;
    const before = loan.state;
    const r = serviceLoan(accountId, loan, now);
    mutateAccountState(accountId, (state) => {
      const i = (state.corp.loans || []).findIndex((l) => l.id === loan.id);
      if (i !== -1) state.corp.loans[i] = { ...loan };
    }, { sanitize: false, settleMining: false });
    // ISP-255 (AB#4824): a notice's protocol, on the Loan Board for a player loan and at the Bank for the Bank's
    const screen = loan.lender?.kind === "player" ? "loans-board" : "building-deep-space-development-bank";
    const tellTo = (id, title, body, meaning) => {
      const n = id ? addAccountNotification(id, { type: "finance", title, body, protocol: { meaning, screen } }) : null;
      if (n) emitToAccount(id, "notifications:new", { accountId: id, notification: n });
    };
    const tell = (title, body, meaning) => tellTo(accountId, title, body, meaning);
    const player = loan.lender?.kind === "player";
    const borrowerName = getAccountById(accountId)?.state?.corp?.corporationName || "A corporation";
    if (r.missed && before !== "arrears") {
      tell("Loan payment missed", `A payment of ${loan.dailyPayment.toLocaleString("en-US")} credits on your ${lenderName(loan)} could not be collected. ${loan.arrears.toLocaleString("en-US")} credits are now in arrears, including a ${LATE_FEE_PCT}% late fee, and accrue penalty interest until paid. Your credit rating is capped at CCC while they are, and falls to D after 7 days.`, "owed");
      if (player) tellTo(lenderAccount(loan), "A borrower missed a payment", `${borrowerName} missed a payment on your loan of ${loan.principal.toLocaleString("en-US")} credits. What its credits cover is collected for you each day.`, "owed");
    }
    if (r.repaid) {
      tell("Loan repaid", `Your ${lenderName(loan)} of ${loan.principal.toLocaleString("en-US")} credits is repaid in full.`, "complete");
      if (player) tellTo(lenderAccount(loan), "Loan repaid", `${borrowerName} has repaid your loan of ${loan.principal.toLocaleString("en-US")} credits in full.`, "complete");
    }
    // ISP-152 (AB#846): a player loan more than 7 days in arrears is in default, marked once and told to both sides.
    // Collection of the borrower's credits goes on each day; recovering its other holdings is AB#993.
    if (player && loan.state === "arrears" && loan.arrearsSince && now - loan.arrearsSince > PLAYER_DEFAULT_DAYS * DAY && !loan.defaultedAt) {
      loan.defaultedAt = now;
      mutateAccountState(accountId, (state) => {
        const i = (state.corp.loans || []).findIndex((l) => l.id === loan.id);
        if (i !== -1) state.corp.loans[i] = { ...loan };
      }, { sanitize: false, settleMining: false });
      tell("Loan in default", `Your ${lenderName(loan)} is more than ${PLAYER_DEFAULT_DAYS} days in arrears and is now in default. ${loan.arrears.toLocaleString("en-US")} credits are owed now; whatever credits you hold go to your lender each day until it is paid.`, "failed");
      tellTo(lenderAccount(loan), "A loan is in default", `${borrowerName} is more than ${PLAYER_DEFAULT_DAYS} days in arrears on your loan of ${loan.principal.toLocaleString("en-US")} credits. Its credits are collected for you each day.`, "failed");
    }
  }
}

/**
 * Early payoff: the principal still owed, the arrears, and a fee of 1% of that principal, all at once, and the loan
 * closes. { ok: true, loan, paid } or { ok: false, error }; refused, with nothing taken, if the credits do not cover it.
 */
export function payOffLoan(accountId, loanId, now) {
  const loan = getAccountById(accountId)?.state?.corp?.loans?.find((l) => l.id === loanId);
  if (!loan) return { ok: false, status: 404, error: "No such loan." };
  if (!open(loan)) return { ok: false, status: 409, error: "That loan is already closed." };
  const fee = Math.round((loan.balance * EARLY_PAYOFF_FEE_PCT) / 100);
  const total = loan.balance + loan.arrears + fee;
  if (creditsOf(accountId) < total) return { ok: false, status: 409, code: "insufficient-credits", error: `Paying it off takes ${total.toLocaleString("en-US")} credits; you have ${creditsOf(accountId).toLocaleString("en-US")}. Keep paying daily, or raise the credits and pay it off then.` }; // AB#4824 (ISP-6)
  const tag = `loan:${loan.id}:payoff:${now}`;
  collectArrears(accountId, loan, now, tag);
  pay(accountId, loan, "principal", loan.balance, `${tag}:principal`, now);
  pay(accountId, loan, "fee", fee, `${tag}:fee`, now);
  Object.assign(loan, { balance: 0, arrears: 0, arrearsFees: 0, arrearsInterest: 0, arrearsPrincipal: 0, arrearsSince: null, state: "repaid", closedAt: now, paidOffEarly: true });
  mutateAccountState(accountId, (state) => {
    const i = (state.corp.loans || []).findIndex((l) => l.id === loan.id);
    if (i !== -1) state.corp.loans[i] = { ...loan };
  }, { sanitize: false, settleMining: false });
  return { ok: true, loan, paid: total };
}
