// ISP-154 (AB#848): the planner bot's bond issue, for the v0.9 probe (ISP-162, AB#856) to drive.
//
// A planner that needs capital chooses a coupon the way docs/design/v0.9-debt.md, section 8 argues a player should: the
// underwriter fills more as the coupon rises (server/bondTerms.js), each coupon point costs on everything raised, and
// capital is worth less the more of it there is (its marginal return halves every `halfLifeCredits`). It picks the
// coupon with the best net over the series' life, and does not issue at all when no coupon nets anything.
//
// P-PROXY: this is a bot's choice under the design's own arithmetic, not a player's. What it measures is whether the
// coupon knob has an interior optimum for a range of corporations (T-018), which is the design's claim.

import { BOND_TERMS, COUPON_STEPS, underwriterShare } from "../../server/bondTerms.js";

/** What `raised` credits earn over `days`: the marginal return r0 per credit per 30 days, halving every halfLife credits. */
export function capitalValue(raised, days, { returnPct30, halfLifeCredits }) {
  if (raised <= 0) return 0;
  const r0 = returnPct30 / 100;
  return r0 * (days / 30) * (halfLifeCredits / Math.LN2) * (1 - 0.5 ** (raised / halfLifeCredits));
}

/** The planner's net for one coupon: what the capital earns less the coupons, assuming only the underwriter buys. */
export function issueNet({ grade, quantity, maturityDays, capital }, couponPct30) {
  const raised = Math.floor(quantity * underwriterShare(couponPct30, grade)) * BOND_TERMS.faceValue;
  const coupons = (couponPct30 / 100) * (maturityDays / 30) * raised;
  return { raised, coupons, net: capitalValue(raised, maturityDays, capital) - coupons };
}

/** The coupon the planner issues at, or null when no coupon nets more than nothing (it then does not issue). */
export function plannerCoupon(issue) {
  let best = null;
  for (const c of COUPON_STEPS) {
    const { net } = issueNet(issue, c);
    if (net > 0 && (!best || net > best.net)) best = { couponPct30: c, net };
  }
  return best?.couponPct30 ?? null;
}
