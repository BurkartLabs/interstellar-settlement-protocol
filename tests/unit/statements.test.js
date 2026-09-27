import { describe, it, expect } from "vitest";
import { applyCredits, closeDay, closeDueDays, DAY_MS, MAX_STATEMENTS, utcDayStart } from "../../server/finances.js";

// AB#713: a daily close per corporation, from the ledger AB#712 keeps. Every clock here is fake: a timestamp passed in.
const D0 = Date.UTC(2026, 8, 1); // 2026-09-01 00:00 UTC
const at = (day, hours = 0) => D0 + day * DAY_MS + hours * 3_600_000;
const newState = (credits = 100_000) => ({ corp: { finances: { credits, assets: 0, dailyCosts: 0 }, offices: [] } });

describe("the daily close (AB#713)", () => {
  it("three days: each day's closing cash is the next day's opening, and each P&L is that day's ledger", () => {
    const state = newState();
    const c = state.corp;
    closeDueDays(state, at(0, 1)); // opens day 0 at 100,000
    applyCredits(c, -8_000, "hiring", at(0, 2));
    applyCredits(c, 1_200, "exchange", at(0, 3));
    applyCredits(c, -96, "exchange-tax", at(0, 3));
    expect(closeDueDays(state, at(1, 0) + 1000)).toBe(1);
    applyCredits(c, -28_000, "office-rent", at(1, 9));
    expect(closeDueDays(state, at(2, 0))).toBe(1);
    applyCredits(c, 5_000, "missions", at(2, 12));
    applyCredits(c, -2_000, "research", at(2, 13));
    expect(closeDueDays(state, at(3, 0))).toBe(1);

    const [d0, d1, d2] = state.statements;
    expect([d0.day, d1.day, d2.day]).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(d0.pnl).toEqual({ income: { exchange: 1_200 }, expenses: { hiring: 8_000, "exchange-tax": 96 }, totalIncome: 1_200, totalExpenses: 8_096, net: -6_896 });
    expect(d0.cashFlow).toEqual({ opening: 100_000, inflows: 1_200, outflows: 8_096, closing: 93_104, unrecorded: 0 });
    expect(d1.cashFlow).toEqual({ opening: 93_104, inflows: 0, outflows: 28_000, closing: 65_104, unrecorded: 0 });
    expect(d2.cashFlow).toEqual({ opening: 65_104, inflows: 5_000, outflows: 2_000, closing: 68_104, unrecorded: 0 });
    for (let i = 0; i < 2; i++) expect(state.statements[i].cashFlow.closing).toBe(state.statements[i + 1].cashFlow.opening);
    expect(c.finances.dayBook).toEqual({ dayStart: at(3), opening: 68_104, income: {}, expenses: {} });
  });

  it("Bug #2575: financing is cash, not profit: the P&L leaves it out, the cash flow keeps it and still reconciles", () => {
    const plain = newState(), financed = newState();
    for (const s of [plain, financed]) {
      closeDueDays(s, at(0, 1));
      applyCredits(s.corp, 1_200, "exchange", at(0, 2));
      applyCredits(s.corp, -300, "loan-interest-paid", at(0, 3));
      applyCredits(s.corp, 150, "coupon-received", at(0, 3));
    }
    // the same day, with a loan taken, shares sold, a bond redeemed, a loan repaid and a dividend paid
    for (const [n, cat] of [[63_000, "loan-disbursal-received"], [60_000, "share-purchase-received"], [-40_000, "bond-redemption-paid"], [-2_000, "loan-repayment-paid"], [-500, "dividend-paid"]]) {
      applyCredits(financed.corp, n, cat, at(0, 4));
    }
    closeDueDays(plain, at(1, 1));
    closeDueDays(financed, at(1, 1));
    const [p] = plain.statements, [f] = financed.statements;
    expect(f.pnl).toEqual(p.pnl);
    expect(f.pnl).toEqual({ income: { exchange: 1_200, "coupon-received": 150 }, expenses: { "loan-interest-paid": 300 }, totalIncome: 1_350, totalExpenses: 300, net: 1_050 });
    expect(f.cashFlow).toEqual({ opening: 100_000, inflows: 1_350 + 123_000, outflows: 300 + 42_500, closing: 100_000 + 1_050 + 80_500, unrecorded: 0 });
  });

  it("closeDay is pure: it reads the corporation and changes nothing", () => {
    const state = newState();
    applyCredits(state.corp, -500, "hiring", at(0, 5));
    const before = JSON.stringify(state);
    const s = closeDay(state.corp, at(0));
    expect(JSON.stringify(state)).toBe(before);
    expect(s.cashFlow).toEqual({ opening: 100_000, inflows: 0, outflows: 500, closing: 99_500, unrecorded: 0 });
  });

  it("the balance sheet: credits, facilities, inventory, liabilities from computeLiveLiabilities, and net worth", () => {
    const state = newState(50_000);
    Object.assign(state.corp.finances, { assets: 30_000, inventoryValue: 4_000, dailyCosts: 600 });
    state.corp.offices = [{ leaseDailyCost: 1_000, daysRemaining: 3 }];
    closeDueDays(state, at(0, 1));
    closeDueDays(state, at(1, 1));
    expect(state.statements[0].balanceSheet).toEqual({
      credits: 50_000, facilities: 30_000, inventory: 4_000, holdings: 0, liabilities: 600 * 7 + 3_000, totalAssets: 84_000, netWorth: 84_000 - 7_200
    });
  });

  it("with the market, inventory is valued at the standing bids", () => {
    const state = newState();
    state.corp.inventory = { "earth-station-prime": { Silicates: 10 } };
    closeDueDays(state, at(0, 1));
    closeDueDays(state, at(1, 1), { npcBuyOrders: [{ item: "Silicates", unitPrice: 24 }] });
    expect(state.statements[0].balanceSheet.inventory).toBe(240);
  });

  it("a missed day is closed on the next read: nothing moved, so it opens and closes at the same balance", () => {
    const state = newState();
    applyCredits(state.corp, -1_000, "hiring", at(0, 20));
    // Nobody looks for three days, then a read on day 3.
    expect(closeDueDays(state, at(3, 7))).toBe(3);
    expect(state.statements.map((s) => [s.day, s.cashFlow.opening, s.cashFlow.outflows, s.cashFlow.closing])).toEqual([
      ["2026-09-01", 100_000, 1_000, 99_000],
      ["2026-09-02", 99_000, 0, 99_000],
      ["2026-09-03", 99_000, 0, 99_000]
    ]);
    expect(closeDueDays(state, at(3, 8))).toBe(0); // the same day again closes nothing
  });

  it("a movement after midnight lands on the new day once the day has closed", () => {
    const state = newState();
    closeDueDays(state, at(0, 1));
    applyCredits(state.corp, -100, "hiring", at(0, 23));
    closeDueDays(state, at(1, 0) + 5); // the close runs before the next movement (mutateAccountState does this)
    applyCredits(state.corp, -200, "hiring", at(1, 0) + 10);
    closeDueDays(state, at(2, 1));
    expect(state.statements.map((s) => s.pnl.totalExpenses)).toEqual([100, 200]);
  });

  it("keeps at most 90: the 91st drops the oldest", () => {
    const state = newState();
    closeDueDays(state, at(0, 1));
    for (let d = 1; d <= 91; d++) {
      applyCredits(state.corp, -1, "hiring", at(d - 1, 12));
      closeDueDays(state, at(d, 1));
    }
    expect(state.statements).toHaveLength(MAX_STATEMENTS);
    expect(state.statements[0].day).toBe("2026-09-02"); // day 0 was the one dropped
    expect(state.statements.at(-1).dayStart).toBe(at(90));
  });

  it("a save idle for a year closes only the last 90 days, without walking the rest", () => {
    const state = newState();
    closeDueDays(state, at(0, 1));
    expect(closeDueDays(state, at(400, 1))).toBe(90);
    expect(state.statements[0].dayStart).toBe(at(310));
    expect(state.statements.at(-1).dayStart).toBe(at(399));
  });

  it("credits moved outside the ledger show as unrecorded instead of disappearing", () => {
    const state = newState();
    closeDueDays(state, at(0, 1));
    state.corp.finances.credits += 777; // a bypass, the kind AB#712's guard test forbids
    closeDueDays(state, at(1, 1));
    expect(state.statements[0].cashFlow).toMatchObject({ opening: 100_000, inflows: 0, outflows: 0, closing: 100_777, unrecorded: 777 });
  });

  it("a corporation with no finances is left alone: a read does not invent a balance", () => {
    const state = { corp: { finances: null } };
    expect(closeDueDays(state, at(3))).toBe(0);
    expect(state.corp.finances).toBeNull();
  });

  it("an older save with no day book opens one at its balance; days are UTC", () => {
    const state = newState(12_345);
    expect(closeDueDays(state, at(5, 23))).toBe(0);
    expect(state.corp.finances.dayBook).toEqual({ dayStart: at(5), opening: 12_345, income: {}, expenses: {} });
    expect(utcDayStart(Date.UTC(2026, 8, 3, 23, 59, 59, 999))).toBe(Date.UTC(2026, 8, 3));
  });
});
