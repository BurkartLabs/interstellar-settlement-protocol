// ISP-154 (AB#848): bond series for the caller's corporation: the open series, issuing one, and subscribing. Under
// /api/accounts/:accountId, so requireAuth and requireAccountAccess have run, and the input middleware has checked the
// body (ACCOUNT_INPUT): every term is a number from the design's list. The grade, the face value, the window's end
// and the underwriter's share are the server's (server/bonds.js).
// ISP-156 (AB#850): what the bond board reads: whether the caller may issue and why not, a preview of a series before
// it is issued, the caller's holdings with each one's next coupon, and the ISP-19 receipt after each commitment.
import { BOND_TERMS, bondEligibility, bondSeriesList, issueBond, previewBond, publicSeries, subscribeBond } from "../bonds.js";
import { bondHoldingsValue, nextPayment } from "../bondServicing.js";
import { bodyNumber } from "../bodyNumber.js";
import { getAccountById } from "../gameState.js";
import { sanitizeAccount } from "../game/store.js";

const num = (v) => bodyNumber(v, { fallback: NaN });
const credits = (n) => `${Math.round(n).toLocaleString("en-US")} credits`;
const day = (t) => new Date(t).toUTCString().replace(/:\d\d GMT$/, " UTC").replace(/^\w+, /, "");
const answer = (accountId, extra) => ({ ...sanitizeAccount(getAccountById(accountId)), ...extra });

/** ISP-19: what the confirmation after issuing says. */
function issueReceipt(s) {
  return {
    title: `Bond series of ${s.quantity.toLocaleString("en-US")} units issued`,
    summary: `The Deep Space Development Bank has listed your series: ${credits(s.quantity * s.faceValue)} of face at ${s.couponPct30}% per 30 days for ${s.maturityDays} days, graded ${s.grade}.`,
    cost: "Nothing now: you are paid as corporations subscribe",
    grants: [
      { label: "Open for subscribing until", value: day(s.closesAt) },
      { label: "Grade-implied yield", value: `${s.impliedYieldPct30}% per 30 days` }
    ],
    next: "When the window closes, the Bank's underwriter takes a share of what is unsold, and the rest lapses. Coupons are due every 7 days from then; keep them on hand."
  };
}

/** ISP-19: what the confirmation after subscribing says. */
function subscribeReceipt(s, units, paid) {
  return {
    title: `${units.toLocaleString("en-US")} bond unit${units === 1 ? "" : "s"} bought`,
    summary: `You hold ${units.toLocaleString("en-US")} unit${units === 1 ? "" : "s"} of ${s.issuerName ?? "the issuer"}'s ${s.maturityDays}-day series at ${s.couponPct30}% per 30 days.`,
    cost: credits(paid),
    grants: [
      { label: "Coupons", value: `every 7 days from when the window closes (${day(s.closesAt)} at the latest)` },
      { label: "Face back", value: `${credits(paid)} at maturity, ${s.maturityDays} days after the window closes` }
    ],
    next: `A coupon ${s.issuerName ?? "the issuer"} cannot pay goes into arrears, owed to you with penalty interest.`
  };
}

export function registerBondRoutes(app) {
  // every series still open for subscribing; the caller's own series and holdings; whether it may issue; the terms
  app.get("/api/accounts/:accountId/bonds", (req, res) => {
    const now = Date.now();
    const id = req.params.accountId;
    const all = bondSeriesList();
    const corp = getAccountById(id)?.state?.corp;
    const values = bondHoldingsValue(corp);
    res.json({
      now,
      open: all.filter((s) => s.state === "subscribing" && now < s.closesAt).map((s) => publicSeries(s, now)),
      issued: all.filter((s) => s.issuerAccountId === id).map((s) => ({ ...publicSeries(s, now), next: nextPayment(s) })),
      holdings: (corp?.bondHoldings || []).map((h) => {
        const s = all.find((x) => x.id === h.seriesId);
        return s ? { units: h.units, series: publicSeries(s, now), next: nextPayment(s, id), value: values.holdings.find((v) => v.seriesId === h.seriesId)?.value ?? 0 } : null;
      }).filter(Boolean),
      eligibility: bondEligibility(id, now),
      terms: {
        faceValue: BOND_TERMS.faceValue, minQuantity: BOND_TERMS.minQuantity, maxQuantity: BOND_TERMS.maxQuantity,
        minCouponPct30: BOND_TERMS.minCouponPct30, maxCouponPct30: BOND_TERMS.maxCouponPct30, couponStepPct30: BOND_TERMS.couponStepPct30,
        maturityDays: BOND_TERMS.maturityDays, windowHours: BOND_TERMS.windowHours, impliedYieldPct30: BOND_TERMS.impliedYieldPct30
      }
    });
  });

  // ISP-156 (AB#850): the issue form's preview; changes nothing
  app.post("/api/accounts/:accountId/bonds/preview", (req, res) => {
    const b = req.body ?? {};
    const r = previewBond(req.params.accountId, { quantity: num(b.quantity), couponPct30: num(b.couponPct30), maturityDays: num(b.maturityDays) });
    if (!r.ok) return res.status(409).json({ error: r.error, ...(r.grade ? { grade: r.grade } : {}) });
    res.json({ preview: r.preview });
  });

  app.post("/api/accounts/:accountId/bonds/issue", (req, res) => {
    const b = req.body ?? {};
    const r = issueBond(req.params.accountId, { quantity: num(b.quantity), couponPct30: num(b.couponPct30), maturityDays: num(b.maturityDays), windowHours: num(b.windowHours) });
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json(answer(req.params.accountId, { series: publicSeries(r.series), receipt: issueReceipt(r.series) }));
  });

  app.post("/api/accounts/:accountId/bonds/:seriesId/subscribe", (req, res) => {
    const r = subscribeBond(req.params.accountId, { seriesId: req.params.seriesId, units: num(req.body?.units) });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json(answer(req.params.accountId, { series: publicSeries(r.series), units: r.units, paid: r.paid, receipt: subscribeReceipt(r.series, r.units, r.paid) }));
  });
}
