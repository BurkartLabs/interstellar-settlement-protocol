// public/scripts/exchangeTax.js: the Exchange's sales tax, in one place for the server and the page (ISP-302, AB#2285).
// The rate is the base tax, plus the ISA lease royalty for the leases a corporation holds, less the Negotiation
// Fundamentals discount, and never below 0. The server books the royalty's share of a sale under its own ledger
// category, and the Exchange shows it as its own line, so both split a sale with taxOnSale below.

/** The royalty points for this many leases held: the entry for the largest count at or below it, else 0. */
export function royaltyPointsFor(leasesHeld, pointsByLeasesHeld = {}) {
  let points = 0;
  let best = -1;
  for (const [count, value] of Object.entries(pointsByLeasesHeld)) {
    const n = Number(count);
    if (Number.isFinite(n) && n <= leasesHeld && n > best) {
      best = n;
      points = Number(value) || 0;
    }
  }
  return points;
}

/**
 * The rate and its parts. The discount comes off the base tax first and off the royalty only once the base is used up,
 * so salesTaxPct + royaltyPct is always ratePct: what each line of a sale's breakdown charges.
 */
export function taxBreakdown({ basePct, discountPoints = 0, leasesHeld = 0, royaltyPointsByLeasesHeld = {} }) {
  const royaltyPoints = royaltyPointsFor(leasesHeld, royaltyPointsByLeasesHeld);
  const ratePct = Math.max(0, basePct + royaltyPoints - discountPoints);
  const royaltyPct = Math.min(royaltyPoints, ratePct);
  return { basePct, discountPoints, leasesHeld, royaltyPoints, ratePct, royaltyPct, salesTaxPct: ratePct - royaltyPct };
}

/** A sale of `gross` credits: the whole tax, the royalty's share of it, the rest, and what the seller receives. */
/**
 * ISP-239 (AB#934): the same breakdown on another base rate (a system whose sales tax is lobbied): the royalty points
 * and discount carry over, and the lines are drawn again as taxBreakdown draws them.
 */
export function withBasePct(breakdown, basePct) {
  if (!Number.isFinite(basePct) || basePct === breakdown?.basePct) return breakdown;
  const royaltyPoints = Number(breakdown?.royaltyPoints) || 0;
  const ratePct = Math.max(0, basePct + royaltyPoints - (Number(breakdown?.discountPoints) || 0));
  const royaltyPct = Math.min(royaltyPoints, ratePct);
  return { ...breakdown, basePct, ratePct, royaltyPct, salesTaxPct: ratePct - royaltyPct };
}

/**
 * ISP-212b (AB#4655): the breakdown at a conglomerate's own station, from its station tax (server/game/stationTax.js
 * stationTaxAt: { pct, member, votedPct, conglomerateName, stationName }). The station's rate replaces the ISA's tax
 * whole: no lease royalty, no discount; `station` says whose it is, for the quote's line and the treasury.
 */
export function stationTaxBreakdown(stationTax) {
  const pct = Math.max(0, Number(stationTax?.pct) || 0);
  return { basePct: pct, discountPoints: 0, leasesHeld: 0, royaltyPoints: 0, ratePct: pct, royaltyPct: 0, salesTaxPct: pct, station: { ...stationTax, pct } };
}

export function taxOnSale(gross, breakdown) {
  const tax = Math.round(gross * breakdown.ratePct / 100);
  const royalty = Math.min(tax, Math.round(gross * breakdown.royaltyPct / 100));
  return { tax, royalty, salesTax: tax - royalty, proceeds: gross - tax };
}
