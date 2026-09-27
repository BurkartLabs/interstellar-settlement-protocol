import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { getStatements, mutateAccountState } from "../../server/gameState.js";
import { acceptLoan, quoteLoan } from "../../server/loans.js";
import { acceptLoanOffer, postLoanOffer } from "../../server/playerLoans.js";
import { computeCreditRating } from "../../server/creditRating.js";

// Bug #4647: debt is a liability and a loan lent is an asset. Borrowing leaves net worth where it was, less the fees it
// cost; lending (an offer in escrow, then a loan) leaves it where it was. Each corporation is compared with a control
// that started the same and did nothing, on the statement both close for the same day.
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corp(credits) {
  const { account } = await registerAccount(app);
  mutateAccountState(account.id, (s) => { s.corp.finances.credits = credits; }, { sanitize: false, settleMining: false });
  return account.id;
}
/** Today's statement, closed by reading it tomorrow. */
const closedToday = (id) => getStatements(id, 1, Date.now() + DAY).statements[0].balanceSheet;

describe("debt on the balance sheet (Bug #4647)", () => {
  it("a loan from the Development Bank is a liability: net worth falls by the origination fee, not rises by the principal", async () => {
    const control = await corp(50_000), borrower = await corp(50_000);
    const q = quoteLoan(borrower, { productId: "dsdb-90", principal: 20_000 }); // unrated: dsdb-90, up to 25,000
    expect(q.ok).toBe(true);
    expect(acceptLoan(borrower, { quoteId: q.quote.id }).ok).toBe(true);
    const c = closedToday(control), b = closedToday(borrower);
    expect(b.credits - c.credits).toBe(20_000 - q.quote.originationFee);
    expect(b.debt).toBe(20_000);
    expect(b.liabilities - c.liabilities).toBe(20_000);
    expect(b.netWorth - c.netWorth).toBe(-q.quote.originationFee);
  });

  it("lending is an asset: an offer in escrow, then the loan it became, leave the lender's net worth where it was", async () => {
    const control = await corp(100_000), lender = await corp(100_000), borrower = await corp(0);
    const posted = postLoanOffer(lender, { principal: 30_000, ratePct30: 4, termDays: 30, minGrade: "NR-accepted" }, Date.now());
    expect(posted.ok).toBe(true);
    expect(closedToday(lender)).toMatchObject({ receivables: 30_000, credits: 70_000 });
    expect(closedToday(lender).netWorth).toBe(closedToday(control).netWorth);

    const taken = acceptLoanOffer(borrower, posted.offer.id, Date.now());
    expect(taken.ok).toBe(true);
    expect(closedToday(lender).receivables).toBe(30_000);
    expect(closedToday(lender).netWorth).toBe(closedToday(control).netWorth);
    expect(closedToday(borrower).debt).toBe(30_000);
  });

  it("the credit rating reads the sheet as it did before the debt line: a statement with debt grades as one without", () => {
    const sheet = (extra) => ({ credits: 50_000, facilities: 100_000, inventory: 0, holdings: 0, liabilities: 5_000, totalAssets: 150_000, netWorth: 145_000, ...extra });
    const days = (bs) => Array.from({ length: 30 }, (_, i) => ({ day: `d${i}`, dayStart: i * DAY, pnl: { totalIncome: 10_000, totalExpenses: 7_000, net: 3_000 }, cashFlow: {}, balanceSheet: bs }));
    const corp = { loans: [{ state: "active", balance: 40_000, arrears: 0, lender: { kind: "npc" } }] };
    const before = computeCreditRating(corp, 31 * DAY, days(sheet()));
    const after = computeCreditRating(corp, 31 * DAY, days(sheet({ debt: 40_000, liabilities: 45_000, netWorth: 105_000, receivables: 0 })));
    expect(after.grade).toBe(before.grade);
    expect(after.inputs).toEqual(before.inputs);
  });
});
