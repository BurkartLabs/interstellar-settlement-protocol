// ISP-159 (AB#853): the planner issuer's payout ratio, for the v0.9 probe (ISP-162, AB#856) to drive.
//
// docs/design/v0.9-equity.md, section 6: an issuer about to open an offering picks the payout ratio that nets it most over
// the 60 days after the offering closes. A higher ratio raises the market maker's fill (server/shareOfferings.js
// marketMakerFill), so more capital; every point of it is paid to the outside holders on the income of those 60 days.
// Capital is worth less the more of it there is: the first tranche earns `firstPct`, the rest `restPct`, over 60 days.
// Ties go to the lower ratio ("the best ratio is the lowest one that fills the offering").
//
// P-PROXY: this is a bot choosing by the design's own arithmetic, not a player. What it measures is whether the ratio
// knob has an interior optimum for a spread of issuers (T-018).

import { SHARE_TERMS } from "../../server/shareRegistry.js";
import { marketMakerFill } from "../../server/shareOfferings.js";

const RATIOS = Array.from({ length: (SHARE_TERMS.payoutRatioPct.max - SHARE_TERMS.payoutRatioPct.min) / SHARE_TERMS.payoutRatioPct.step + 1 }, (_, i) => SHARE_TERMS.payoutRatioPct.min + i * SHARE_TERMS.payoutRatioPct.step);

/** What `raised` credits earn over the horizon: the first tranche at firstPct, the rest at restPct. */
export const capitalEarns = (raised, { tranche, firstPct, restPct }) => (Math.min(raised, tranche) * firstPct + Math.max(0, raised - tranche) * restPct) / 100;

/** The issuer's net for one ratio: { raised, dividends, earns, net }. */
export function ratioNet({ income30, value, outstanding, offerShares, grade, horizonDays = 60, capital }, ratioPct) {
  const fill = marketMakerFill({ payoutRatioPct: ratioPct, netIncome30: income30, value, grade });
  const units = Math.floor(offerShares * fill);
  const raised = units * Math.max(1, Math.floor(value / outstanding));
  const outsideShare = units / (outstanding + units);
  const dividends = (ratioPct / 100) * income30 * (horizonDays / 30) * outsideShare;
  const earns = capitalEarns(raised, capital);
  return { raised, dividends, earns, net: earns - dividends };
}

/** The ratio the planner sets: the best net, the lower ratio on a tie. */
export function plannerPayoutRatio(issuer) {
  let best = null;
  for (const r of RATIOS) {
    const { net } = ratioNet(issuer, r);
    if (!best || net > best.net + 1e-9) best = { r, net };
  }
  return best.r;
}
