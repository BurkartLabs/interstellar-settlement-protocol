// ISP-149 (AB#843): the Deep Space Development Bank's loans for the caller's corporation. Under /api/accounts/:accountId,
// so requireAuth and requireAccountAccess have run, and the input middleware has checked the body (ACCOUNT_INPUT).
// Every term is priced on the server (server/loans.js); the body's only inputs are the product and principal to quote,
// and the quote to accept.
import { quoteLoan, acceptLoan, loanOffers } from "../loans.js";
import { getAccountById } from "../gameState.js";
import { sanitizeAccount } from "../game/store.js";

const credits = (n) => `${Math.round(n).toLocaleString("en-US")} credits`;
const day = (t) => new Date(t).toUTCString().replace(/:\d\d GMT$/, " UTC").replace(/^\w+, /, "");

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

export function registerLoanRoutes(app) {
  // ISP-151 (AB#845): the products and this corporation's limit on each, for the Development Bank's view
  app.get("/api/accounts/:accountId/loans/offers", (req, res) => {
    const offers = loanOffers(req.params.accountId);
    if (!offers) return res.status(404).json({ error: "No such corporation." });
    res.json(offers);
  });

  app.post("/api/accounts/:accountId/loans/quote", (req, res) => {
    const r = quoteLoan(req.params.accountId, { productId: req.body?.productId, principal: Number(req.body?.principal) });
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
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json(answer(req.params.accountId, { loan: r.loan, paid: r.paid, receipt: payoffReceipt(r.loan, r.paid) }));
  });
}
