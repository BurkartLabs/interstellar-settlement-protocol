import { describe, it, expect } from "vitest";
import {
  recordIncome,
  recordExpense,
  computeLiveLiabilities,
  computeAssetBreakdown,
  buildSnapshot,
  pushSnapshot,
  ensureFinanceTracking,
  MAX_SNAPSHOTS
} from "../../server/finances.js";
import { makeCorp } from "../fixtures/makeCorp.js";
import { refreshDailyExpenses } from "../../server/finances.js";

// The standing buy orders a fresh install seeds (server/gameState.js NPC_BUY_SEED), as far as valuation reads them.
const MARKET = { npcBuyOrders: [
  { item: "Silicates", unitPrice: 24 }, { item: "Helium-3", unitPrice: 92 }, { item: "Nickel", unitPrice: 18 },
  { item: "Titanium", unitPrice: 64 }, { item: "Carbon", unitPrice: 12 }, { item: "Rare Earths", unitPrice: 140 }
] };

describe("ensureFinanceTracking", () => {
  it("initialises tracking fields when missing", () => {
    const corp = makeCorp();
    delete corp.finances.incomeBySource;
    delete corp.finances.expensesByCategory;
    delete corp.finances.snapshots;
    delete corp.finances.lifetimeRevenue;
    delete corp.finances.lifetimeCosts;

    ensureFinanceTracking(corp);

    expect(corp.finances.incomeBySource).toEqual({});
    expect(corp.finances.expensesByCategory).toEqual({});
    expect(corp.finances.snapshots).toEqual([]);
    expect(corp.finances.lifetimeRevenue).toBe(0);
    expect(corp.finances.lifetimeCosts).toBe(0);
  });

  it("preserves existing values", () => {
    const corp = makeCorp({
      finances: {
        incomeBySource: { mining: 50 },
        lifetimeRevenue: 50,
        snapshots: [{ t: 1, credits: 100 }]
      }
    });
    ensureFinanceTracking(corp);
    expect(corp.finances.incomeBySource).toEqual({ mining: 50 });
    expect(corp.finances.lifetimeRevenue).toBe(50);
    expect(corp.finances.snapshots).toHaveLength(1);
  });
});

describe("recordIncome", () => {
  it("creates the source bucket on first call", () => {
    const corp = makeCorp();
    recordIncome(corp, "mining", 1234);
    expect(corp.finances.incomeBySource.mining).toBe(1234);
    expect(corp.finances.lifetimeRevenue).toBe(1234);
  });

  it("accumulates repeated income on the same source", () => {
    const corp = makeCorp();
    recordIncome(corp, "mining", 100);
    recordIncome(corp, "mining", 250);
    recordIncome(corp, "trading", 75);
    expect(corp.finances.incomeBySource.mining).toBe(350);
    expect(corp.finances.incomeBySource.trading).toBe(75);
    expect(corp.finances.lifetimeRevenue).toBe(425);
  });

  it("ignores non-positive amounts", () => {
    const corp = makeCorp();
    recordIncome(corp, "mining", 0);
    recordIncome(corp, "mining", -50);
    expect(corp.finances.incomeBySource.mining ?? 0).toBe(0);
    expect(corp.finances.lifetimeRevenue).toBe(0);
  });

  it("rounds non-integer amounts", () => {
    const corp = makeCorp();
    recordIncome(corp, "mining", 12.7);
    expect(corp.finances.incomeBySource.mining).toBe(13);
  });
});

describe("recordExpense", () => {
  it("creates the category bucket on first call", () => {
    const corp = makeCorp();
    recordExpense(corp, "payroll", 500);
    expect(corp.finances.expensesByCategory.payroll).toBe(500);
    expect(corp.finances.lifetimeCosts).toBe(500);
  });

  it("accumulates and rounds", () => {
    const corp = makeCorp();
    recordExpense(corp, "lease", 100.4);
    recordExpense(corp, "lease", 200.6);
    expect(corp.finances.expensesByCategory.lease).toBe(301);
    expect(corp.finances.lifetimeCosts).toBe(301);
  });

  it("ignores non-positive amounts", () => {
    const corp = makeCorp();
    recordExpense(corp, "payroll", -10);
    expect(corp.finances.expensesByCategory.payroll ?? 0).toBe(0);
    expect(corp.finances.lifetimeCosts).toBe(0);
  });
});

// Bug #1022: every cost booked reaches the cost side of Net Daily Flow, and leaves it after 24 hours.
describe("dailyExpenses", () => {
  const HOUR = 60 * 60 * 1000;
  it("moves with every expense booked, whatever its category", () => {
    const corp = makeCorp();
    recordExpense(corp, "mining-ops", 600, 0);
    recordExpense(corp, "exchange-tax", 45, HOUR);
    recordExpense(corp, "office-rent", 30_000, 2 * HOUR);
    expect(corp.finances.dailyExpenses).toBe(30_645);
    expect(corp.finances.expensesByCategory["mining-ops"]).toBe(600);
  });

  it("drops costs older than 24 hours, so it falls when nothing is spent", () => {
    const corp = makeCorp();
    recordExpense(corp, "mining-ops", 600, 0);
    recordExpense(corp, "mining-ops", 600, 12 * HOUR);
    refreshDailyExpenses(corp, 25 * HOUR);
    expect(corp.finances.dailyExpenses).toBe(600);
    refreshDailyExpenses(corp, 37 * HOUR);
    expect(corp.finances.dailyExpenses).toBe(0);
    expect(corp.finances.lifetimeCosts).toBe(1200);
  });
});

describe("computeLiveLiabilities", () => {
  it("returns 0 for an empty corp", () => {
    const corp = makeCorp();
    expect(computeLiveLiabilities(corp)).toBe(0);
  });

  it("includes 7-day forward operating burden", () => {
    const corp = makeCorp({ finances: { dailyCosts: 1000 } });
    // 7 days of running costs as a forward commitment
    expect(computeLiveLiabilities(corp)).toBe(7000);
  });

  it("includes office lease commitments (daily cost × days remaining)", () => {
    const corp = makeCorp({
      finances: { dailyCosts: 0 },
      offices: [
        { id: "off-1", leaseDailyCost: 500, daysRemaining: 10 },
        { id: "off-2", leaseDailyCost: 300, daysRemaining: 4 }
      ]
    });
    // (500 * 10) + (300 * 4) + 0 forward burden = 6200
    expect(computeLiveLiabilities(corp)).toBe(6200);
  });

  it("treats missing lease fields safely", () => {
    const corp = makeCorp({
      finances: { dailyCosts: 0 },
      offices: [{ id: "off-1" }, { leaseDailyCost: 100 }]
    });
    expect(computeLiveLiabilities(corp)).toBe(0);
  });
});

describe("computeAssetBreakdown", () => {
  it("returns just credits when no other assets exist", () => {
    const corp = makeCorp({ finances: { credits: 1000, assets: 0 } });
    const breakdown = computeAssetBreakdown(corp);
    expect(breakdown.credits).toBe(1000);
    expect(breakdown.facilities).toBe(0);
    expect(breakdown.inventoryEstimate).toBe(0);
    expect(breakdown.total).toBe(1000);
  });

  it("uses finances.assets as the facilities valuation", () => {
    const corp = makeCorp({ finances: { credits: 500, assets: 1500 } });
    const breakdown = computeAssetBreakdown(corp);
    expect(breakdown.facilities).toBe(1500);
    expect(breakdown.total).toBe(2000);
  });

  // Bug #1022: stock was valued at a flat 2 a unit, a twelfth of the Silicates bid.
  it("values inventory at the standing NPC bid for each item, and 0 where nothing bids", () => {
    const corp = makeCorp({
      finances: { credits: 0, assets: 0 },
      inventory: {
        "earth-station-prime": { Silicates: 500, "Nano-Lattice": 50 },
        "mars-orbital-dock": { "Rare Earths": 10 }
      }
    });
    const breakdown = computeAssetBreakdown(corp, MARKET);
    expect(breakdown.inventoryEstimate).toBe(500 * 24 + 10 * 140);
    expect(breakdown.total).toBe(500 * 24 + 10 * 140);
    expect(computeAssetBreakdown(corp).inventoryEstimate).toBe(0);
  });
});

describe("buildSnapshot", () => {
  it("captures the current financial state with a timestamp", () => {
    const corp = makeCorp({
      finances: {
        credits: 50_000,
        assets: 10_000,
        liabilities: 0,
        dailyRevenue: 1200,
        dailyCosts: 800,
        dailyExpenses: 300
      }
    });
    const snap = buildSnapshot(corp, 1_700_000_000_000);
    expect(snap.t).toBe(1_700_000_000_000);
    expect(snap.credits).toBe(50_000);
    expect(snap.assets).toBe(10_000);
    expect(snap.dailyRevenue).toBe(1200);
    expect(snap.dailyCosts).toBe(800);
    // Bug #1022: net flow is income minus costs booked in the last 24 hours, not minus the payroll rate
    expect(snap.dailyExpenses).toBe(300);
    expect(snap.netFlow).toBe(900);
  });

  it("counts inventory toward net worth at the standing bids, and publishes the value (Bug #1022)", () => {
    const corp = makeCorp({ finances: { credits: 1000, assets: 0, dailyCosts: 0 }, inventory: { "earth-station-prime": { Silicates: 500 } } });
    const snap = buildSnapshot(corp, 1, MARKET);
    expect(snap.inventory).toBe(12_000);
    expect(snap.netWorth).toBe(13_000);
    expect(corp.finances.inventoryValue).toBe(12_000);
  });

  it("computes liabilities live (does not trust stale finances.liabilities)", () => {
    const corp = makeCorp({
      finances: { dailyCosts: 1000, liabilities: 99_999_999 },
      offices: [{ leaseDailyCost: 200, daysRemaining: 5 }]
    });
    const snap = buildSnapshot(corp, 1);
    // 7000 forward burden + 1000 lease = 8000
    expect(snap.liabilities).toBe(8000);
  });

  it("computes net worth (assets + credits - liabilities)", () => {
    const corp = makeCorp({
      finances: { credits: 10_000, assets: 5_000, dailyCosts: 100 }
    });
    const snap = buildSnapshot(corp, 1);
    // netWorth = 10000 + 5000 - (100*7) = 14300
    expect(snap.netWorth).toBe(14_300);
  });
});

describe("pushSnapshot", () => {
  it("appends snapshots to corp.finances.snapshots", () => {
    const corp = makeCorp();
    ensureFinanceTracking(corp);
    pushSnapshot(corp, { t: 1, credits: 100 });
    pushSnapshot(corp, { t: 2, credits: 200 });
    expect(corp.finances.snapshots).toHaveLength(2);
    expect(corp.finances.snapshots[1].credits).toBe(200);
  });

  it("caps the rolling window to MAX_SNAPSHOTS entries", () => {
    const corp = makeCorp();
    ensureFinanceTracking(corp);
    for (let i = 0; i < MAX_SNAPSHOTS + 25; i += 1) {
      pushSnapshot(corp, { t: i, credits: i });
    }
    expect(corp.finances.snapshots).toHaveLength(MAX_SNAPSHOTS);
    // Oldest entries dropped
    expect(corp.finances.snapshots[0].t).toBe(25);
    expect(corp.finances.snapshots[MAX_SNAPSHOTS - 1].t).toBe(MAX_SNAPSHOTS + 24);
  });

  it("initialises snapshots array if missing", () => {
    const corp = makeCorp();
    delete corp.finances.snapshots;
    pushSnapshot(corp, { t: 1, credits: 100 });
    expect(corp.finances.snapshots).toHaveLength(1);
  });
});
