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
  // AB#1054: "exchange-escrow" is credits held for a player's buy order, "exchange-escrow-return" their return when it
  // fills or is cancelled; over an order's life the two are equal, and what it bought is "exchange-purchases".
  // ISP-146 (AB#840): what server/settlement.js moves between parties, booked `<reason>-received` by the payee and
  // `<reason>-paid` by the payer (its REASONS; a fee and an escrow hold only leave, an escrow release only arrives).
  income: Object.freeze(["exchange", "missions", "salvage", "exchange-escrow-return",
    "loan-disbursal-received", "loan-repayment-received", "bond-subscription-received", "coupon-received", "dividend-received",
    "share-purchase-received", "escrow-release-received", "loan-interest-received",
    "bond-redemption-received", // ISP-155 (AB#849): a bond's face back at maturity
    "bond-sale-received", // Bug #2574: bonds sold in default recovery
    "ship-production-refund", // ISP-171 (AB#865): what cancelling a shipyard job returns
    "troop-training-refund", // ISP-172 (AB#866): what cancelling a training job returns
    "conglomerate-dissolution", // ISP-199 (AB#893): a member's share of a dissolved conglomerate's treasury
    "conglomerate-withdrawal", // ISP-204 (AB#898): credits a founder or director took from the treasury
    "conglomerate-station-refund", // ISP-210 (AB#905): a member's own credits back from a cancelled station project
    "conglomerate-stake-buyout", // ISP-211 (AB#906): a departed corporation's station stake, paid out by the treasury
    "forced-sale", // ISP-286 (AB#993): goods and buildings sold to recover a defaulted player debt
    "concession-fee-share", // ISP-228 (AB#923): an ISA concession holder's share of the lease fees paid in its system
    "tariff-revenue" // ISP-230 (AB#925): a concession holder's tariffs, less the ISA's levy, paid daily
  ]),
  expense: Object.freeze([
    "hiring",
    "payroll",
    "office-rent",
    "leases",
    "transfer-fees",
    "construction",
    "yard-price-growth", // ISP-307 (AB#2299): what a yard costs above the first yard's price (ISP-303), booked apart
    "mining-startup",
    "mining-ops",
    "yard-upkeep", // ISP-307 (AB#2299): the upkeep share of a yard's running cost (ISP-301), booked apart
    "expeditions",
    "research",
    "ceo-insight",
    "exchange-purchases",
    "exchange-escrow",
    "exchange-tax",
    "lease-royalty", // ISP-302 (AB#2285): the royalty's share of a sale's tax, booked apart so it can be counted
    "tariff", // ISP-230 (AB#925): a concession holder's tariff on a sale or a transfer into its system
    "anti-dumping-duty", // ISP-232 (AB#927): the ITC's duty on dumped sales, levied or withheld from later sales
    "loan-disbursal-paid", "loan-repayment-paid", "bond-subscription-paid", "coupon-paid", "dividend-paid", "share-purchase-paid",
    "escrow-hold-paid", "fee-paid", // ISP-146 (AB#840): server/settlement.js
    "loan-interest-paid", // ISP-150 (AB#844): a loan's interest, on its own line of the statements
    "bond-redemption-paid", // ISP-155 (AB#849): an issuer repaying its bonds' face at maturity
    "bond-sale-paid", // Bug #2574: a corporation buying another's bonds
    "conglomerate-charter", "conglomerate-deposit", // ISP-197 (AB#891): the charter fee, a sink, and the deposit into the new treasury
    "conglomerate-contribution", // ISP-204 (AB#898): credits a member put into the treasury (the custody fee comes out of it there)
    "conglomerate-station", // ISP-210 (AB#905): a member's own credits put into its conglomerate's station project
    "ship-production", // ISP-171 (AB#865): ships queued at the Orbital Shipyard
    "troop-training", // ISP-172 (AB#866): troops trained at Headquarters
    "military-upkeep" // ISP-173 (AB#867): what ships and troops cost to keep, on the design's curve
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
  const book = openDayBook(corp, now); // before the balance moves, so a new book opens at the balance before it
  corp.finances.credits = Math.round(Number(corp.finances.credits) || 0) + amount;
  if (amount > 0) {
    recordIncome(corp, name, amount, now);
    book.income[name] = (book.income[name] || 0) + amount;
  } else if (amount < 0) {
    recordExpense(corp, name, -amount, now);
    book.expenses[name] = (book.expenses[name] || 0) - amount;
  }
  return amount;
}

// --- Daily statements (AB#713) ---------------------------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Statements kept per corporation: 90 days, the oldest dropped first. */
export const MAX_STATEMENTS = 90;

/** 00:00 UTC of the day `t` falls in. */
export const utcDayStart = (t) => Math.floor(Number(t) / DAY_MS) * DAY_MS;

/**
 * The open day's book: what applyCredits has moved today, by category, and the balance the day opened with. Opened on
 * first use at the balance of that moment; closeDueDays turns it into a statement and opens the next.
 */
export function openDayBook(corp, now = Date.now()) {
  ensureFinanceTracking(corp);
  const f = corp.finances;
  const book = f.dayBook;
  if (!book || typeof book !== "object" || !Number.isFinite(book.dayStart)) {
    f.dayBook = { dayStart: utcDayStart(now), opening: Math.round(Number(f.credits) || 0), income: {}, expenses: {} };
  } else {
    if (!book.income || typeof book.income !== "object") book.income = {};
    if (!book.expenses || typeof book.expenses !== "object") book.expenses = {};
  }
  return f.dayBook;
}

const total = (o) => Object.values(o || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);

/**
 * Bug #2575: the categories that are financing, not profit or loss: principal lent and repaid, capital raised by bonds
 * and shares and returned at redemption, bonds sold, escrow held and released, and dividends paid (a distribution to
 * owners). They are cash, so the cash flow counts them and still reconciles; the P&L leaves them out, so borrowing or
 * raising capital is never income and repaying it never a loss. Interest, coupons, dividends received and fees stay in.
 */
export const FINANCING_CATEGORIES = Object.freeze([
  "loan-disbursal-received", "loan-disbursal-paid", "loan-repayment-received", "loan-repayment-paid",
  "bond-subscription-received", "bond-subscription-paid", "bond-redemption-received", "bond-redemption-paid",
  "bond-sale-received", "bond-sale-paid", "share-purchase-received", "share-purchase-paid",
  "escrow-hold-paid", "escrow-release-received", "dividend-paid"
]);
const operating = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !FINANCING_CATEGORIES.includes(k)));

/**
 * The three statements for the day that starts at `dayStart`, from the corporation's open day book. Pure: reads the
 * corporation and changes nothing. A day with no book (the server was not running, or nothing moved) is a day of no
 * movement at the current balance.
 *
 * Closing cash is the balance itself. When every movement goes through applyCredits it equals opening + inflows -
 * outflows; `unrecorded` is the difference, 0 unless something moved credits outside the ledger, and is shown rather
 * than hidden so a statement never claims more than it knows.
 */
/**
 * ISP-160 (AB#854): what a corporation's share holdings are worth, for the balance sheet. It needs every issuer's
 * statements, which this module does not see, so server/shareOfferings.js sets it when it loads; until then (a test
 * that never loads the exchange) holdings count as 0.
 */
let valueHoldings = () => 0;
export function setHoldingsValuer(fn) { valueHoldings = typeof fn === "function" ? fn : () => 0; }

/**
 * Bug #4647: what a corporation owes (loans borrowed, bonds issued) and is owed (loans lent, offers in escrow, bonds
 * held). Set by server/balanceSheet.js, which sees the other corporations and the markets; 0 until it loads.
 */
let valueDebt = () => 0;
let valueReceivables = () => 0;
export function setDebtValuer(fn) { valueDebt = typeof fn === "function" ? fn : () => 0; }
export function setReceivablesValuer(fn) { valueReceivables = typeof fn === "function" ? fn : () => 0; }

export function closeDay(corp, dayStart, market = null) {
  const f = corp?.finances || {};
  const book = f.dayBook && f.dayBook.dayStart === dayStart ? f.dayBook : null;
  const closing = Math.round(Number(f.credits) || 0);
  const inflows = total(book?.income);
  const outflows = total(book?.expenses);
  const income = operating(book?.income); // Bug #2575: the P&L is profit and loss only; financing is in the cash flow
  const expenses = operating(book?.expenses);
  const opening = book ? Math.round(Number(book.opening) || 0) : closing;
  const facilities = Math.max(0, Math.round(Number(f.assets) || 0));
  const inventory = market ? valueInventory(corp, market) : Math.max(0, Math.round(Number(f.inventoryValue) || 0));
  const holdings = Math.max(0, Math.round(Number(valueHoldings(corp)) || 0)); // AB#854: shares at the Board's value
  // Bug #4647: debt is a liability and what others owe is an asset, so borrowing does not raise net worth
  const debt = Math.max(0, Math.round(Number(valueDebt(corp)) || 0));
  const receivables = Math.max(0, Math.round(Number(valueReceivables(corp)) || 0));
  const liabilities = computeLiveLiabilities(corp) + debt;
  return {
    day: new Date(dayStart).toISOString().slice(0, 10),
    dayStart,
    pnl: { income, expenses, totalIncome: total(income), totalExpenses: total(expenses), net: total(income) - total(expenses) },
    cashFlow: { opening, inflows, outflows, closing, unrecorded: closing - (opening + inflows - outflows) },
    balanceSheet: {
      credits: closing,
      facilities,
      inventory,
      holdings,
      receivables,
      liabilities,
      debt,
      totalAssets: closing + facilities + inventory + holdings + receivables,
      netWorth: closing + facilities + inventory + holdings + receivables - liabilities
    }
  };
}

/**
 * Close every day that has ended: each becomes a statement in `state.statements` (newest last, at most 90), and the
 * next day opens at the closing balance. Runs before anything reads or moves a corporation's credits, so a movement is
 * always booked on the day it happens and a day missed while nobody looked is closed on the next read. Days before the
 * oldest one kept are skipped rather than closed and dropped. Returns the number of days closed.
 */
export function closeDueDays(state, now = Date.now(), market = null) {
  const corp = state?.corp;
  // A corporation with no finances is left as it is: a read does not invent a balance (it would read as 0 credits).
  if (!corp || !corp.finances || typeof corp.finances !== "object") return 0;
  const book = openDayBook(corp, now);
  if (!Array.isArray(state.statements)) state.statements = [];
  const today = utcDayStart(now);
  if (book.dayStart >= today) return 0;
  const oldestKept = today - MAX_STATEMENTS * DAY_MS;
  let closed = 0;
  // A save idle for longer than we keep starts at the oldest day kept; its old book is older than anything shown.
  let dayStart = Math.max(book.dayStart, oldestKept);
  while (dayStart < today) {
    state.statements.push(closeDay(corp, dayStart, market));
    closed += 1;
    dayStart += DAY_MS;
    corp.finances.dayBook = { dayStart, opening: Math.round(Number(corp.finances.credits) || 0), income: {}, expenses: {} };
  }
  if (state.statements.length > MAX_STATEMENTS) state.statements.splice(0, state.statements.length - MAX_STATEMENTS);
  return closed;
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
  // Bug #1097: wages the corporation could not cover and still owes its staff.
  total += Math.max(0, Number(corp?.finances?.payrollArrears) || 0);

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
