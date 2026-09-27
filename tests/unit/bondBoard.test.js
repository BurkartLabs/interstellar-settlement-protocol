import { describe, it, expect } from "vitest";
import { bondPreviewHtml, countdown, holdingsHtml, issuedHtml, issueFormHtml, openSeriesHtml, seriesBadge } from "../../public/scripts/bondBoard.js";

// ISP-156 (AB#850): the bond board, as HTML. The figures are what GET /bonds and POST /bonds/preview return.
const NOW = Date.UTC(2026, 8, 28, 12, 0);
const HOUR = 3_600_000, DAY = 86_400_000;
const TERMS = { faceValue: 1000, minQuantity: 10, maxQuantity: 1000, minCouponPct30: 1, maxCouponPct30: 15, couponStepPct30: 0.25, maturityDays: [30, 60, 90], windowHours: [24, 48], impliedYieldPct30: { AAA: 3, AA: 3.5, A: 4, BBB: 5, BB: 6, B: 8 } };
const series = (over = {}) => ({ id: "bond-1", issuerName: "Helios Freight", grade: "BB", impliedYieldPct30: 6, faceValue: 1000, quantity: 200, sold: 10, left: 190, couponPct30: 5.5, couponEveryDays: 7, maturityDays: 60, state: "subscribing", closesAt: NOW + 5 * HOUR + 12 * 60_000, arrears: 0, ...over });
const board = (over = {}) => ({ now: NOW, open: [series(), series({ id: "bond-2", issuerName: "Kestrel Mining", grade: "BBB", impliedYieldPct30: 5, couponPct30: 3.75, left: 120, quantity: 120 })], issued: [], holdings: [], eligibility: { eligible: true, why: null, grade: "AA", level: 10, minLevel: 10 }, terms: TERMS, ...over });
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("ISP-156 open series", () => {
  it("each shows issuer, grade, coupon against its grade's yield, maturity, units left and the window's countdown", () => {
    const t = text(openSeriesHtml(board()));
    for (const s of ["Helios Freight", "BB", "5.5% per 30 days", "(grade BB implies 6%)", "60 days after the window closes", "190 of 200, 1,000 credits each", "Window closes in 5 h 12 min", "Kestrel Mining", "3.75% per 30 days"]) expect(t).toContain(s);
    expect(openSeriesHtml(board()).match(/data-role="bond-subscribe"/g)).toHaveLength(2);
  });

  it("the caller's own series has no subscribe form; none open says so", () => {
    expect(openSeriesHtml(board(), new Set(["bond-1"])).match(/data-role="bond-subscribe"/g)).toHaveLength(1);
    expect(text(openSeriesHtml(board({ open: [] })))).toContain("No series is open for subscribing");
  });

  it("counts down in hours and minutes, then says closing", () => {
    expect(countdown(NOW + 48 * HOUR, NOW)).toBe("48 h 0 min");
    expect(countdown(NOW + 12 * 60_000, NOW)).toBe("12 min");
    expect(countdown(NOW - 1, NOW)).toBe("closing");
  });
});

describe("ISP-156 the issue form", () => {
  it("shows the grade-implied yield beside the coupon field, and the preview's coupons over the bond's life", () => {
    const preview = { quantity: 100, couponPct30: 6, maturityDays: 60, face: 100_000, gradeNow: "AA", grade: "A", impliedYieldPct30: 4, underwriterShare: 1, schedule: new Array(9), couponCostIfSold: 11_997, repayIfSold: 111_997 };
    const html = issueFormHtml(board(), { couponPct30: 6 }, preview);
    const coupon = html.slice(html.indexOf('id="bond-coupon"'), html.indexOf("</div>", html.indexOf('id="bond-coupon"')));
    expect(text(coupon)).toContain("Grade A implies 4%");
    const t = text(html);
    for (const s of ["A (from AA)", "takes 100% of what is unsold", "11,997 credits if every unit sells (9 payments)", "111,997 credits: 100,000 face and the coupons"]) expect(t).toContain(s);
    expect(html).not.toMatch(/data-role="bond-issue-submit" disabled/);
  });

  it("before a preview, the button waits; a refused preview says why", () => {
    expect(issueFormHtml(board())).toMatch(/data-role="bond-issue-submit" disabled/);
    expect(text(bondPreviewHtml(null, "Issuing takes a grade of B or better; your corporation is CCC with this series sold."))).toContain("CCC with this series sold");
  });

  it("an ineligible issuer sees why, not a disabled button", () => {
    for (const why of ["Issuing bonds takes corporation level 10; yours is level 3.", "An unrated corporation may not issue bonds: the Bank's credit desk needs more days of statements first.", "Issuing takes a grade of B or better; your corporation is D now."]) {
      const html = issueFormHtml(board({ eligibility: { eligible: false, why, grade: "D", level: 3, minLevel: 10 } }));
      expect(text(html)).toContain(why);
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<button");
    }
  });
});

describe("ISP-156 holdings and issued series", () => {
  it("a holding shows the next coupon's date and amount, maturity, its standing and its recovery value", () => {
    const b = board({ holdings: [{ units: 40, value: 36_000, next: { at: NOW + 4 * DAY, coupon: 583, face: 0 }, series: series({ state: "live", maturesAt: NOW + 87 * DAY, couponPct30: 6.25 }) }] });
    const t = text(holdingsHtml(b));
    for (const s of ["40 units", "Current", "Next coupon 583 credits, 2 Oct, 12:00 UTC", "Matures 24 Dec, 12:00 UTC", "36,000 credits in default recovery"]) expect(t).toContain(s);
  });

  it("the last coupon names the face coming back; arrears and default show on the holding", () => {
    const last = board({ holdings: [{ units: 40, value: 36_000, next: { at: NOW, coupon: 100, face: 40_000 }, series: series({ state: "arrears", arrears: 2_000, arrearsSince: NOW - DAY }) }] });
    const html = holdingsHtml(last);
    expect(text(html)).toContain("with 40,000 face back");
    expect(text(html)).toContain("In arrears");
    expect(html).toContain("bond-holding--late");
    expect(seriesBadge({ state: "defaulted" })).toContain("Defaulted");
    expect(text(holdingsHtml(board()))).toContain("You hold no bonds");
  });

  it("an issued series shows what sold, what lapsed and the next payment due", () => {
    const b = board({ issued: [{ ...series({ state: "live", sold: 150, underwriterUnits: 40, lapsedUnits: 50 }), next: { at: NOW + DAY, coupon: 1_925, face: 0 } }] });
    const t = text(issuedHtml(b));
    expect(t).toContain("150 of 200 (40 to the underwriter), 50 lapsed");
    expect(t).toContain("Next payment due 1,925 credits, 29 Sep, 12:00 UTC");
  });
});
