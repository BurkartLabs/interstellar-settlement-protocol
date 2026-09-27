import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { bankLoansHtml, bankOffersHtml, bankQuoteHtml, bankTime, payoffTotal } from "../../public/scripts/devBank.js";

// ISP-151 (AB#845): the Development Bank's view, as HTML. Figures are the design's example (docs/design/v0.9-debt.md,
// section 8): 63,000 on dsdb-30 at 5% per 30 days is 2,155 a day.
const T = Date.UTC(2026, 8, 28, 14, 5);
const QUOTE = { id: "lq-1", expiresAt: T + 10 * 60_000, productId: "dsdb-30", termDays: 30, principal: 63_000, ratePct30: 5, dailyPayment: 2_155, payments: 30, lastPayment: 2_147, totalRepaid: 64_642, totalInterest: 1_642, originationFee: 1_575, gradeBefore: "AA", gradeAfter: "A", maxPrincipal: 450_000 };
const LOAN = { id: "loan-1", principal: 63_000, ratePct30: 5, termDays: 30, dailyPayment: 2_155, lastPayment: 2_147, balance: 52_526, paymentsMade: 5, nextDueAt: T + 6 * 86_400_000, arrears: 0, arrearsSince: null, state: "active" };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("ISP-151 the quote", () => {
  it("shows principal, rate, term, daily payment and total repayable before anything is committed", () => {
    const t = text(bankQuoteHtml(QUOTE, T));
    for (const s of ["Principal 63,000 credits", "Rate 5% per 30 days (grade A after the loan)", "Term 30 days", "Daily payment 2,155 credits × 30 (last 2,147)", "Total repayable 64,642 credits", "Interest 1,642 credits", "Origination fee 1,575 credits", "You receive 61,425 credits"]) expect(t).toContain(s);
    expect(t).toContain("holds for 10 min");
  });

  it("an expired quote cannot be accepted", () => {
    const html = bankQuoteHtml(QUOTE, QUOTE.expiresAt + 1);
    expect(html).toMatch(/data-role="bank-accept" disabled/);
    expect(text(html)).toContain("expired");
  });
});

describe("ISP-151 the loans", () => {
  it("a current loan: balance, next payment and its date, Current, and a payoff for the balance plus 1%", () => {
    const html = bankLoansHtml([LOAN], T);
    const t = text(html);
    expect(t).toContain("Still owed 52,526 credits");
    expect(t).toContain("Next payment 2,155 credits, 4 Oct, 14:05 UTC");
    expect(t).toContain("Payments 5 of 30");
    expect(t).toContain("Current");
    expect(html).not.toContain("arrears-badge");
    expect(payoffTotal(LOAN)).toBe(52_526 + 525);
    expect(t).toContain("Pay off now: 53,051 credits");
  });

  it("a loan in arrears carries the badge, what is owed and since when, and its payoff includes the arrears", () => {
    const late = { ...LOAN, state: "arrears", arrears: 2_263, arrearsSince: T };
    const html = bankLoansHtml([late], T);
    expect(html).toContain('data-role="arrears-badge"');
    expect(text(html)).toContain("Arrears 2,263 credits since 28 Sep, 14:05 UTC");
    expect(payoffTotal(late)).toBe(52_526 + 2_263 + 525);
  });

  it("the last payment shows as the last one; repaid loans are listed without a payoff; none says so", () => {
    expect(text(bankLoansHtml([{ ...LOAN, paymentsMade: 29 }], T))).toContain("Next payment 2,147 credits");
    const closed = bankLoansHtml([{ ...LOAN, state: "repaid", balance: 0, closedAt: T, paidOffEarly: true }], T);
    expect(closed).not.toContain("bank-payoff");
    expect(text(closed)).toContain("repaid 28 Sep, 14:05 UTC (early)");
    expect(text(bankLoansHtml([], T))).toContain("No facilities with the Bank.");
  });
});

describe("ISP-151 the offers", () => {
  const OFFERS = { grade: "NR", minPrincipal: 1_000, products: [
    { id: "dsdb-7", termDays: 7, baseRatePct30: 3, maxPrincipal: 0, available: false, why: "Unrated corporations borrow on dsdb-90 only." },
    { id: "dsdb-90", termDays: 90, baseRatePct30: 5, maxPrincipal: 25_000, available: true }
  ] };

  it("each product with its limit or why it is closed; the form offers only open products", () => {
    const html = bankOffersHtml(OFFERS);
    const t = text(html);
    expect(t).toContain("graded NR");
    expect(t).toContain("Up to 25,000 credits");
    expect(t).toContain("Unrated corporations borrow on dsdb-90 only.");
    expect(html.match(/<option /g)).toHaveLength(1);
    expect(html).toContain('value="25000"'); // the default principal is capped at the limit
  });

  it("nothing open: no form, and the Bank says so", () => {
    const html = bankOffersHtml({ ...OFFERS, products: OFFERS.products.map((p) => ({ ...p, available: false })) });
    expect(html).not.toContain("<form");
    expect(text(html)).toContain("no facility open");
  });

  it("escapes what it is given", () => {
    expect(bankOffersHtml({ ...OFFERS, grade: "<b>" })).toContain("&lt;b&gt;");
  });
});

describe("ISP-151 the copy", () => {
  it("is the Bank's own voice and names no real bank or rating agency", () => {
    const REAL = /\b(Moody|S&P|Standard (&|and) Poor|Fitch|DBRS|JPMorgan|Goldman|Citi(bank|group)?|HSBC|Barclays|Deutsche Bank|Wells Fargo|Morgan Stanley|World Bank|IMF|Federal Reserve)\b/i;
    const root = path.resolve(import.meta.dirname, "../..");
    const bank = JSON.parse(fs.readFileSync(path.join(root, "data/buildings.json"), "utf8")).buildings.find((b) => b.id === "deep-space-development-bank");
    for (const f of ["public/scripts/devBank.js", "public/scripts/views/developmentBank.js", "server/routes/loans.js"]) {
      expect(fs.readFileSync(path.join(root, f), "utf8"), f).not.toMatch(REAL);
    }
    expect(JSON.stringify(bank)).not.toMatch(REAL);
    expect(bankTime(T)).toBe("28 Sep, 14:05 UTC");
  });
});
