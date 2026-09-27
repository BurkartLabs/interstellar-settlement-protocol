// public/scripts/dumping.js: the Interplanetary Trade Commission's dumping rule (ISP-232, AB#927; docs/design/WARFARE.md,
// "Dumping, and the Trade Commission's watch"). Pure: no files and no clock, so the boundary tests read it with fixtures.
// ISP-233 (AB#928): shared by the server's watch (server/itcService.js) and the listing warning on the Exchange, so a
// trader is warned by the same rule that would find it.
//
// For one corporation and one item, over the window W (the last windowDays complete UTC days) against the normal value
// N (the volume-weighted price of every trade in the item over the normalValueDays before W) and the normal daily volume
// V: the units it sold below priceThresholdPct of N, not already in a finding, are Q_d at an average P_d. It is found
// dumping when Q_d is at least volumeThresholdPct of the market's normal volume for a window as long (V x windowDays)
// and Q_d x N is at least minValue; the duty is dutyMarginPct of the margin, (N - P_d) x Q_d, never more (WTO Art. 9.3).

const DAY_MS = 86_400_000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

/** The days the watch reads at `now`: the window W and the normal-value days before it, as YYYY-MM-DD, oldest first. */
export function watchDays(now, terms) {
  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  const days = (from, n) => Array.from({ length: n }, (_, i) => dayKey(from + i * DAY_MS));
  const windowStart = today - terms.windowDays * DAY_MS;
  return {
    window: days(windowStart, terms.windowDays),
    normal: days(windowStart - terms.normalValueDays * DAY_MS, terms.normalValueDays),
    windowStartAt: windowStart,
    windowEndAt: today
  };
}

/**
 * The normal value and normal daily volume of an item from its daily price buckets over `days`: { price, dailyVolume }
 * or null when fewer than minTradedDays of them traded (fails closed: no normal value, no finding). A bucket's traded
 * value is `value` where the history recorded it, else its close x volume.
 */
export function normalOf(buckets, days, terms) {
  const traded = (buckets || []).filter((b) => days.includes(b.day) && b.volume > 0);
  if (traded.length < terms.minTradedDays) return null;
  const volume = traded.reduce((s, b) => s + b.volume, 0);
  const value = traded.reduce((s, b) => s + (Number.isFinite(b.value) ? b.value : b.close * b.volume), 0);
  return { price: value / volume, dailyVolume: volume / days.length };
}

/**
 * Whether `sales` (one corporation's own-priced sales of one item in the window, not yet in a finding:
 * [{ id, quantity, unitPrice }]) are dumping against `normal`. Returns { found, line, volumeLine, dumped, Q, P, N, duty }
 * where `dumped` is the ids of the sales below the line; found is false when any test fails.
 */
export function assess(sales, normal, terms) {
  if (!normal) return { found: false, reason: "no normal value" };
  const N = normal.price;
  const line = (N * terms.priceThresholdPct) / 100;
  const below = (sales || []).filter((s) => s.unitPrice < line && s.quantity > 0);
  const Q = below.reduce((s, x) => s + x.quantity, 0);
  const P = Q ? below.reduce((s, x) => s + x.unitPrice * x.quantity, 0) / Q : 0;
  const volumeLine = (terms.volumeThresholdPct / 100) * normal.dailyVolume * terms.windowDays;
  const found = Q > 0 && Q >= volumeLine && Q * N >= terms.minValue;
  const duty = found ? Math.round(((terms.dutyMarginPct / 100) * (N - P) * Q)) : 0;
  return { found, N, line, volumeLine, Q, P, duty, dumped: below.map((s) => s.id) };
}

/**
 * ISP-233 (AB#928): what a new listing would mean to the watch, from the seller's own view of it (GET
 * /api/accounts/:id/itc/:item): null when the item has no normal value or the price is at or above the line; else
 * { line, N, volumeLine, already, Q, found, duty }: `already` is the units it has sold below the line in the window the
 * next watch reads, `Q` with this listing, and `found`/`duty` what the watch would decide if all of it sells.
 */
export function listingWarning(watch, quantity, unitPrice) {
  if (!watch?.normal || !(unitPrice < watch.line)) return null;
  const normal = { price: watch.normal.price, dailyVolume: watch.normal.dailyVolume };
  const already = assess(watch.sales || [], normal, watch.terms).Q;
  const r = assess([...(watch.sales || []), { id: "listing", quantity, unitPrice }], normal, watch.terms);
  return { line: r.line, N: r.N, volumeLine: r.volumeLine, already, Q: r.Q, found: r.found, duty: r.duty };
}
