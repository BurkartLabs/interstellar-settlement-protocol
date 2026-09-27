import { describe, it, expect } from "vitest";
import { canTake, sortOffers, loanBoardHtml, postOfferFormHtml, lentLoansHtml, borrowedLoansHtml, recoveredFromText } from "../../public/scripts/loanBoard.js";

// ISP-153 (AB#847): the loan board's HTML, in the Deep Space Development Bank.
const offer = (over = {}) => ({ id: "lo-1", lenderName: "Helios Freight", principal: 20_000, ratePct30: 3, termDays: 30, minGrade: "BBB", dailyPayment: 750, totalRepaid: 22_400, settlementFee: 100, mine: false, ...over });
const RULES = { minPrincipal: 1_000, maxPrincipal: 100_000, minRatePct30: 2, maxRatePct30: 25, rateStep: 0.25, terms: [7, 30, 90], expiryDays: 7, pairCapPrincipal: 100_000, pairCapDays: 30 };

describe("who may take an offer", () => {
  it("follows the grade order, with NR-accepted open to anyone but D", () => {
    expect(canTake(offer({ minGrade: "BBB" }), "A")).toBe(true);
    expect(canTake(offer({ minGrade: "BBB" }), "BB")).toBe(false);
    expect(canTake(offer({ minGrade: "BBB" }), "NR")).toBe(false);
    expect(canTake(offer({ minGrade: "NR-accepted" }), "NR")).toBe(true);
    expect(canTake(offer({ minGrade: "NR-accepted" }), "D")).toBe(false);
  });

  it("sorts by rate either way, or by minimum grade, easiest first", () => {
    const list = [offer({ id: "a", ratePct30: 5, minGrade: "A" }), offer({ id: "b", ratePct30: 2.5, minGrade: "NR-accepted" }), offer({ id: "c", ratePct30: 9, minGrade: "CCC" })];
    expect(sortOffers(list, "rate-asc").map((o) => o.id)).toEqual(["b", "a", "c"]);
    expect(sortOffers(list, "rate-desc").map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(sortOffers(list, "grade").map((o) => o.id)).toEqual(["b", "c", "a"]);
  });
});

describe("the board", () => {
  it("shows principal, rate, term, minimum grade and the lender's name on every offer, escaped", () => {
    const html = loanBoardHtml({ offers: [offer({ lenderName: "<img src=x onerror=alert(1)>" })], grade: "A" });
    for (const text of ["20,000 credits", "3% per 30 days", "30 days", "BBB or better", "&lt;img src=x"]) expect(html).toContain(text);
    expect(html).not.toContain("<img");
    expect(html).toContain('data-role="loan-offer-accept"');
  });

  it("says what to do when nothing matches, or nothing is posted", () => {
    expect(loanBoardHtml({ offers: [offer({ minGrade: "AAA" })], grade: "BB", onlyMine: true })).toContain("No offers match your grade");
    expect(loanBoardHtml({ offers: [], grade: "A" })).toContain("No open offers yet. Post one below");
    expect(loanBoardHtml({ offers: [offer({ minGrade: "AAA" })], grade: "BB" })).toContain("Needs a grade of AAA; yours is BB");
    expect(loanBoardHtml({ offers: [offer({ mine: true })], grade: "BB" })).toContain("Withdraw your offer");
  });

  it("tells the lender on the form that the principal is held in escrow, and offers only allowed rates", () => {
    const html = postOfferFormHtml(RULES, ["AAA", "BBB", "NR-accepted"]);
    expect(html).toContain("Posting holds the principal in escrow");
    expect(html).toContain('<option value="2">2.00%</option>');
    expect(html).not.toContain(">1.75%<");
    expect(html).toContain("Unrated welcome");
  });
});

describe("the loans", () => {
  const lent = { id: "loan-p-1", principal: 20_000, ratePct30: 3, termDays: 30, dailyPayment: 750, balance: 18_000, arrears: 1_500, state: "arrears", paymentsMade: 4, arrearsSince: Date.UTC(2026, 8, 20), borrowerName: "Nadir Mining", borrowerGrade: "CCC", recovery: null };

  it("shows the lender each borrower's current grade and arrears", () => {
    const html = lentLoansHtml([lent]);
    expect(html).toContain("Nadir Mining");
    expect(html).toMatch(/data-role="borrower-grade">CCC</);
    expect(html).toContain("In arrears");
    expect(html).toContain("1,500 credits since 20 Sep");
  });

  it("shows the lender what was recovered on default, and from what, as it went to the debt", () => {
    const result = { collected: 14_650, shortfall: 0, applied: { fromCredits: 2_000, fromGoods: 7_200, fromAssets: 5_450 }, sold: [{ kind: "inventory", name: "Silicates", credits: 7_200 }, { kind: "building", name: "Refinery", credits: 30_000 }] };
    const html = lentLoansHtml([{ ...lent, defaultedAt: 1, recovery: { state: "done", closedAt: Date.UTC(2026, 8, 29), result } }]);
    expect(html).toContain("In default");
    expect(html).toContain("14,650 credits recovered: 2,000 from credits; 7,200 from goods sold at the exchange (Silicates); 5,450 from force-sold assets (Refinery for 30,000; what they raised beyond the debt stayed with the borrower).");
    expect(recoveredFromText({ collected: 3_000, shortfall: 19_000, applied: { fromCredits: 3_000, fromGoods: 0, fromAssets: 0 }, sold: [] })).toBe("3,000 credits recovered: 3,000 from credits. 19,000 could not be recovered yet and is collected as credits allow.");
  });

  it("warns the borrower, with the date, before anything is force-sold", () => {
    const html = borrowedLoansHtml([{ ...lent, lenderName: "Helios Freight", defaultedAt: 1, recovery: { state: "grace", warnedAt: 1, saleAt: Date.UTC(2026, 8, 30, 14, 5) } }]);
    expect(html).toContain("Your assets will be sold on 30 Sep, 14:05 UTC.");
    expect(html).toContain("Pay the 1,500 credits in arrears before then and nothing is sold.");
    expect(html).toContain('role="alert"');
  });

  it("says what to do when there are none", () => {
    expect(lentLoansHtml([])).toContain("You have not lent to anyone.");
    expect(borrowedLoansHtml([])).toContain("You owe no other corporation.");
  });
});
