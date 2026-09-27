import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getStatements } from "../../server/gameState.js";
import { LOAN_CATALOG, paymentSchedule, clearQuotes } from "../../server/loans.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";

// ISP-149 (AB#843): the Deep Space Development Bank quotes and lends, from docs/design/v0.9-debt.md, sections 2 and 5.
// The fixture is the design's own example corporation (section 8): 900,000 income over 30 days, 105,000 of it profit,
// 150,000 credits, 310,000 net worth, 20,000 other liabilities. Its table says what dsdb-30 costs at each principal.
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
beforeEach(() => clearQuotes());

async function corporation(days = 30, over = {}) {
  const { account, accessToken } = await registerAccount(app);
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: days }, (_, i) => ({
      day: new Date(today - (days - i) * DAY).toISOString().slice(0, 10), dayStart: today - (days - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    s.corp.finances.credits = 150_000;
    Object.assign(s.corp, over);
  }, { sanitize: false, settleMining: false });
  getStatements(account.id); // file them
  const api = authed(app, accessToken);
  const quote = (body) => api.post(`/api/accounts/${account.id}/loans/quote`).send(body);
  const accept = (body) => api.post(`/api/accounts/${account.id}/loans/accept`).send(body);
  const corp = () => getAccountById(account.id).state.corp;
  return { id: account.id, quote, accept, corp };
}

describe("ISP-149 the catalog", () => {
  it("every product has a term, a base rate and a principal cap, as the design's table says (P-TWO-SOURCES)", () => {
    const doc = fs.readFileSync(path.resolve(import.meta.dirname, "../../docs/design/v0.9-debt.md"), "utf8");
    const rows = [...doc.matchAll(/^\| `(dsdb-\d+)` \| (\d+) days \| ([\d.]+)% \| ([\d.]+) \|$/gm)].map((m) => ({ id: m[1], termDays: +m[2], baseRatePct30: +m[3], maxPrincipalMultiple: +m[4] }));
    expect(rows).toEqual(LOAN_CATALOG.products);
    expect(LOAN_CATALOG.products.length).toBeGreaterThanOrEqual(3);
    for (const p of LOAN_CATALOG.products) {
      expect(Number.isInteger(p.termDays) && p.termDays > 0, p.id).toBe(true);
      expect(p.baseRatePct30, p.id).toBeGreaterThan(0);
      expect(p.maxPrincipalMultiple, p.id).toBeGreaterThan(0);
    }
    const spreads = doc.match(/^\| \+0 \| (.+) \|$/m)[0].split("|").slice(1, 10).map((s) => Number(s.trim().replace("+", "")));
    expect(Object.values(LOAN_CATALOG.spreadPct30)).toEqual(spreads);
    expect(Object.values(LOAN_CATALOG.spreadPct30)).toEqual([...Object.values(LOAN_CATALOG.spreadPct30)].sort((a, b) => a - b)); // worse grade, wider spread
  });

  it("the payment is the amortising formula, and the schedule sums exactly", () => {
    const s = paymentSchedule(63_000, 5, 30);
    expect(s.dailyPayment).toBe(2_155); // the design's table, section 8
    expect(s.dailyPayment * 29 + s.lastPayment).toBe(s.totalRepaid);
    expect(Math.abs(s.lastPayment - s.dailyPayment)).toBeLessThan(30);
  });
});

describe("ISP-149 a quote prices the grade after the loan", () => {
  it("the design's example: 63,000 at 5%, 141,000 at 6%, 239,000 at 7%, 361,000 at 9% (dsdb-30)", async () => {
    const c = await corporation();
    const got = [];
    for (const principal of [63_000, 141_000, 239_000, 361_000]) {
      const r = await c.quote({ productId: "dsdb-30", principal });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      got.push([r.body.quote.gradeAfter, r.body.quote.ratePct30]);
    }
    expect(got).toEqual([["A", 5], ["BBB", 6], ["BB", 7], ["B", 9]]);
  });

  it("the marginal rate rises with the principal asked for (the interior optimum, section 8)", async () => {
    const c = await corporation();
    const rates = [];
    for (let principal = 10_000; principal <= 450_000; principal += 40_000) rates.push((await c.quote({ productId: "dsdb-30", principal })).body.quote.ratePct30);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1]);
    expect(rates[rates.length - 1]).toBeGreaterThan(rates[0]);
  });

  it("returns the schedule: daily payment, count, last payment, total and interest", async () => {
    const c = await corporation();
    const q = (await c.quote({ productId: "dsdb-30", principal: 63_000 })).body.quote;
    expect(q).toMatchObject({ productId: "dsdb-30", termDays: 30, principal: 63_000, ratePct30: 5, dailyPayment: 2_155, payments: 30, originationFee: 1_575, gradeBefore: "AA", gradeAfter: "A", maxPrincipal: 450_000 });
    expect(q.totalInterest).toBe(q.totalRepaid - 63_000);
    expect(q.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("ISP-149 accept re-quotes on the server and lends once", () => {
  it("disburses the principal from the bank's tap, takes the fee, and records the loan at the server's rate", async () => {
    const c = await corporation();
    const tapBefore = settlementTotals().taps.dsdb ?? 0;
    const q = (await c.quote({ productId: "dsdb-30", principal: 63_000 })).body.quote;
    const r = await c.accept({ quoteId: q.id, ratePct30: 0.5, dailyPayment: 1, principal: 999_999 }); // a lower rate, ignored
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(c.corp().finances.credits).toBe(150_000 + 63_000 - 1_575);
    const loan = c.corp().loans.at(-1);
    expect(loan).toMatchObject({ lender: { kind: "npc", productId: "dsdb-30" }, principal: 63_000, ratePct30: 5, dailyPayment: 2_155, termDays: 30, balance: 63_000, paymentsMade: 0, arrears: 0, state: "active" });
    expect(settlementTotals().taps.dsdb - tapBefore).toBe(63_000);
    const mine = ledgerEntries().filter((e) => e.key.endsWith(q.id));
    expect(mine.map((e) => [e.reason, e.from, e.credits])).toEqual([["loan-disbursal", "tap:dsdb", 63_000], ["fee", c.id, 1_575]]);
  });

  it("a second accept of the same quote, even at the same moment, lends nothing more", async () => {
    // 1,000 on dsdb-90 does not move the grade, so the second accept's re-quote still matches: only the quote's own
    // state can refuse it (a larger loan would also be refused as "terms changed", which would hide a missing check)
    const c = await corporation();
    const q = (await c.quote({ productId: "dsdb-90", principal: 1_000 })).body.quote;
    const [a, b] = await Promise.all([c.accept({ quoteId: q.id }), c.accept({ quoteId: q.id })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(b.status === 409 ? b.body.error : a.body.error).toMatch(/already been used/);
    expect(c.corp().loans).toHaveLength(1);
    expect((await c.accept({ quoteId: q.id })).status).toBe(409);
    expect(c.corp().finances.credits).toBe(150_000 + 1_000 - 25);
  });

  it("refuses when the terms moved since the quote: wages now owed cap the grade", async () => {
    const c = await corporation();
    const q = (await c.quote({ productId: "dsdb-30", principal: 63_000 })).body.quote;
    mutateAccountState(c.id, (s) => { s.corp.finances.payrollArrears = 500; }, { sanitize: false, settleMining: false });
    const r = await c.accept({ quoteId: q.id });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/changed/);
    expect(c.corp().loans ?? []).toHaveLength(0);
    expect(c.corp().finances.credits).toBe(150_000);
  });
});

describe("ISP-149 what it refuses, with nothing disbursed", () => {
  it("above the product's cap; a D grade; NR above its limit or on a short product; a bad principal; a stranger's quote", async () => {
    const c = await corporation();
    const d = await corporation(30, { loans: [{ state: "defaulted", balance: 5_000, arrears: 0, defaultedAt: Date.now() - DAY }] });
    const nr = await corporation(3);
    const other = await corporation();
    const before = ledgerEntries().length;
    const refusals = [
      [c, { productId: "dsdb-30", principal: 450_001 }, /At most 450,000/],
      [c, { productId: "dsdb-7", principal: 180_001 }, /At most 180,000/],
      [d, { productId: "dsdb-90", principal: 5_000 }, /grade D/],
      [nr, { productId: "dsdb-90", principal: 25_001 }, /At most 25,000/],
      [nr, { productId: "dsdb-30", principal: 5_000 }, /only on dsdb-90/]
    ];
    for (const [who, body, why] of refusals) {
      const r = await who.quote(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toMatch(why);
    }
    for (const principal of [-5_000, 1_500.5, "lots", 0, 999]) expect((await c.quote({ productId: "dsdb-30", principal })).status, String(principal)).toBe(400);
    expect((await c.quote({ productId: "dsdb-365", principal: 5_000 })).status).toBe(400);
    const nrOk = await nr.quote({ productId: "dsdb-90", principal: 25_000 });
    expect(nrOk.body.quote).toMatchObject({ gradeBefore: "NR", ratePct30: 21 }); // 5 + 16
    const theirs = (await other.quote({ productId: "dsdb-30", principal: 10_000 })).body.quote;
    expect((await c.accept({ quoteId: theirs.id })).status).toBe(409);
    expect(ledgerEntries().length).toBe(before);
    for (const who of [c, d, nr, other]) expect(who.corp().finances.credits).toBe(150_000);
  });
});
