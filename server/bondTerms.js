// ISP-154 (AB#848): a bond series' terms and the NPC underwriter's formula (docs/design/v0.9-debt.md, sections 1 and 7).
// Pure: the input table (server/gameplayInput.js) and the probes read it without loading the game's store.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "bond-terms.json");
/** What a series may be, who may issue one, and the implied yields, as data. */
export const BOND_TERMS = Object.freeze(JSON.parse(fs.readFileSync(FILE, "utf8")));

/** Every coupon an issuer may choose: 1.00 to 15.00 in steps of 0.25. */
export const COUPON_STEPS = Object.freeze(Array.from(
  { length: Math.round((BOND_TERMS.maxCouponPct30 - BOND_TERMS.minCouponPct30) / BOND_TERMS.couponStepPct30) + 1 },
  (_, i) => BOND_TERMS.minCouponPct30 + i * BOND_TERMS.couponStepPct30
));

/**
 * The share of the unsold units the NPC underwriter takes when the window closes (section 7):
 * clip((coupon - (impliedYield - 2)) / 4, 0, 1). None at 2 points under the grade's yield, half at it, all at 2 over.
 */
export function underwriterShare(couponPct30, grade) {
  const y = BOND_TERMS.impliedYieldPct30[grade];
  if (typeof y !== "number") return 0;
  const { pointsBelow, pointsSpan } = BOND_TERMS.underwriter;
  return Math.min(1, Math.max(0, (couponPct30 - (y - pointsBelow)) / pointsSpan));
}
