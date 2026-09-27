// ISP-149 (AB#843): the Deep Space Development Bank's loans for the caller's corporation. Under /api/accounts/:accountId,
// so requireAuth and requireAccountAccess have run, and the input middleware has checked the body (ACCOUNT_INPUT).
// Every term is priced on the server (server/loans.js); the body's only inputs are the product and principal to quote,
// and the quote to accept.
import { quoteLoan, acceptLoan } from "../loans.js";
import { payOffLoan } from "../loanServicing.js"; // ISP-150 (AB#844)

export function registerLoanRoutes(app) {
  app.post("/api/accounts/:accountId/loans/quote", (req, res) => {
    const r = quoteLoan(req.params.accountId, { productId: req.body?.productId, principal: Number(req.body?.principal) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ quote: r.quote });
  });

  app.post("/api/accounts/:accountId/loans/accept", (req, res) => {
    const r = acceptLoan(req.params.accountId, { quoteId: req.body?.quoteId });
    if (!r.ok) return res.status(409).json({ error: r.error, ...(r.terms ? { terms: r.terms } : {}) });
    res.json({ loan: r.loan });
  });

  // ISP-150 (AB#844): repay a loan early: the principal still owed, the arrears and a 1% fee, all at once.
  app.post("/api/accounts/:accountId/loans/:loanId/payoff", (req, res) => {
    const r = payOffLoan(req.params.accountId, req.params.loanId, Date.now());
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ loan: r.loan, paid: r.paid });
  });
}
