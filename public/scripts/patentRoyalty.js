// public/scripts/patentRoyalty.js: a patent royalty's arithmetic (ISP-237, AB#932; docs/design/WARFARE.md, "Patents"),
// shared by the quote a corporation sees before it starts a run of a patented chain and the settlement ISP-236 (AB#931)
// charges when the run delivers, so the confirmation's number is the settlement's number (P-TWO-SOURCES). Pure.
//
// The royalty on a chain is the holder's rate x the run's outputs at their standing bids' base price; on a research node,
// the rate x the node's costCredits. Whole credits, rounded as the exchange tax and the tariff are.

/** The statements' source for royalties, on both sides: the holder's income and the user's expense. */
export const ROYALTY_CATEGORY = "patent-royalty";

/** The royalty on `value` credits at `pct`, in whole credits. */
export function royaltyOn(value, pct) {
  return pct > 0 && value > 0 ? Math.round((value * pct) / 100) : 0;
}

/**
 * A chain run's royalty at `ratePct`: { value, royalty }, where `value` is its outputs ([{ item, quantity }]) at
 * `basePrices` (item -> the standing bid's base), in whole credits. An item without a bid adds nothing.
 */
export function chainRunRoyalty(outputs, ratePct, basePrices = {}) {
  const value = Math.floor((outputs || []).reduce((s, o) => s + (Number(o.quantity) || 0) * (Number(basePrices[o.item]) || 0), 0));
  return { value, royalty: royaltyOn(value, ratePct) };
}

/** A research node's royalty at `ratePct`: of its costCredits. */
export function researchRoyalty(costCredits, ratePct) {
  return royaltyOn(Math.floor(Number(costCredits) || 0), ratePct);
}

/** The standing bids' base prices, item -> credits, from the market's NPC buy orders. */
export function basePricesOf(npcBuyOrders) {
  const out = {};
  for (const o of npcBuyOrders || []) if (o?.item && Number(o.basePrice) > 0) out[o.item] = Number(o.basePrice);
  return out;
}

/**
 * The patent in force on a subject in the public register (GET /api/patents) at `now` that `corpName` would pay on:
 * one held by another corporation. Null when there is none, or it is the caller's own.
 */
export function patentToPay(register, kind, subjectId, corpName, now = Date.now()) {
  const p = (register || []).find((x) => x.kind === kind && x.subjectId === subjectId && x.filedAt <= now && now < x.endsAt);
  return p && p.holder !== corpName ? p : null;
}
