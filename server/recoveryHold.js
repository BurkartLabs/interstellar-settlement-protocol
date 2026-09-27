// ISP-286 (AB#993): while a defaulted debtor is in its grace period, it cannot move value to another corporation.
//
// docs/design/v0.9-debt.md, section 10: "a warning notification, then 24 hours before anything is force-sold. Paying in
// that time cancels the sale, and assets cannot be moved out of reach in the meantime." The ways value leaves one
// corporation for another are refused while the hold stands: market listings and buying another's listing, buy orders,
// posting a loan offer, and subscribing to a bond. Selling to the NPC exchange is not refused: the credits stay with
// the debtor, where recovery takes them first. No imports, so every module that moves value can ask it.

/** Why this corporation may not move value to another right now, or "" when it may. */
export function recoveryHold(corp) {
  const held = (corp?.recoveries || []).some((r) => r?.state === "grace"); // until the recovery runs or is cancelled
  if (!held) return "";
  return "A loan of yours is in default. Until the grace period ends, nothing can be sold, bought or lent to another corporation. Paying what is in arrears cancels the sale of your assets.";
}
