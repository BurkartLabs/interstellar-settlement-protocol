import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getStatements } from "../../server/gameState.js";
import { BOND_TERMS, COUPON_STEPS, bondWindowTick, bondSeriesList, bondsIssuedBy, underwriterShare } from "../../server/bonds.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";
import { computeCreditRating } from "../../server/creditRating.js";

// ISP-154 (AB#848): issuing a bond series and running its subscription window, from docs/design/v0.9-debt.md,
// sections 1, 7 and 11, on injected time for the window (P-TEST-TIME). The issuer is the design's example corporation
// (section 8) at level 10: 900,000 income over 30 days, 150,000 credits, 310,000 net worth.
const DAY = 86_400_000;
const HOUR = 3_600_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corporation({ days = 30, level = 10, credits = 150_000, over = {} } = {}) {
  const { account, accessToken } = await registerAccount(app);
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: days }, (_, i) => ({
      day: new Date(today - (days - i) * DAY).toISOString().slice(0, 10), dayStart: today - (days - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    s.corp.finances.credits = credits;
    s.corp.level = level;
    Object.assign(s.corp, over);
  }, { sanitize: false, settleMining: false });
  getStatements(account.id);
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  return {
    id: account.id, api, corp,
    issue: (body) => api.post(`/api/accounts/${account.id}/bonds/issue`).send(body),
    subscribe: (seriesId, units) => api.post(`/api/accounts/${account.id}/bonds/${seriesId}/subscribe`).send({ units })
  };
}
const TERMS = { quantity: 100, couponPct30: 6, maturityDays: 60, windowHours: 24 };
const stored = (id) => bondSeriesList().find((s) => s.id === id);

describe("ISP-154 the terms", () => {
  it("are the design's (P-TWO-SOURCES): the section 1 bounds and the section 7 implied yields", () => {
    const doc = fs.readFileSync(path.resolve(import.meta.dirname, "../../docs/design/v0.9-debt.md"), "utf8").replace(/\r\n/g, "\n");
    const row = (field) => doc.match(new RegExp(`^\\| \`${field}\` \\|[^|]*\\| (.+) \\|$`, "m"))[1];
    expect(row("quantity")).toMatch(new RegExp(`^${BOND_TERMS.minQuantity} to ${BOND_TERMS.maxQuantity.toLocaleString("en-US")} units$`));
    expect(row("couponPct30")).toMatch(new RegExp(`^${BOND_TERMS.minCouponPct30.toFixed(1)} to ${BOND_TERMS.maxCouponPct30.toFixed(1)}, step ${BOND_TERMS.couponStepPct30}, `));
    expect(row("maturityDays")).toBe(`${BOND_TERMS.maturityDays.slice(0, -1).join(", ")} or ${BOND_TERMS.maturityDays.at(-1)}`);
    expect(row("windowHours")).toMatch(new RegExp(`^${BOND_TERMS.windowHours.join(" or ")} `));
    expect(row("faceValue")).toMatch(new RegExp(`^${BOND_TERMS.faceValue.toLocaleString("en-US")} per unit`));
    expect(doc).toContain(`Level ${BOND_TERMS.minIssuerLevel} or above with a grade of B or better`);
    const [, g, y] = doc.match(/^\| grade \| (.+) \|\n\|[-| ]+\|\n\| implied yield, % per 30 days \| (.+) \|$/m);
    const grades = g.split(" | "), yields = y.split(" | ").map(Number);
    expect(Object.fromEntries(grades.map((g, i) => [g, yields[i]]))).toEqual(BOND_TERMS.impliedYieldPct30);
    expect(BOND_TERMS.issuerGrades).toEqual(grades);
    expect(COUPON_STEPS).toHaveLength(57);
  });

  it("the underwriter's fill is section 8's at grade A, and rises with the coupon at every grade", () => {
    expect([1, 3, 4, 5, 6, 7, 15].map((c) => underwriterShare(c, "A"))).toEqual([0, 0.25, 0.5, 0.75, 1, 1, 1]);
    for (const g of BOND_TERMS.issuerGrades) {
      const fills = COUPON_STEPS.map((c) => underwriterShare(c, g));
      for (let i = 1; i < fills.length; i++) expect(fills[i], `${g} at ${COUPON_STEPS[i]}`).toBeGreaterThanOrEqual(fills[i - 1]);
      expect(fills[0]).toBeLessThan(fills.at(-1));
    }
  });
});

describe("ISP-154 issuing a series", () => {
  it("a rated corporation at level 10 issues; the grade and every figure but its four terms are the server's", async () => {
    const c = await corporation();
    const r = await c.issue({ ...TERMS, faceValue: 1, grade: "AAA", sold: 100 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.series).toMatchObject({ faceValue: 1_000, quantity: 100, couponPct30: 6, maturityDays: 60, sold: 0, left: 100, state: "subscribing" });
    expect(BOND_TERMS.issuerGrades).toContain(r.body.series.grade);
    expect(r.body.series.closesAt - r.body.series.issuedAt).toBe(24 * HOUR);
    expect(r.body.series).not.toHaveProperty("issuerAccountId");
    expect(r.body.series.issuerName).toBe(c.corp().corporationName); // Bug #2573
    expect(r.body.series.issuerName).toBeTruthy();
    expect((await c.issue(TERMS)).body.error).toMatch(/already has a series open/);
  });

  it("refuses below the level gate, NR, D and CCC issuers, and a series too large for the issuer's record", async () => {
    expect((await (await corporation({ level: 9 })).issue(TERMS)).body.error).toMatch(/level 10/);
    const nr = await (await corporation({ days: 3 })).issue(TERMS);
    expect(nr.status).toBe(409);
    expect(nr.body.error).toMatch(/unrated/i);
    const late = (sinceDays) => ({ loans: [{ id: "loan-x", state: "arrears", balance: 50_000, arrears: 5_000, arrearsSince: Date.now() - sinceDays * DAY, principal: 60_000, termDays: 30 }] });
    expect((await (await corporation({ over: late(10) })).issue(TERMS)).body.error).toMatch(/grade of B or better; your corporation is D now/);
    expect((await (await corporation({ over: late(2) })).issue(TERMS)).body.error).toMatch(/is CCC now/);
    const big = await (await corporation()).issue({ ...TERMS, quantity: 1_000 });
    expect(big.status).toBe(409);
    expect(big.body.error).toMatch(/with this series sold/);
  });

  it("every term is a number from the design's list: anything else is 400 and nothing is issued", async () => {
    const c = await corporation();
    const before = bondSeriesList().length;
    for (const bad of [{ couponPct30: 5.1 }, { couponPct30: 0.75 }, { couponPct30: 15.25 }, { couponPct30: "six" }, { quantity: 9 }, { quantity: 1_001 }, { quantity: 50.5 }, { maturityDays: 45 }, { windowHours: 12 }, { windowHours: "24h" }]) {
      const r = await c.issue({ ...TERMS, ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(bondSeriesList().length).toBe(before);
    expect((await c.issue({ ...TERMS, couponPct30: 5.25 })).status).toBe(200);
  });
});

describe("ISP-154 subscribing", () => {
  it("moves credits from the subscriber to the issuer through settleTransfer (bond-subscription) and records the holding", async () => {
    const issuer = await corporation();
    const buyer = await corporation({ level: 1, credits: 80_000 });
    const s = (await issuer.issue(TERMS)).body.series;
    const r = await buyer.subscribe(s.id, 30);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ units: 30, paid: 30_000, series: { sold: 30, left: 70 } });
    expect(buyer.corp().finances.credits).toBe(50_000);
    expect(issuer.corp().finances.credits).toBe(180_000);
    expect(buyer.corp().bondHoldings).toEqual([{ seriesId: s.id, units: 30 }]);
    const moves = ledgerEntries().filter((e) => e.key.startsWith(`bond:${s.id}:`));
    expect(moves.map((e) => [e.from, e.to, e.credits, e.reason])).toEqual([[buyer.id, issuer.id, 30_000, "bond-subscription"]]);
    expect(issuer.corp().finances.incomeBySource["bond-subscription-received"]).toBe(30_000);
    expect(bondsIssuedBy(issuer.id)).toEqual([{ outstandingFace: 30_000, state: "active", arrearsSince: null, defaultedAt: null }]);
  });

  it("Bug #2571: the bonds a corporation sold are debt to its credit rating", async () => {
    const issuer = await corporation();
    const buyer = await corporation({ level: 1, credits: 500_000 });
    const s = (await issuer.issue(TERMS)).body.series;
    await buyer.subscribe(s.id, 100);
    const now = Date.now();
    const statements = getStatements(issuer.id, 30, now).statements;
    const without = computeCreditRating(issuer.corp(), now, statements);
    const withBonds = computeCreditRating(issuer.corp(), now, statements, { bonds: bondsIssuedBy(issuer.id) });
    expect(withBonds.score).toBeLessThan(without.score);
  });

  it("refuses, moving nothing: more than is left (not cut down), the issuer itself, too few credits, an unknown series", async () => {
    const issuer = await corporation();
    const buyer = await corporation({ level: 1, credits: 500_000 });
    const s = (await issuer.issue(TERMS)).body.series;
    const count = () => ledgerEntries().filter((e) => e.key.startsWith(`bond:${s.id}:`)).length;
    const over = await buyer.subscribe(s.id, 101);
    expect(over.status).toBe(409);
    expect(over.body.error).toMatch(/Only 100 units/);
    expect((await issuer.subscribe(s.id, 5)).body.error).toMatch(/its own bonds/);
    const poor = await corporation({ level: 1, credits: 4_999 });
    expect((await poor.subscribe(s.id, 5)).body.error).toMatch(/takes 5,000 credits/);
    expect((await buyer.subscribe("bond-nope", 5)).status).toBe(404);
    expect(count()).toBe(0);
    expect(stored(s.id).sold).toBe(0);
    expect(buyer.corp().finances.credits).toBe(500_000);
    expect(buyer.corp().bondHoldings ?? []).toEqual([]);
  });

  it("a subscription that fills the series closes it at once, and the underwriter takes nothing", async () => {
    const issuer = await corporation();
    const buyer = await corporation({ level: 1, credits: 500_000 });
    const s = (await issuer.issue(TERMS)).body.series;
    expect((await buyer.subscribe(s.id, 100)).body.series).toMatchObject({ sold: 100, left: 0, state: "live", underwriterUnits: 0, lapsedUnits: 0 });
    expect((await buyer.subscribe(s.id, 1)).body.error).toMatch(/closed to subscribers/);
  });
});

describe("ISP-154 the window closes", () => {
  it("after the window, a subscription moves nothing even before the tick; the tick gives the underwriter its share and lapses the rest", async () => {
    const issuer = await corporation();
    const buyer = await corporation({ level: 1, credits: 500_000 });
    const s = (await issuer.issue({ ...TERMS, couponPct30: 3 })).body.series;
    expect((await buyer.subscribe(s.id, 20)).status).toBe(200);
    const series = stored(s.id);
    const creditsBefore = issuer.corp().finances.credits;
    const tapBefore = settlementTotals().taps.dsdb ?? 0;

    series.closesAt = Date.now() - 1; // the window has ended; the tick has not run
    const late = await buyer.subscribe(s.id, 5);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/closed to subscribers/);
    expect(series.sold).toBe(20);

    const at = Date.now();
    bondWindowTick(at);
    const expected = Math.floor(80 * underwriterShare(3, series.grade));
    expect(series).toMatchObject({ state: "live", playerUnits: 20, underwriterUnits: expected, sold: 20 + expected, lapsedUnits: 80 - expected, closedAt: at, maturesAt: at + 60 * DAY, nextCouponAt: at + 7 * DAY });
    expect(issuer.corp().finances.credits - creditsBefore).toBe(expected * 1_000);
    expect((settlementTotals().taps.dsdb ?? 0) - tapBefore).toBe(expected * 1_000); // the underwriter's credits come from its tap
    bondWindowTick(at + HOUR); // a second tick changes nothing
    expect(series.underwriterUnits).toBe(expected);
    expect(ledgerEntries().filter((e) => e.key === `bond:${s.id}:underwriter`).length).toBe(expected > 0 ? 1 : 0);
  });

  it("the underwriter's fill rises with the coupon: none at 2 points under the grade's yield, all at 2 over; unsold and untaken, it lapses", async () => {
    const fills = [];
    for (const offset of [-2, -1, 0, 1, 2]) {
      const c = await corporation();
      const probe = (await c.issue({ ...TERMS, couponPct30: 8 })).body.series; // learn the grade this issuer gets
      bondWindowTick(0); // nothing is due
      const grade = probe.grade;
      stored(probe.id).state = "lapsed"; // retire the probe series; only its grade was wanted
      const coupon = BOND_TERMS.impliedYieldPct30[grade] + offset;
      const s = (await c.issue({ ...TERMS, couponPct30: coupon })).body.series;
      stored(s.id).closesAt = 0;
      bondWindowTick(Date.now());
      fills.push(stored(s.id).underwriterUnits);
      if (offset === -2) expect(stored(s.id)).toMatchObject({ state: "lapsed", sold: 0, lapsedUnits: 100 });
    }
    expect(fills).toEqual([0, 25, 50, 75, 100]);
  });
});
