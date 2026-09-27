import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getStatements, listAccountNotifications } from "../../server/gameState.js";
import { bondSeriesList, bondsIssuedBy, bondWindowTick } from "../../server/bonds.js";
import { bondServicingTick, bondHoldingsValue, couponTotal, onBondDefault, splitProRata, LATE_FEE_PCT } from "../../server/bondServicing.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";
import { computeCreditRating } from "../../server/creditRating.js";

// ISP-155 (AB#849): a bond series serviced from its close to redemption, on injected time (P-TEST-TIME): coupons to
// every holder, redemption, arrears and default. docs/design/v0.9-debt.md, sections 2, 7 and 10.
const DAY = 86_400_000;
const UNITS = [1, 2, 3, 5, 8, 13, 21]; // seven holders of uneven sizes, 53 units
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corporation({ level = 10, credits = 150_000 } = {}) {
  const { account, accessToken } = await registerAccount(app);
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: 30 }, (_, i) => ({
      day: new Date(today - (30 - i) * DAY).toISOString().slice(0, 10), dayStart: today - (30 - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    s.corp.finances.credits = credits;
    s.corp.level = level;
  }, { sanitize: false, settleMining: false });
  getStatements(account.id);
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  const setCredits = (n) => mutateAccountState(account.id, (s) => { s.corp.finances.credits = n; }, { sanitize: false, settleMining: false });
  return { id: account.id, api, corp, setCredits };
}

/** An issuer, a 53-unit series at 5.25% for `maturityDays`, sold to seven holders; the fill closes it at once. */
async function soldSeries(maturityDays = 30) {
  const issuer = await corporation();
  const r = await issuer.api.post(`/api/accounts/${issuer.id}/bonds/issue`).send({ quantity: 53, couponPct30: 5.25, maturityDays, windowHours: 24 });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const holders = [];
  for (const units of UNITS) {
    const h = await corporation({ level: 1, credits: 50_000 });
    expect((await h.api.post(`/api/accounts/${h.id}/bonds/${r.body.series.id}/subscribe`).send({ units })).status).toBe(200);
    holders.push({ ...h, units });
  }
  const series = bondSeriesList().find((s) => s.id === r.body.series.id);
  expect(series.state).toBe("live");
  const T0 = series.closedAt;
  const paidOn = (day, reason) => ledgerEntries().filter((e) => e.key.startsWith(`bond:${series.id}:${T0 + day * DAY}:`) && e.reason === reason);
  return { issuer, holders, series, T0, paidOn };
}

describe("ISP-155 splitting a payment", () => {
  it("each holder's share rounded down, the remainder to the largest; the parts sum to the total exactly", () => {
    const weights = [21, 13, 8, 5, 3, 2, 1].map((units, i) => ({ account: `h${i}`, units }));
    for (const total of [649, 1, 52, 53, 1_000_003]) {
      const parts = splitProRata(total, weights);
      expect(parts.reduce((a, p) => a + p.amount, 0)).toBe(total);
      parts.slice(1).forEach((p, i) => expect(p.amount).toBe(Math.floor((total * weights[i + 1].units) / 53)));
    }
    expect(splitProRata(649, weights).map((p) => p.amount)).toEqual([260, 159, 97, 61, 36, 24, 12]);
  });
});

describe("ISP-155 a series from issue to redemption", () => {
  it("coupons every 7 days and a stub at maturity, to seven holders, each total to the credit; then face back, redeemed", async () => {
    const { issuer, holders, series, T0, paidOn } = await soldSeries(30);
    const issuerAfterSale = issuer.corp().finances.credits;
    for (let d = 1; d <= 30; d++) {
      bondServicingTick(T0 + d * DAY);
      bondServicingTick(T0 + d * DAY); // a tick that runs twice pays once
    }
    // coupons on days 7, 14, 21 and 28 (7 days each) and a 2-day stub on day 30, each rounded to the credit once
    const expected = { 7: 7, 14: 7, 21: 7, 28: 7, 30: 2 };
    let coupons = 0;
    for (let d = 1; d <= 30; d++) {
      const paid = paidOn(d, "coupon");
      const want = expected[d] ? couponTotal(series, expected[d]) : 0;
      expect(paid.reduce((a, e) => a + e.credits, 0), `day ${d}`).toBe(want);
      if (want) expect(paid).toHaveLength(7);
      coupons += want;
    }
    expect(couponTotal(series, 7)).toBe(649); // 5.25% x 7/30 x 53,000 = 649.25
    expect(paidOn(7, "coupon").find((e) => e.to === holders[6].id).credits).toBe(260); // the remainder to the largest holder
    // the whole term's coupon, within the per-payment rounding
    expect(Math.abs(coupons - 0.0525 * 53_000)).toBeLessThanOrEqual(5);
    // face back to each holder at maturity
    expect(paidOn(30, "bond-redemption").map((e) => [e.to, e.credits]).sort()).toEqual(holders.map((h) => [h.id, h.units * 1_000]).sort());
    expect(series).toMatchObject({ state: "redeemed", redeemedAt: T0 + 30 * DAY, arrears: 0, couponsPaid: 5 });
    // both sides' statements name what moved
    expect(issuer.corp().finances.expensesByCategory["coupon-paid"]).toBe(coupons);
    expect(issuer.corp().finances.expensesByCategory["bond-redemption-paid"]).toBe(53_000);
    expect(issuerAfterSale - issuer.corp().finances.credits).toBe(coupons + 53_000);
    const big = holders[6];
    expect(big.corp().finances.incomeBySource["coupon-received"]).toBe(paidOn(7, "coupon").concat(paidOn(14, "coupon"), paidOn(21, "coupon"), paidOn(28, "coupon"), paidOn(30, "coupon")).filter((e) => e.to === big.id).reduce((a, e) => a + e.credits, 0));
    expect(big.corp().finances.incomeBySource["bond-redemption-received"]).toBe(21_000);
    expect(big.corp().bondHoldings).toEqual([]);
    expect(bondsIssuedBy(issuer.id)).toEqual([]);
    expect(listAccountNotifications(big.id).notifications.some((n) => n.title === "Bond redeemed")).toBe(true);
    bondServicingTick(T0 + 40 * DAY);
    expect(ledgerEntries().filter((e) => e.key.startsWith(`bond:${series.id}:${T0 + 31 * DAY}`))).toEqual([]); // a redeemed series pays nothing more
  });

  it("what the NPC underwriter holds is paid to its tap, and destroyed", async () => {
    const issuer = await corporation();
    const r = await issuer.api.post(`/api/accounts/${issuer.id}/bonds/issue`).send({ quantity: 20, couponPct30: 12, maturityDays: 30, windowHours: 24 });
    const series = bondSeriesList().find((s) => s.id === r.body.series.id);
    series.closesAt = 0;
    const created = settlementTotals().taps.dsdb ?? 0;
    bondWindowTick(Date.now());
    expect(series.underwriterUnits).toBe(20);
    expect((settlementTotals().taps.dsdb ?? 0) - created).toBe(20_000);
    for (let d = 1; d <= 30; d++) bondServicingTick(series.closedAt + d * DAY);
    expect(series.state).toBe("redeemed");
    // everything the tap created came back to it, and the coupons on top: net, the series destroyed credits
    const coupons = [7, 7, 7, 7, 2].reduce((a, days) => a + couponTotal(series, days), 0);
    expect((settlementTotals().taps.dsdb ?? 0) - created).toBe(-coupons);
  });
});

describe("ISP-155 a missed payment", () => {
  it("goes into arrears with the 5% late fee, accrues penalty, caps the grade; credits later pay it, holders first", async () => {
    const { issuer, holders, series, T0, paidOn } = await soldSeries(30);
    issuer.setCredits(0);
    for (let d = 1; d <= 7; d++) bondServicingTick(T0 + d * DAY);
    const coupon = couponTotal(series, 7);
    expect(series).toMatchObject({ state: "arrears", arrearsSince: T0 + 7 * DAY, missedPayments: 1 });
    expect(series.arrears).toBe(coupon + Math.round((coupon * LATE_FEE_PCT) / 100));
    expect(paidOn(7, "coupon")).toEqual([]); // nothing partial taken
    expect(listAccountNotifications(issuer.id).notifications.find((n) => n.title === "Bond payment missed")?.body).toMatch(/in arrears/);
    const rating = computeCreditRating(issuer.corp(), T0 + 8 * DAY, getStatements(issuer.id, 30, T0).statements, { bonds: bondsIssuedBy(issuer.id) });
    expect(["CCC", "CC", "C", "D"]).toContain(rating.grade);

    const owedBefore = series.arrears;
    bondServicingTick(T0 + 8 * DAY);
    const rate = (5.25 + 15) / 100 / 30;
    const penalty = Object.values(series.arrearsCoupon).reduce((a, v) => a + v, 0) + (series.arrearsFees || 0) - owedBefore;
    expect(penalty).toBe(splitProRata(coupon, UNITS.map((u, i) => ({ account: String(i), units: u })).reverse()).reduce((a, p) => a + Math.round(p.amount * rate), 0));

    issuer.setCredits(100_000);
    bondServicingTick(T0 + 9 * DAY);
    expect(series).toMatchObject({ state: "live", arrears: 0, arrearsSince: null });
    const owedToHolders = paidOn(9, "coupon");
    expect(owedToHolders).toHaveLength(7);
    expect(paidOn(9, "fee").reduce((a, e) => a + e.credits, 0)).toBe(Math.round((coupon * LATE_FEE_PCT) / 100));
    expect(holders[6].corp().finances.incomeBySource["coupon-received"]).toBeGreaterThan(260); // the coupon and its penalty
  });
});

describe("ISP-155 default", () => {
  it("more than 7 days in arrears: defaulted, D, everyone told; what recovery raises is split to the holders pro rata, to the credit", async () => {
    const { issuer, holders, series, T0 } = await soldSeries(30);
    issuer.setCredits(0);
    const RECOVERED = 1_234;
    const calls = [];
    let owedAtDefault = null;
    const off = onBondDefault(({ series: s, owed }) => {
      if (s.id !== series.id) return;
      calls.push(owed);
      owedAtDefault = { ...s.arrearsCoupon };
      issuer.setCredits(RECOVERED); // stands in for ISP-286 (AB#993): what default recovery raised from the issuer
    });
    try {
      for (let d = 1; d <= 14; d++) bondServicingTick(T0 + d * DAY);
      expect(series.state).toBe("arrears"); // 7 days since day 7: not yet
      bondServicingTick(T0 + 15 * DAY);
    } finally { off(); }
    expect(series).toMatchObject({ state: "defaulted", defaultedAt: T0 + 15 * DAY });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeGreaterThan(RECOVERED);
    const recovered = ledgerEntries().filter((e) => e.key.startsWith(`bond:${series.id}:${T0 + 15 * DAY}:recovered:`));
    expect(recovered.reduce((a, e) => a + e.credits, 0)).toBe(RECOVERED);
    expect(recovered.every((e) => e.from === issuer.id && e.reason === "coupon")).toBe(true);
    // pro rata by what each was owed when it defaulted, remainder to the largest
    const weights = Object.entries(owedAtDefault).map(([account, units]) => ({ account, units })).sort((a, b) => b.units - a.units || (a.account < b.account ? -1 : 1));
    expect(Object.fromEntries(recovered.map((e) => [e.to, e.credits]))).toEqual(Object.fromEntries(splitProRata(RECOVERED, weights).map((p) => [p.account, p.amount])));
    expect(issuer.corp().finances.credits).toBe(0);
    expect(computeCreditRating(issuer.corp(), T0 + 16 * DAY, getStatements(issuer.id, 30, T0).statements, { bonds: bondsIssuedBy(issuer.id) }).grade).toBe("D");
    expect(listAccountNotifications(issuer.id).notifications.some((n) => n.title === "Bond series in default")).toBe(true);
    expect(listAccountNotifications(holders[3].id).notifications.some((n) => n.title === "A bond you hold has defaulted")).toBe(true);
  });

  it("a holder's bonds count as liquid in default recovery at 90% of face; redeemed ones count for nothing", async () => {
    const { holders, T0 } = await soldSeries(30);
    expect(bondHoldingsValue(holders[6].corp())).toMatchObject({ total: 18_900 });
    expect(bondHoldingsValue(holders[0].corp()).total).toBe(900);
    for (let d = 1; d <= 30; d++) bondServicingTick(T0 + d * DAY);
    expect(bondHoldingsValue(holders[6].corp()).total).toBe(0);
  });
});
