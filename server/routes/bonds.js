// ISP-154 (AB#848): bond series for the caller's corporation: the open series, issuing one, and subscribing. Under
// /api/accounts/:accountId, so requireAuth and requireAccountAccess have run, and the input middleware has checked the
// body (ACCOUNT_INPUT): every term is a number from the design's list. The grade, the face value, the window's end
// and the underwriter's share are the server's (server/bonds.js).
import { bondSeriesList, issueBond, publicSeries, subscribeBond } from "../bonds.js";
import { bodyNumber } from "../bodyNumber.js";

const num = (v) => bodyNumber(v, { fallback: NaN });

export function registerBondRoutes(app) {
  // every series still open for subscribing, and the caller's own series whatever their state
  app.get("/api/accounts/:accountId/bonds", (req, res) => {
    const now = Date.now();
    const all = bondSeriesList();
    res.json({
      open: all.filter((s) => s.state === "subscribing").map((s) => publicSeries(s, now)),
      issued: all.filter((s) => s.issuerAccountId === req.params.accountId).map((s) => publicSeries(s, now))
    });
  });

  app.post("/api/accounts/:accountId/bonds/issue", (req, res) => {
    const b = req.body ?? {};
    const r = issueBond(req.params.accountId, { quantity: num(b.quantity), couponPct30: num(b.couponPct30), maturityDays: num(b.maturityDays), windowHours: num(b.windowHours) });
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ series: publicSeries(r.series) });
  });

  app.post("/api/accounts/:accountId/bonds/:seriesId/subscribe", (req, res) => {
    const r = subscribeBond(req.params.accountId, { seriesId: req.params.seriesId, units: num(req.body?.units) });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ series: publicSeries(r.series), units: r.units, paid: r.paid });
  });
}
