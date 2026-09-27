import { describe, it, expect } from "vitest";
import { capTableHtml, holdingReturn, issuerHtml, offeringsHtml, payoutHtml, portfolioHtml } from "../../public/scripts/stockExchange.js";

// ISP-161 (AB#855): the Stock Exchange, as HTML. The figures are what GET /equity/offerings, GET /equity/holdings and
// GET /corporations/:corpId/cap-table return.
const NOW = Date.UTC(2026, 8, 28, 12, 0);
const HOUR = 3_600_000, DAY = 86_400_000;
const offering = (over = {}) => ({ id: "so-1", issuerCorpId: "corp-a", issuerName: "Aurora Dynamics", quantity: 1_500, left: 500, pricePerShare: 132, state: "open", closesAt: NOW + 30 * HOUR, grade: "AA", companyValue: 1_320_000, outstanding: 10_000, netIncome30: 270_000, payoutRatioPct: 25, ...over });
const BOUNDS = { min: 0, max: 80, step: 5, default: 25 };
const standing = (over = {}) => ({ corpId: "corp-a", state: "listed", outstanding: 11_000, listingFee: 0, payoutRatioPct: 25, payoutRatioNextPct: null, payoutRatioBounds: BOUNDS, canChangePayoutAt: null, ...over });
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("ISP-161 offerings", () => {
  it("each shows issuer, grade, company value, shares outstanding and the price they produce, shares left, net income and payout", () => {
    const t = text(offeringsHtml({ now: NOW, open: [offering(), offering({ id: "so-2", issuerCorpId: "corp-n", issuerName: "Nadir Mining", netIncome30: -4_000, grade: "BBB" })] }));
    for (const s of ["Aurora Dynamics", "AA", "132 credits", "1,320,000 credits", "10,000 (1,320,000 ÷ 10,000 = 132)", "500 of 1,500", "+270,000 credits", "25% of net income", "30 h 0 min", "Nadir Mining", "BBB", "−4,000 credits"]) expect(t).toContain(s);
  });

  it("the caller's own offering has no buy form; none open says so", () => {
    const html = offeringsHtml({ now: NOW, open: [offering(), offering({ id: "so-2", issuerCorpId: "corp-n" })] }, "corp-a");
    expect(html.match(/data-role="igsx-buy"/g)).toHaveLength(1);
    expect(text(html)).toContain("Your own offering");
    expect(text(offeringsHtml({ now: NOW, open: [] }))).toContain("No offering is open");
  });
});

describe("ISP-161 the portfolio", () => {
  const up = { issuerCorpId: "corp-a", issuerName: "Aurora Dynamics", shares: 610, costBasis: 80_520, dividendsReceived: 1_718, valuePerShare: 139, value: 84_790, exitPrice: 132 };
  const down = { issuerCorpId: "corp-n", issuerName: "Nadir Mining", shares: 500, costBasis: 43_000, dividendsReceived: 666, valuePerShare: 66, value: 33_000, exitPrice: 62 };

  it("a return is value plus dividends less cost", () => {
    expect(holdingReturn(up)).toBe(84_790 + 1_718 - 80_520);
    expect(holdingReturn(down)).toBe(33_000 + 666 - 43_000);
  });

  it("each holding shows value, cost, dividends received, return and the exit at the server's price; the total adds them", () => {
    const html = portfolioHtml([up, down]);
    const t = text(html);
    for (const s of ["610 shares", "84,790 credits (139 a share)", "80,520 credits", "1,718 credits", "+5,988 credits +7.4%", "−9,334 credits −21.7%", "pays 132 a share", "117,790 credits", "123,520 credits", "2,384 credits", "−3,346 credits −2.7%"]) expect(t).toContain(s);
    expect(html.match(/data-role="igsx-exit"/g)).toHaveLength(2);
  });

  it("a holding in a corporation worth nothing has no exit; no holdings says so", () => {
    expect(portfolioHtml([{ ...down, valuePerShare: 0, value: 0, exitPrice: 0 }])).not.toContain('data-role="igsx-exit"');
    expect(text(portfolioHtml([]))).toContain("You hold no shares");
  });
});

describe("ISP-161 the issuer", () => {
  const cap = { corpId: "corp-a", corporationName: "Aurora Dynamics", authorized: 100_000, outstanding: 11_010, unissued: 88_990, state: "listed", holders: [
    { name: "Aurora Dynamics", kind: "founder", shares: 10_000, pct: 90.83 }, { name: "Helios Freight", kind: "corporation", shares: 610, pct: 5.54 }, { name: "Intergalactic Stock Exchange", kind: "market-maker", shares: 60, pct: 0.54 }] };

  it("the cap table lists every holder with shares and percentage, labelled for a phone", () => {
    const html = capTableHtml(cap);
    for (const s of ["11,010 of 100,000 shares outstanding, 88,990 unissued", "Aurora Dynamics Founder", "10,000", "90.83%", "Helios Freight Investor", "Intergalactic Stock Exchange Market maker", "0.54%"]) expect(text(html)).toContain(s);
    expect(html.match(/data-label="Shares"/g)).toHaveLength(3);
  });

  it("the payout control shows the ratio now, the bounds, and every step within them", () => {
    const html = payoutHtml(standing());
    expect(text(html)).toContain("Payout ratio now: 25%");
    expect(text(html)).toContain("0–80%, in steps of 5");
    expect(html.match(/<option/g)).toHaveLength(17);
    expect(html).toMatch(/<option value="25" selected>/);
  });

  it("a change waiting shows, and a ratio changed this week is locked until when it may change", () => {
    const html = payoutHtml(standing({ payoutRatioNextPct: 40, canChangePayoutAt: NOW + 3 * DAY }));
    expect(text(html)).toContain("From the next period: 40%");
    expect(html).toMatch(/<option value="40" selected>/);
    expect(html).toMatch(/name="payoutRatioPct" disabled/);
    expect(text(html)).toContain("may change again 2147-10-01 12:00 UTC");
  });

  it("an unlisted corporation sees why it may not list, or the fee to list", () => {
    const why = "Listing on the Exchange takes corporation level 15; yours is level 9.";
    expect(text(issuerHtml({ issuer: standing({ state: "private" }), listing: { why }, mine: [] }, cap))).toContain(why);
    const html = issuerHtml({ issuer: standing({ state: "private", listingFee: 13_200 }), listing: { why: null }, mine: [] }, cap);
    expect(text(html)).toContain("List for 13,200 credits");
  });

  it("a listed corporation sees its open offering, or the form to open one", () => {
    const open = { id: "so-1", quantity: 1_500, left: 490, pricePerShare: 132, state: "open", closesAt: NOW + 6 * DAY };
    expect(text(issuerHtml({ issuer: standing(), listing: { why: "already listed" }, mine: [open] }, cap))).toContain("Open: 1,500 shares at 132 credits, 490 left");
    expect(issuerHtml({ issuer: standing(), listing: { why: "already listed" }, mine: [] }, cap)).toContain('data-role="igsx-offer"');
  });
});
