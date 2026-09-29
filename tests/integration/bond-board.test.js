import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getStatements } from "../../server/gameState.js";
import { bondSeriesList, subscribeBond } from "../../server/bonds.js";
import { bondServicingTick } from "../../server/bondServicing.js";
import { couponSchedule } from "../../server/bondTerms.js";
import { ledgerEntries } from "../../server/settlement.js";

// ISP-156 (AB#850): what the bond board reads from the server: whether the caller may issue and why not, the preview
// of a series before it is issued, the open series, and each holding's next coupon, which must be what the servicing
// then pays.
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corporation({ level = 10, days = 30, credits = 400_000, over = {} } = {}) {
  const { account, accessToken } = await registerAccount(app);
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: days }, (_, i) => ({
      day: new Date(today - (days - i) * DAY).toISOString().slice(0, 10), dayStart: today - (days - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    s.corp.level = level;
    s.corp.finances.credits = credits;
    Object.assign(s.corp, over);
  }, { sanitize: false, settleMining: false });
  getStatements(account.id);
  const api = authed(app, accessToken);
  return { id: account.id, api, corp: () => getAccountById(account.id).state.corp, board: async () => (await api.get(`/api/accounts/${account.id}/bonds`)).body };
}

describe("ISP-156 couponSchedule", () => {
  it("is every 7 days and a stub at maturity, and covers the whole term", () => {
    expect(couponSchedule(30)).toEqual([{ day: 7, days: 7 }, { day: 14, days: 7 }, { day: 21, days: 7 }, { day: 28, days: 7 }, { day: 30, days: 2 }]);
    for (const m of [30, 60, 90]) expect(couponSchedule(m).reduce((a, c) => a + c.days, 0)).toBe(m);
    expect(couponSchedule(28).at(-1)).toEqual({ day: 28, days: 7 });
  });
});

describe("ISP-156 eligibility: why a corporation may not issue", () => {
  it("names the level gate, NR, D and an open series; an eligible issuer has no reason", async () => {
    expect((await (await corporation({ level: 3 })).board()).eligibility).toMatchObject({ eligible: false, why: expect.stringMatching(/level 10; yours is level 3/), level: 3 });
    expect((await (await corporation({ days: 3 })).board()).eligibility).toMatchObject({ eligible: false, grade: "NR", why: expect.stringMatching(/unrated/i) });
    const late = { loans: [{ id: "loan-x", state: "arrears", balance: 50_000, arrears: 5_000, arrearsSince: Date.now() - 10 * DAY, principal: 60_000, termDays: 30 }] };
    expect((await (await corporation({ over: late })).board()).eligibility).toMatchObject({ eligible: false, grade: "D", why: expect.stringMatching(/is D now/) });
    const ok = await corporation();
    expect((await ok.board()).eligibility).toMatchObject({ eligible: true, why: null });
    await ok.api.post(`/api/accounts/${ok.id}/bonds/issue`).send({ quantity: 50, couponPct30: 5, maturityDays: 30, windowHours: 24 });
    expect((await ok.board()).eligibility.why).toMatch(/already has a series open/);
  });
});

describe("ISP-156 the preview", () => {
  it("gives the pro-forma grade, its yield, the underwriter's share and the coupons over the life, and changes nothing", async () => {
    const c = await corporation();
    const before = bondSeriesList().length;
    const r = await c.api.post(`/api/accounts/${c.id}/bonds/preview`).send({ quantity: 100, couponPct30: 6, maturityDays: 60 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = r.body.preview;
    expect(p.impliedYieldPct30).toBe({ AAA: 3, AA: 3.5, A: 4, BBB: 5, BB: 6, B: 8 }[p.grade]);
    expect(p.underwriterShare).toBe(Math.min(1, Math.max(0, (6 - (p.impliedYieldPct30 - 2)) / 4)));
    // 8 coupons of 7 days (1,400 each) and a 4-day stub (800): the design's 12,000 for 100 units at 6% over 60 days
    expect(p.schedule).toHaveLength(9);
    expect(p.couponCostIfSold).toBe(12_000);
    expect(p.repayIfSold).toBe(112_000);
    expect(bondSeriesList().length).toBe(before);
    // the same refusals as issuing
    expect((await c.api.post(`/api/accounts/${c.id}/bonds/preview`).send({ quantity: 1_000, couponPct30: 6, maturityDays: 60 })).body.error).toMatch(/with this series sold/);
    expect((await c.api.post(`/api/accounts/${c.id}/bonds/preview`).send({ quantity: 100, couponPct30: 6.1, maturityDays: 60 })).status).toBe(400);
  });
});

describe("ISP-156 the board", () => {
  it("lists open series with the issuer's name; a holding's next coupon is what the servicing then pays", async () => {
    const issuer = await corporation();
    const holder = await corporation({ level: 1 });
    const other = await corporation({ level: 1 });
    const s = (await issuer.api.post(`/api/accounts/${issuer.id}/bonds/issue`).send({ quantity: 30, couponPct30: 5.25, maturityDays: 30, windowHours: 24 })).body.series;
    const open = (await holder.board()).open.find((x) => x.id === s.id);
    expect(open).toMatchObject({ issuerName: issuer.corp().corporationName, left: 30, couponPct30: 5.25, grade: s.grade });
    expect(open).not.toHaveProperty("issuerAccountId");

    subscribeBond(holder.id, { seriesId: s.id, units: 17 }, Date.now(), { holderCap: false }); // Bug #4799: a pre-cap holding
    const pending = (await holder.board()).holdings.find((h) => h.series.id === s.id);
    expect(pending).toMatchObject({ units: 17, next: null, value: 15_300 });
    subscribeBond(other.id, { seriesId: s.id, units: 13 }, Date.now(), { holderCap: false }); // fills and closes it

    const held = (await holder.board()).holdings.find((h) => h.series.id === s.id);
    const series = bondSeriesList().find((x) => x.id === s.id);
    expect(held.series.state).toBe("live");
    expect(held.next.at).toBe(series.closedAt + 7 * DAY);
    bondServicingTick(series.closedAt + 7 * DAY);
    const paid = ledgerEntries().find((e) => e.key === `bond:${s.id}:${series.closedAt + 7 * DAY}:coupon:${holder.id}`);
    expect(paid.credits).toBe(held.next.coupon);
    // the issuer's view: its series and the whole next payment
    const mine = (await issuer.board()).issued.find((x) => x.id === s.id);
    expect(mine.next.at).toBe(series.closedAt + 14 * DAY);
  });
});
