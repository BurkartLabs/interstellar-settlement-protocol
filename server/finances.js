// server/finances.js
// Pure helpers for the corporate financial core: income/expense ledgers,
// liability projection, asset breakdown, and rolling balance snapshots.
// Intentionally side-effect-free apart from mutating the passed-in `corp`
// so it composes cleanly with the existing in-memory state model.

export const MAX_SNAPSHOTS = 60;
const FORWARD_OPERATING_DAYS = 7;

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

/** How far back dailyRevenue looks: it is the income booked in the last 24 hours (Bug #984). */
export const REVENUE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Book income where the cash arrives, at the amount actually received. This is the only thing that moves
 * incomeBySource, lifetimeRevenue and dailyRevenue, so the three cannot describe different economies (Bug #984: mining
 * booked 2.4 a unit on production and sales booked proceeds / 24, and dailyRevenue only ever grew).
 */
export function recordIncome(corp, source, amount, now = Date.now()) {
  if (!source || typeof source !== "string") return;
  ensureFinanceTracking(corp);
  const value = Math.round(Number(amount) || 0);
  if (value <= 0) return;
  const bucket = corp.finances.incomeBySource;
  bucket[source] = (bucket[source] || 0) + value;
  corp.finances.lifetimeRevenue = (corp.finances.lifetimeRevenue || 0) + value;
  if (!Array.isArray(corp.finances.revenueLog)) corp.finances.revenueLog = [];
  corp.finances.revenueLog.push({ t: now, amount: value });
  refreshDailyRevenue(corp, now);
}

/**
 * dailyRevenue is the income booked in the last 24 hours. Drops older entries from the log, so the figure falls when
 * nothing is sold. A save from before Bug #984 has no log, and its ever-growing total becomes 0.
 */
export function refreshDailyRevenue(corp, now = Date.now()) {
  ensureFinanceTracking(corp);
  const since = now - REVENUE_WINDOW_MS;
  const log = (Array.isArray(corp.finances.revenueLog) ? corp.finances.revenueLog : []).filter((e) => Number(e?.t) > since);
  corp.finances.revenueLog = log;
  corp.finances.dailyRevenue = log.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

/**
 * Book a cost where the cash leaves. Mirrors recordIncome: it moves expensesByCategory, lifetimeCosts and dailyExpenses
 * together (Bug #1022: mining costs and exchange tax were booked but never reached the cost side of Net Daily Flow).
 */
export function recordExpense(corp, category, amount, now = Date.now()) {
  if (!category || typeof category !== "string") return;
  ensureFinanceTracking(corp);
  const value = Math.round(Number(amount) || 0);
  if (value <= 0) return;
  const bucket = corp.finances.expensesByCategory;
  bucket[category] = (bucket[category] || 0) + value;
  corp.finances.lifetimeCosts = (corp.finances.lifetimeCosts || 0) + value;
  if (!Array.isArray(corp.finances.expenseLog)) corp.finances.expenseLog = [];
  corp.finances.expenseLog.push({ t: now, amount: value });
  refreshDailyExpenses(corp, now);
}

/**
 * Every category a credit movement can be booked under (AB#712). Income is money in, expenses money out; the P&L and
 * the daily statements (AB#713) read these names, so a new way to earn or spend adds its name here first.
 */
export const CREDIT_CATEGORIES = Object.freeze({
  income: Object.freeze(["exchange", "missions"]),
  expense: Object.freeze([
    "hiring",
    "office-rent",
    "leases",
    "transfer-fees",
    "construction",
    "mining-startup",
    "mining-ops",
    "expeditions",
    "research",
    "ceo-insight",
    "exchange-purchases",
    "exchange-tax"
  ])
});

/** Where a movement goes when its category is not in the list, outside tests. */
export const UNCATEGORISED = "uncategorised";

/**
 * The one way credits change (AB#712). Moves finances.credits by `delta` and books the same amount: a positive delta
 * as income under `category`, a negative one as an expense. So opening credits + income - expenses = closing credits,
 * exactly, and a statement built from the ledger is the balance the player sees.
 *
 * The amount is always one the server computed. A delta that is not a finite number throws before anything changes
 * (fails closed). It is rounded to whole credits, the unit the ledger books in. A category not in CREDIT_CATEGORIES
 * throws under test, so a new call site cannot ship unnamed, and is booked as "uncategorised" in production rather than
 * refusing a player's action. Returns the rounded delta applied.
 */
export function applyCredits(corp, delta, category, now = Date.now()) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) {
    throw new TypeError(`applyCredits: delta must be a finite number, got ${String(delta)}`);
  }
  if (!corp || typeof corp !== "object") throw new TypeError("applyCredits: no corporation");
  const amount = Math.round(delta);
  // Zero moves nothing and books nothing, so either side's name is fine (a sale at 0% tax books "exchange-tax" 0).
  const sides = amount > 0 ? ["income"] : amount < 0 ? ["expense"] : ["income", "expense"];
  let name = category;
  if (!sides.some((side) => CREDIT_CATEGORIES[side].includes(name))) {
    if (process.env.NODE_ENV === "test") throw new Error(`applyCredits: "${String(category)}" is not a ${sides.join(" or ")} category`);
    name = UNCATEGORISED;
  }
  ensureFinanceTracking(corp);
  corp.finances.credits = Math.round(Number(corp.finances.credits) || 0) + amount;
  if (amount > 0) recordIncome(corp, name, amount, now);
  else if (amount < 0) recordExpense(corp, name, -amount, now);
  return amount;
}

/** dailyExpenses is the cost booked in the last 24 hours, the cost side of Net Daily Flow (Bug #1022). */
export function refreshDailyExpenses(corp, now = Date.now()) {
  ensureFinanceTracking(corp);
  const since = now - REVENUE_WINDOW_MS;
  const log = (Array.isArray(corp.finances.expenseLog) ? corp.finances.expenseLog : []).filter((e) => Number(e?.t) > since);
  corp.finances.expenseLog = log;
  corp.finances.dailyExpenses = log.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

/**
 * What the corporation's stock would fetch now: each unit at the standing NPC bid for its item, 0 where nothing bids
 * (Bug #1022: every unit was valued at a flat 2 credits, a twelfth of the Silicates bid).
 */
export function valueInventory(corp, market) {
  const bids = {};
  for (const order of market?.npcBuyOrders || []) {
    const price = Number(order?.unitPrice) || 0;
    if (order?.item) bids[order.item] = Math.max(bids[order.item] || 0, price);
  }
  let value = 0;
  const inventory = corp?.inventory && typeof corp.inventory === "object" ? corp.inventory : {};
  for (const stack of Object.values(inventory)) {
    if (!stack || typeof stack !== "object") continue;
    for (const [item, qty] of Object.entries(stack)) {
      const units = Number(qty);
      if (Number.isFinite(units) && units > 0) value += units * (bids[item] || 0);
    }
  }
  return Math.round(value);
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
 * constructed buildings, etc.); `inventoryEstimate` values stock at the
 * standing NPC bids in `market` (valueInventory).
 *
 * TODO(AB#713): Save a snapshot of financial data every x minutes to storage
 */
export function computeAssetBreakdown(corp, market) {
  const credits = Math.max(0, Math.round(Number(corp?.finances?.credits) || 0));
  const facilities = Math.max(0, Math.round(Number(corp?.finances?.assets) || 0));
  const inventoryEstimate = valueInventory(corp, market);

  return {
    credits,
    facilities,
    inventoryEstimate,
    total: credits + facilities + inventoryEstimate
  };
}

export function buildSnapshot(corp, now = Date.now(), market = null) {
  const credits = Math.round(Number(corp?.finances?.credits) || 0);
  const assets = Math.round(Number(corp?.finances?.assets) || 0);
  const dailyRevenue = Math.round(Number(corp?.finances?.dailyRevenue) || 0);
  const dailyCosts = Math.round(Number(corp?.finances?.dailyCosts) || 0);
  const dailyExpenses = Math.round(Number(corp?.finances?.dailyExpenses) || 0);
  const liabilities = computeLiveLiabilities(corp);
  // Bug #1022: stock counts toward net worth at what it would fetch; the client reads it from finances.
  const inventory = market ? valueInventory(corp, market) : Math.round(Number(corp?.finances?.inventoryValue) || 0);
  if (corp?.finances) corp.finances.inventoryValue = inventory;
  return {
    t: now,
    credits,
    assets,
    liabilities,
    dailyRevenue,
    dailyCosts,
    dailyExpenses,
    inventory,
    netFlow: dailyRevenue - dailyExpenses,
    netWorth: credits + assets + inventory - liabilities
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
