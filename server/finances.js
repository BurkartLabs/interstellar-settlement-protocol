// server/finances.js
// Pure helpers for the corporate financial core: income/expense ledgers,
// liability projection, asset breakdown, and rolling balance snapshots.
// Intentionally side-effect-free apart from mutating the passed-in `corp`
// so it composes cleanly with the existing in-memory state model.

export const MAX_SNAPSHOTS = 60;
const FORWARD_OPERATING_DAYS = 7;
const INVENTORY_BASELINE_PRICE = 2;

/**
 * Ensure all finance-tracking fields exist on the corp without clobbering
 * any pre-existing values. Safe to call repeatedly.
 */
export function ensureFinanceTracking(corp) {
  if (!corp || typeof corp !== "object") return;
  if (!corp.finances || typeof corp.finances !== "object") {
    corp.finances = {};
  }
  if (!corp.finances.incomeBySource || typeof corp.finances.incomeBySource !== "object") {
    corp.finances.incomeBySource = {};
  }
  if (!corp.finances.expensesByCategory || typeof corp.finances.expensesByCategory !== "object") {
    corp.finances.expensesByCategory = {};
  }
  if (!Array.isArray(corp.finances.snapshots)) {
    corp.finances.snapshots = [];
  }
  if (typeof corp.finances.lifetimeRevenue !== "number") corp.finances.lifetimeRevenue = 0;
  if (typeof corp.finances.lifetimeCosts !== "number") corp.finances.lifetimeCosts = 0;
}

export function recordIncome(corp, source, amount) {
  if (!source || typeof source !== "string") return;
  ensureFinanceTracking(corp);
  const value = Math.round(Number(amount) || 0);
  if (value <= 0) return;
  const bucket = corp.finances.incomeBySource;
  bucket[source] = (bucket[source] || 0) + value;
  corp.finances.lifetimeRevenue = (corp.finances.lifetimeRevenue || 0) + value;
}

export function recordExpense(corp, category, amount) {
  if (!category || typeof category !== "string") return;
  ensureFinanceTracking(corp);
  const value = Math.round(Number(amount) || 0);
  if (value <= 0) return;
  const bucket = corp.finances.expensesByCategory;
  bucket[category] = (bucket[category] || 0) + value;
  corp.finances.lifetimeCosts = (corp.finances.lifetimeCosts || 0) + value;
}

/**
 * Outstanding obligations: forward operating burden + remaining lease
 * commitments on rented offices. Returns an integer credits value.
 */
export function computeLiveLiabilities(corp) {
  if (!corp) return 0;
  const dailyCosts = Math.max(0, Number(corp?.finances?.dailyCosts) || 0);
  let total = dailyCosts * FORWARD_OPERATING_DAYS;

  const offices = Array.isArray(corp.offices) ? corp.offices : [];
  for (const office of offices) {
    const dailyCost = Number(office?.leaseDailyCost);
    const days = Number(office?.daysRemaining);
    if (Number.isFinite(dailyCost) && Number.isFinite(days) && dailyCost > 0 && days > 0) {
      total += dailyCost * days;
    }
  }
  return Math.round(total);
}

/**
 * Best-effort decomposition of total assets into the major buckets the
 * Financial Core dashboard surfaces. `facilities` is taken from the
 * incrementally-tracked `finances.assets` value (extractor probes,
 * constructed buildings, etc.); `inventoryEstimate` valuates raw stock
 * at a flat baseline price until a live market lookup is wired in.
 *
 * TODO: Save a snapshot of financial data every x minutes to Supabase
 */
export function computeAssetBreakdown(corp) {
  const credits = Math.max(0, Math.round(Number(corp?.finances?.credits) || 0));
  const facilities = Math.max(0, Math.round(Number(corp?.finances?.assets) || 0));

  let units = 0;
  const inventory = corp?.inventory && typeof corp.inventory === "object" ? corp.inventory : {};
  for (const stationId of Object.keys(inventory)) {
    const stack = inventory[stationId];
    if (!stack || typeof stack !== "object") continue;
    for (const resourceId of Object.keys(stack)) {
      const qty = Number(stack[resourceId]);
      if (Number.isFinite(qty) && qty > 0) units += qty;
    }
  }
  const inventoryEstimate = Math.round(units * INVENTORY_BASELINE_PRICE);

  return {
    credits,
    facilities,
    inventoryEstimate,
    total: credits + facilities + inventoryEstimate
  };
}

export function buildSnapshot(corp, now = Date.now()) {
  const credits = Math.round(Number(corp?.finances?.credits) || 0);
  const assets = Math.round(Number(corp?.finances?.assets) || 0);
  const dailyRevenue = Math.round(Number(corp?.finances?.dailyRevenue) || 0);
  const dailyCosts = Math.round(Number(corp?.finances?.dailyCosts) || 0);
  const liabilities = computeLiveLiabilities(corp);
  return {
    t: now,
    credits,
    assets,
    liabilities,
    dailyRevenue,
    dailyCosts,
    netFlow: dailyRevenue - dailyCosts,
    netWorth: credits + assets - liabilities
  };
}

export function pushSnapshot(corp, snapshot, max = MAX_SNAPSHOTS) {
  ensureFinanceTracking(corp);
  corp.finances.snapshots.push(snapshot);
  const overflow = corp.finances.snapshots.length - max;
  if (overflow > 0) {
    corp.finances.snapshots.splice(0, overflow);
  }
}
