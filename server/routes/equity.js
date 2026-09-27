// ISP-158 (AB#852): listing on the Stock Exchange and primary share offerings, for the caller's corporation. Under
// /api/accounts/:accountId, so requireAuth and requireAccountAccess have run, and the input middleware has checked the
// body (ACCOUNT_INPUT): the only numbers a request carries are a quantity of shares. Every price is the server's
// (server/shareOfferings.js); a price in a request is never read.
import { bodyNumber } from "../bodyNumber.js";
import { buyShares, exitShares, holdingsOfAccount, issuerStanding, listCorporation, listedOffering, listingProblem, openOffering, publicOffering, shareOfferingList } from "../shareOfferings.js";
import { setPayoutRatio } from "../dividends.js"; // ISP-159 (AB#853)
import { getAccountById } from "../gameState.js";
import { sanitizeAccount } from "../game/store.js";

const num = (v) => bodyNumber(v, { fallback: NaN });
const answer = (accountId, extra) => ({ ...sanitizeAccount(getAccountById(accountId)), ...extra });
const n = (v) => Number(v).toLocaleString("en-US");
const shares = (q) => `${n(q)} share${q === 1 ? "" : "s"}`;

// ISP-161 (AB#855): the ISP-19 receipt after each commitment on the Exchange
function buyReceipt(o, quantity, paid) {
  return {
    title: `${shares(quantity)} of ${o.issuerName ?? "the issuer"} bought`,
    summary: `You bought ${shares(quantity)} in ${o.issuerName ?? "the issuer"}'s offering at ${n(o.pricePerShare)} credits each.`,
    cost: `${n(paid)} credits`,
    grants: [
      { label: "Dividends", value: "a share of its weekly payout, by shares held" },
      { label: "Value", value: "company value / shares outstanding, from its latest closed statement" }
    ],
    next: "Sell to the market maker from your portfolio at the value less 5%, or hold for dividends."
  };
}
function exitReceipt(r, quantity) {
  return {
    title: `${shares(quantity)} of ${r.issuerName ?? "the issuer"} sold`,
    summary: `The IGSX market maker bought ${shares(quantity)} at ${n(r.pricePerShare)} credits each (value ${n(r.valuePerShare)}, less 5%).`,
    cost: "nothing",
    grants: [{ label: "Received", value: `${n(r.paid)} credits` }],
    next: "The dividends those shares already paid stay yours."
  };
}

export function registerEquityRoutes(app) {
  // the offerings open now (AB#855: with the issuer's grade, trailing net income and payout ratio), the caller's own,
  // whether it may list (and why not), and its standing as an issuer
  app.get("/api/accounts/:accountId/equity/offerings", (req, res) => {
    const now = Date.now();
    const all = shareOfferingList();
    res.json({
      open: all.filter((o) => o.state === "open" && now < o.closesAt).map((o) => listedOffering(o, now)),
      mine: all.filter((o) => o.issuerAccountId === req.params.accountId).map((o) => publicOffering(o, now)),
      listing: { why: listingProblem(req.params.accountId, now) },
      issuer: issuerStanding(req.params.accountId, now),
      now
    });
  });

  app.post("/api/accounts/:accountId/equity/list", (req, res) => {
    const r = listCorporation(req.params.accountId);
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json(answer(req.params.accountId, { fee: r.fee, receipt: { title: "Listed on the Exchange", summary: "Your corporation is listed on the Intergalactic Stock Exchange.", cost: `${n(r.fee)} credits`, grants: [{ label: "Offerings", value: "new shares for 7 days at a time, once in 30 days" }], next: "Open an offering from Your shares." } }));
  });

  app.post("/api/accounts/:accountId/equity/offerings", (req, res) => {
    const r = openOffering(req.params.accountId, { quantity: num(req.body?.quantity) });
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ offering: publicOffering(r.offering) });
  });

  // ISP-159 (AB#853): the payout ratio for the next dividend period (the one in progress keeps its own)
  app.post("/api/accounts/:accountId/equity/payout-ratio", (req, res) => {
    const r = setPayoutRatio(req.params.accountId, num(req.body?.payoutRatioPct));
    if (!r.ok) return res.status(409).json({ error: r.error });
    const { payoutRatioPct, payoutRatioNextPct, payoutRatioChangedAt } = r.registry;
    res.json({ payoutRatioPct, payoutRatioNextPct, payoutRatioChangedAt });
  });

  app.post("/api/accounts/:accountId/equity/offerings/:offeringId/buy", (req, res) => {
    const r = buyShares(req.params.accountId, { offeringId: req.params.offeringId, quantity: num(req.body?.quantity) });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json(answer(req.params.accountId, { offering: publicOffering(r.offering), shares: r.shares, paid: r.paid, receipt: buyReceipt(r.offering, r.shares, r.paid) }));
  });

  // ISP-160 (AB#854): the caller's holdings, each at the Board's value per share (company value / shares outstanding)
  app.get("/api/accounts/:accountId/equity/holdings", (req, res) => {
    res.json({ holdings: holdingsOfAccount(req.params.accountId) });
  });

  // ISP-160 (AB#854): sell shares back to the market maker at floor(value x 0.95). Only the issuer and the quantity are
  // read; a price in the request is ignored.
  app.post("/api/accounts/:accountId/equity/holdings/:issuerCorpId/exit", (req, res) => {
    const r = exitShares(req.params.accountId, { issuerCorpId: req.params.issuerCorpId, quantity: num(req.body?.quantity) });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json(answer(req.params.accountId, { shares: r.shares, valuePerShare: r.valuePerShare, pricePerShare: r.pricePerShare, paid: r.paid, receipt: exitReceipt(r, r.shares) }));
  });
}
