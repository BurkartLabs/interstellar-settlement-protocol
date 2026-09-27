import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getStatements, listAccountNotifications } from "../../server/gameState.js";
import { quoteLoan, acceptLoan } from "../../server/loans.js";
import { loanServicingTick, paymentParts, scheduledBalance, LATE_FEE_PCT } from "../../server/loanServicing.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";
import { computeCreditRating } from "../../server/creditRating.js";

// ISP-150 (AB#844): servicing a Development Bank loan, day by day, on injected time (P-TEST-TIME): nothing here waits
// for the clock. The fixture is the design's example corporation (docs/design/v0.9-debt.md, section 8).
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function borrower(principal = 63_000, productId = "dsdb-30") {
  const { account, accessToken } = await registerAccount(app);
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: 30 }, (_, i) => ({
      day: new Date(today - (30 - i) * DAY).toISOString().slice(0, 10), dayStart: today - (30 - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    s.corp.finances.credits = 150_000;
  }, { sanitize: false, settleMining: false });
  getStatements(account.id);
  const T0 = Date.now();
  const q = quoteLoan(account.id, { productId, principal }, T0);
  const a = acceptLoan(account.id, { quoteId: q.quote.id }, T0);
  expect(a.ok).toBe(true);
  const corp = () => getAccountById(account.id).state.corp;
  const loan = () => corp().loans.find((l) => l.id === a.loan.id);
  const setCredits = (n) => mutateAccountState(account.id, (s) => { s.corp.finances.credits = n; }, { sanitize: false, settleMining: false });
  const paidOn = () => ledgerEntries().filter((e) => e.key.startsWith(`loan:${a.loan.id}:`) && e.from === account.id);
  return { id: account.id, api: authed(app, accessToken), T0, quote: q.quote, corp, loan, setCredits, paidOn };
}

describe("ISP-150 a full term, collected on schedule", () => {
  it("30 daily payments, then repaid; the total paid is the quote's total to the credit", async () => {
    const b = await borrower();
    const tapBefore = settlementTotals().taps.dsdb;
    const interestBefore = settlementTotals().sinks["loan-interest"] ?? 0;
    const creditsAfterLoan = b.corp().finances.credits;
    for (let d = 1; d <= 30; d++) {
      loanServicingTick(b.T0 + d * DAY);
      loanServicingTick(b.T0 + d * DAY); // a tick that runs twice collects once
      expect(b.loan().paymentsMade).toBe(d);
    }
    expect(b.loan()).toMatchObject({ state: "repaid", balance: 0, arrears: 0, paymentsMade: 30 });
    const paid = b.paidOn().reduce((s, e) => s + e.credits, 0);
    expect(paid).toBe(b.quote.totalRepaid);
    expect(creditsAfterLoan - b.corp().finances.credits).toBe(b.quote.totalRepaid);
    // principal went back to the tap (destroyed); interest to its sink, and onto the statements as its own line
    expect(tapBefore - settlementTotals().taps.dsdb).toBe(63_000);
    expect((settlementTotals().sinks["loan-interest"] ?? 0) - interestBefore).toBe(b.quote.totalInterest);
    expect(b.corp().finances.expensesByCategory["loan-interest-paid"]).toBe(b.quote.totalInterest);
    expect(b.corp().finances.expensesByCategory["loan-repayment-paid"]).toBe(63_000);
    expect(listAccountNotifications(b.id).notifications.some((n) => n.title === "Loan repaid")).toBe(true);
  });

  it("a tick that comes late collects every day it missed, in order", async () => {
    const b = await borrower();
    loanServicingTick(b.T0 + 30 * DAY);
    expect(b.loan()).toMatchObject({ state: "repaid", paymentsMade: 30 });
    expect(b.paidOn().reduce((s, e) => s + e.credits, 0)).toBe(b.quote.totalRepaid);
  });

  it("the schedule's principal parts sum to the principal, and each payment is split into interest and principal", async () => {
    const b = await borrower(141_000);
    const l = b.loan();
    let principal = 0, total = 0;
    for (let k = 1; k <= l.termDays; k++) {
      const p = paymentParts(l, k);
      expect(p.interestPart).toBeGreaterThanOrEqual(0);
      principal += p.principalPart;
      total += p.amount;
    }
    expect(principal).toBe(141_000);
    expect(total).toBe(b.quote.totalRepaid);
    expect(scheduledBalance(l, 30)).toBe(0);
  });
});

describe("ISP-150 a corporation that cannot pay: arrears, never seizure", () => {
  it("a missed payment goes into arrears with the late fee, accrues penalty interest, caps the grade, then D; nothing is taken", async () => {
    const b = await borrower();
    b.setCredits(0);
    const kept = () => JSON.stringify({ b: b.corp().buildings, l: b.corp().miningLeases, i: b.corp().inventory, o: b.corp().office, r: b.corp().unlockedTech, lvl: b.corp().level });
    const before = kept();
    loanServicingTick(b.T0 + DAY);
    const missedPay = paymentParts(b.loan(), 1).amount;
    expect(b.loan()).toMatchObject({ state: "arrears", arrearsSince: b.T0 + DAY, paymentsMade: 1 });
    expect(b.loan().arrears).toBe(missedPay + Math.round((missedPay * LATE_FEE_PCT) / 100));
    expect(listAccountNotifications(b.id).notifications.find((n) => n.title === "Loan payment missed")?.body).toMatch(/in arrears/);
    const statements = getStatements(b.id).statements;
    expect(computeCreditRating(b.corp(), b.T0 + 2 * DAY, statements).grade).toBe("CCC");

    const arrearsDay2Expected = b.loan().arrears + Math.round(b.loan().arrears * (5 + 15) / 100 / 30) + missedPay + Math.round(missedPay * 0.05);
    loanServicingTick(b.T0 + 2 * DAY);
    expect(b.loan().arrears).toBe(arrearsDay2Expected); // penalty on yesterday's arrears, then today's missed payment and fee

    for (let d = 3; d <= 30; d++) loanServicingTick(b.T0 + d * DAY);
    expect(computeCreditRating(b.corp(), b.T0 + 30 * DAY, statements).grade).toBe("D");
    expect(b.loan().state).toBe("arrears");
    expect(b.corp().finances.credits).toBe(0);
    expect(kept()).toBe(before); // 30 days of arrears: buildings, leases, inventory, office, research and level unchanged
    expect(getAccountById(b.id)).toBeTruthy();
    expect(b.paidOn()).toEqual([]); // nothing partial was taken
  });

  it("credits arriving later pay the arrears first, then the day's payment; the loan is active again", async () => {
    const b = await borrower();
    b.setCredits(0);
    loanServicingTick(b.T0 + DAY);
    loanServicingTick(b.T0 + 2 * DAY);
    const owed = b.loan().arrears;
    b.setCredits(200_000);
    loanServicingTick(b.T0 + 3 * DAY);
    expect(b.loan()).toMatchObject({ state: "active", arrears: 0, arrearsSince: null, paymentsMade: 3 });
    const penalty = Math.round(owed * (5 + 15) / 100 / 30);
    expect(200_000 - b.corp().finances.credits).toBe(owed + penalty + paymentParts(b.loan(), 3).amount);
    const reasons = new Set(b.paidOn().map((e) => e.reason));
    expect([...reasons].sort()).toEqual(["fee", "loan-interest", "loan-repayment"]);
  });
});

describe("ISP-150 early payoff", () => {
  it("repays the principal still owed plus 1%, closes the loan, and refuses a second payoff", async () => {
    const b = await borrower();
    for (let d = 1; d <= 5; d++) loanServicingTick(b.T0 + d * DAY);
    const owed = b.loan().balance;
    const credits = b.corp().finances.credits;
    const r = await b.api.post(`/api/accounts/${b.id}/loans/${b.loan().id}/payoff`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.paid).toBe(owed + Math.round(owed / 100));
    expect(credits - b.corp().finances.credits).toBe(owed + Math.round(owed / 100));
    expect(b.loan()).toMatchObject({ state: "repaid", balance: 0, arrears: 0, paidOffEarly: true });
    expect((await b.api.post(`/api/accounts/${b.id}/loans/${b.loan().id}/payoff`).send({})).status).toBe(409);
    loanServicingTick(b.T0 + 6 * DAY);
    expect(b.loan().paymentsMade).toBe(5); // a closed loan is not collected
  });

  it("an unknown loan is 404; too few credits is refused with nothing taken", async () => {
    const b = await borrower();
    expect((await b.api.post(`/api/accounts/${b.id}/loans/loan-nope/payoff`).send({})).status).toBe(404);
    b.setCredits(1_000);
    const r = await b.api.post(`/api/accounts/${b.id}/loans/${b.loan().id}/payoff`).send({});
    expect(r.status).toBe(409);
    expect(b.corp().finances.credits).toBe(1_000);
    expect(b.loan().state).toBe("active");
  });
});
