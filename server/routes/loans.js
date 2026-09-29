// ISP-149 (AB#843): the Deep Space Development Bank's loans for the caller's corporation. Under /api/accounts/:accountId,
// so requireAuth and requireAccountAccess have run, and the input middleware has checked the body (ACCOUNT_INPUT).
// Every term is priced on the server (server/loans.js); the body's only inputs are the product and principal to quote,
// and the quote to accept.
import { quoteLoan, acceptLoan, loanOffers } from "../loans.js";
import { getAccountById } from "../gameState.js";
import { sanitizeAccount } from "../game/store.js";

const credits = (n) => `${Math.round(n).toLocaleString("en-US")} credits`;
const day = (t) => utcTime(t, { withDate: true }); // ISP-249 (AB#945)

/** ISP-19: what the confirmation after borrowing says. The Bank's voice; figures from the loan the server recorded. */
function borrowReceipt(loan, fee) {
  return {
    title: `Loan of ${credits(loan.principal)} disbursed`,
    summary: `The Deep Space Development Bank has advanced ${credits(loan.principal)} to your corporation on a ${loan.termDays}-day facility at ${loan.ratePct30}% per 30 days.`,
    cost: `${credits(fee)} origination fee, taken at disbursal`,
    grants: [
      { label: "Received", value: credits(loan.principal - fee) },
      { label: "Daily payment", value: `${credits(loan.dailyPayment)} for ${loan.termDays} days` },
      { label: "First payment", value: day(loan.nextDueAt) }
    ],
    next: "Keep the payment on hand each day: a payment the Bank cannot collect goes into arrears, with a late fee and penalty interest."
  };
}

function payoffReceipt(loan, paid) {
  return {
    title: "Loan paid off",
    summary: `The Deep Space Development Bank has marked your ${loan.termDays}-day facility of ${credits(loan.principal)} settled in full.`,
    cost: `${credits(paid)}, including the 1% early settlement fee`,
    grants: [{ label: "Owed to the Bank on this facility", value: credits(0) }],
    next: "Your credit record will show the facility closed at the next rating."
  };
}
const answer = (accountId, extra) => ({ ...sanitizeAccount(getAccountById(accountId)), ...extra });
import { payOffLoan } from "../loanServicing.js"; // ISP-150 (AB#844)
import { listLoanOffers, postLoanOffer, cancelLoanOffer, acceptLoanOffer, OFFER_RULES, MIN_GRADES, gradeOf, playerLoansOf } from "../playerLoans.js"; // ISP-152 (AB#846), ISP-153 (AB#847)
import { bodyNumber } from "../bodyNumber.js";
import { utcTime } from "../../public/scripts/timeFormat.js"; // ISP-249 (AB#945): one format for every timestamp

export function registerLoanRoutes(app) {
  // ISP-151 (AB#845): the products and this corporation's limit on each, for the Development Bank's view
  app.get("/api/accounts/:accountId/loans/offers", (req, res) => {
    const offers = loanOffers(req.params.accountId);
    if (!offers) return res.status(404).json({ error: "No such corporation." });
    res.json(offers);
  });

  app.post("/api/accounts/:accountId/loans/quote", (req, res) => {
    const r = quoteLoan(req.params.accountId, { productId: req.body?.productId, principal: bodyNumber(req.body?.principal, { fallback: NaN }) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ quote: r.quote });
  });

  app.post("/api/accounts/:accountId/loans/accept", (req, res) => {
    const r = acceptLoan(req.params.accountId, { quoteId: req.body?.quoteId });
    if (!r.ok) return res.status(409).json({ error: r.error, ...(r.terms ? { terms: r.terms } : {}) });
    res.json(answer(req.params.accountId, { loan: r.loan, receipt: borrowReceipt(r.loan, r.fee) }));
  });

  // ISP-150 (AB#844): repay a loan early: the principal still owed, the arrears and a 1% fee, all at once.
  app.post("/api/accounts/:accountId/loans/:loanId/payoff", (req, res) => {
    const r = payOffLoan(req.params.accountId, req.params.loanId, Date.now());
    if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) }); // ISP-255 (AB#4824)
    res.json(answer(req.params.accountId, { loan: r.loan, paid: r.paid, receipt: payoffReceipt(r.loan, r.paid) }));
  });

  // ISP-152 (AB#846): the player loan board. Offers are numbers and enums only; the lender's principal is held in
  // escrow while an offer is open. Every rule (the floor rate, the per-pair cap, self-dealing) is checked on the server.
  app.get("/api/accounts/:accountId/loan-offers", (req, res) => {
    const now = Date.now();
    // AB#847: the caller's own grade, so the board can say which offers it may take
    res.json({ offers: listLoanOffers(req.params.accountId, now), rules: OFFER_RULES, minGrades: MIN_GRADES, grade: gradeOf(req.params.accountId, now) });
  });

  // ISP-153 (AB#847): the caller's player loans, lent and borrowed, with each borrower's grade and any recovery.
  app.get("/api/accounts/:accountId/player-loans", (req, res) => {
    res.json(playerLoansOf(req.params.accountId, Date.now()));
  });

  app.post("/api/accounts/:accountId/loan-offers", (req, res) => {
    const r = postLoanOffer(req.params.accountId, {
      principal: bodyNumber(req.body?.principal, { fallback: NaN }),
      ratePct30: bodyNumber(req.body?.ratePct30, { fallback: NaN }),
      termDays: bodyNumber(req.body?.termDays, { fallback: NaN }),
      minGrade: typeof req.body?.minGrade === "string" ? req.body.minGrade : ""
    }, Date.now());
    if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) }); // ISP-255 (AB#4824)
    res.status(201).json({ offer: r.offer });
  });

  app.post("/api/accounts/:accountId/loan-offers/:offerId/cancel", (req, res) => {
    const r = cancelLoanOffer(req.params.accountId, req.params.offerId, Date.now());
    if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) }); // ISP-255 (AB#4824)
    res.json({ offer: r.offer });
  });

  app.post("/api/accounts/:accountId/loan-offers/:offerId/accept", (req, res) => {
    const r = acceptLoanOffer(req.params.accountId, req.params.offerId, Date.now());
    if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) }); // ISP-255 (AB#4824)
    res.json({ loan: r.loan });
  });
}
