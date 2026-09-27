// ISP-158 (AB#852): listing on the Stock Exchange and primary share offerings, for the caller's corporation. Under
// /api/accounts/:accountId, so requireAuth and requireAccountAccess have run, and the input middleware has checked the
// body (ACCOUNT_INPUT): the only numbers a request carries are a quantity of shares. Every price is the server's
// (server/shareOfferings.js); a price in a request is never read.
import { bodyNumber } from "../bodyNumber.js";
import { buyShares, listCorporation, listingProblem, openOffering, publicOffering, shareOfferingList } from "../shareOfferings.js";
import { getAccountById } from "../gameState.js";
import { sanitizeAccount } from "../game/store.js";

const num = (v) => bodyNumber(v, { fallback: NaN });
const answer = (accountId, extra) => ({ ...sanitizeAccount(getAccountById(accountId)), ...extra });

export function registerEquityRoutes(app) {
  // the offerings open now, the caller's own, and whether it may list (and why not)
  app.get("/api/accounts/:accountId/equity/offerings", (req, res) => {
    const now = Date.now();
    const all = shareOfferingList();
    res.json({
      open: all.filter((o) => o.state === "open" && now < o.closesAt).map((o) => publicOffering(o, now)),
      mine: all.filter((o) => o.issuerAccountId === req.params.accountId).map((o) => publicOffering(o, now)),
      listing: { why: listingProblem(req.params.accountId, now) }
    });
  });

  app.post("/api/accounts/:accountId/equity/list", (req, res) => {
    const r = listCorporation(req.params.accountId);
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json(answer(req.params.accountId, { fee: r.fee }));
  });

  app.post("/api/accounts/:accountId/equity/offerings", (req, res) => {
    const r = openOffering(req.params.accountId, { quantity: num(req.body?.quantity) });
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ offering: publicOffering(r.offering) });
  });

  app.post("/api/accounts/:accountId/equity/offerings/:offeringId/buy", (req, res) => {
    const r = buyShares(req.params.accountId, { offeringId: req.params.offeringId, quantity: num(req.body?.quantity) });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json(answer(req.params.accountId, { offering: publicOffering(r.offering), shares: r.shares, paid: r.paid }));
  });
}
