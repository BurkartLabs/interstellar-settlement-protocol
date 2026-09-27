import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getStatements, listAccountNotifications } from "../../server/gameState.js";
import { bondSeriesList } from "../../server/bonds.js";
import { bondServicingTick, holdersOf, recoveryPrice } from "../../server/bondServicing.js";
import { bondRecoveryTick, recoverDefault, GRACE_HOURS } from "../../server/defaultRecovery.js";
import { postLoanOffer, acceptLoanOffer } from "../../server/playerLoans.js";
import { recoveryHold } from "../../server/recoveryHold.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";

// Bug #2574: a defaulted bond series is recovered like a defaulted player loan (docs/design/v0.9-debt.md section 10;
// the Board on AB#702: "Anything liquid, assets force sold if not able to cover."), and a debtor's own bond holdings are
// liquid at 90% of face. Time is injected (P-TEST-TIME).
const DAY = 86_400_000, HOUR = 3_600_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corporation({ level = 10, credits = 400_000 } = {}) {
  const { account, accessToken } = await registerAccount(app);
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: 30 }, (_, i) => ({
      day: new Date(today - (30 - i) * DAY).toISOString().slice(0, 10), dayStart: today - (30 - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    s.corp.level = level;
    s.corp.buildingSlots = 8;
    s.corp.unlockedTech = ["tt-material-compression", "tt-nano-lattice"];
    s.corp.finances.credits = credits;
  }, { sanitize: false, settleMining: false });
  getStatements(account.id);
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  const setCredits = (n) => mutateAccountState(account.id, (s) => { s.corp.finances.credits = n; }, { sanitize: false, settleMining: false });
  return { id: account.id, api, corp, setCredits, credits: () => Math.round(corp().finances.credits) };
}

/** An issuer's 30-unit series bought by three holders (15, 10, 5), closed, then left unpaid into default on day 15. */
async function defaultedSeries(issuer = null) {
  issuer = issuer ?? await corporation();
  const s = (await issuer.api.post(`/api/accounts/${issuer.id}/bonds/issue`).send({ quantity: 30, couponPct30: 5, maturityDays: 60, windowHours: 24 })).body.series;
  const holders = [];
  for (const units of [15, 10, 5]) {
    const h = await corporation({ level: 1, credits: 100_000 });
    expect((await h.api.post(`/api/accounts/${h.id}/bonds/${s.id}/subscribe`).send({ units })).status).toBe(200);
    holders.push({ ...h, units });
  }
  const series = bondSeriesList().find((x) => x.id === s.id);
  const T0 = series.closedAt;
  issuer.setCredits(0);
  for (let d = 1; d <= 15; d++) bondServicingTick(T0 + d * DAY);
  expect(series).toMatchObject({ state: "defaulted", defaultedAt: T0 + 15 * DAY });
  return { issuer, holders, series, T0, D: T0 + 15 * DAY };
}
const recoveredTo = (series, account) => ledgerEntries().filter((e) => e.key.startsWith(`recovery:${series.id}:`) && e.to === account).reduce((a, e) => a + e.credits, 0);

describe("Bug #2574: a defaulted bond series is recovered", () => {
  it("warns issuer and holders, holds the issuer for 24 hours, then takes credits, bonds and buildings; each holder is paid what it is owed", async () => {
    const issuer = await corporation();
    const build = await issuer.api.post(`/api/accounts/${issuer.id}/gameplay/build`).send({ buildingId: "refinery" });
    expect(build.status, JSON.stringify(build.body.error)).toBe(200);
    // the issuer also holds 10 units of another corporation's series, which recovery may sell
    const other = await corporation();
    const o = (await other.api.post(`/api/accounts/${other.id}/bonds/issue`).send({ quantity: 50, couponPct30: 5, maturityDays: 90, windowHours: 48 })).body.series;
    expect((await issuer.api.post(`/api/accounts/${issuer.id}/bonds/${o.id}/subscribe`).send({ units: 10 })).status).toBe(200);
    const { holders, series, D } = await defaultedSeries(issuer);

    bondRecoveryTick(D);
    expect(issuer.corp().recoveries.find((r) => r.seriesId === series.id)).toMatchObject({ state: "grace", saleAt: D + GRACE_HOURS * HOUR });
    expect(recoveryHold(issuer.corp())).not.toBe("");
    expect(listAccountNotifications(issuer.id).notifications.some((n) => n.title === "Your assets will be sold in 24 hours")).toBe(true);
    expect(listAccountNotifications(holders[0].id).notifications.some((n) => n.title === "Bond recovery begins in 24 hours")).toBe(true);
    bondRecoveryTick(D + 23 * HOUR);
    expect(ledgerEntries().filter((e) => e.key.startsWith(`recovery:${series.id}:`))).toEqual([]); // nothing before the grace ends

    // what each holder is owed once the face falls due: its coupon and face arrears, and its units' face
    const owed = Object.fromEntries(holders.map((h) => [h.id, (series.arrearsCoupon[h.id] || 0) + (series.arrearsFace[h.id] || 0) + h.units * 1_000]));
    const fees = series.arrearsFees;
    issuer.setCredits(5_000);
    const tapBefore = settlementTotals().taps.dsdb ?? 0;
    bondRecoveryTick(D + GRACE_HOURS * HOUR);

    const rec = issuer.corp().recoveries.find((r) => r.seriesId === series.id);
    expect(rec.state).toBe("done");
    expect(rec.result.shortfall).toBe(0);
    expect(rec.result.sold.map((x) => x.kind)).toContain("bond");
    expect(series).toMatchObject({ state: "redeemed", accelerated: true, arrears: 0 });
    for (const h of holders) {
      expect(recoveredTo(series, h.id), `holder of ${h.units}`).toBe(owed[h.id]);
      expect(h.corp().bondHoldings).toEqual([]);
    }
    // everything collected went to the holders and, last, the fee sink: to the credit
    const toHolders = holders.reduce((a, h) => a + recoveredTo(series, h.id), 0);
    expect(toHolders + fees).toBe(rec.result.collected);
    // the issuer's bonds went to the underwriter at 90% of face, paid from its tap
    const sale = ledgerEntries().find((e) => e.key.startsWith(`recovery:${series.id}:`) && e.reason === "bond-sale");
    const unitsSold = sale.credits / recoveryPrice(o);
    expect(Number.isInteger(unitsSold) && unitsSold >= 1 && unitsSold <= 10).toBe(true);
    expect(bondSeriesList().find((x) => x.id === o.id).underwriterUnits).toBeGreaterThanOrEqual(unitsSold);
    expect((settlementTotals().taps.dsdb ?? 0) - tapBefore).toBeGreaterThanOrEqual(sale.credits);
    expect(listAccountNotifications(holders[2].id).notifications.some((n) => n.title === "Bond recovery")).toBe(true);
    expect(recoveryHold(issuer.corp())).toBe("");
  });

  it("paying the arrears inside the grace period cancels the sale, and nothing is sold", async () => {
    const { issuer, series, D } = await defaultedSeries();
    bondRecoveryTick(D);
    issuer.setCredits(200_000);
    bondServicingTick(D + DAY); // the issuer's credits clear the arrears: the series is out of default
    expect(series.state).toBe("live");
    bondRecoveryTick(D + GRACE_HOURS * HOUR);
    expect(issuer.corp().recoveries.find((r) => r.seriesId === series.id).state).toBe("cancelled");
    expect(series.accelerated).toBeUndefined();
    expect(ledgerEntries().filter((e) => e.key.startsWith(`recovery:${series.id}:`))).toEqual([]);
    expect(listAccountNotifications(issuer.id).notifications.some((n) => n.title === "Sale cancelled")).toBe(true);
  });

  it("an issuer with too little: what there is is split to the holders pro rata by what each is owed, to the credit; the rest stays owed", async () => {
    const { issuer, holders, series, D } = await defaultedSeries();
    bondRecoveryTick(D);
    issuer.setCredits(3_001);
    bondRecoveryTick(D + GRACE_HOURS * HOUR);
    const rec = issuer.corp().recoveries.find((r) => r.seriesId === series.id);
    expect(rec.result.collected).toBe(3_001);
    expect(rec.result.shortfall).toBe(series.arrears); // face and arrears, less the 3,001
    expect(series.arrears).toBeGreaterThan(30_000 - 3_001);
    expect(holders.reduce((a, h) => a + recoveredTo(series, h.id), 0)).toBe(3_001); // the holders before the fee sink
    expect(recoveredTo(series, holders[0].id)).toBeGreaterThan(recoveredTo(series, holders[1].id));
    expect(series).toMatchObject({ state: "defaulted", accelerated: true });
    expect(holdersOf(series).map((h) => h.units)).toEqual([15, 10, 5]); // still owed, so still held
    // what it earns later is still collected daily for the holders
    issuer.setCredits(1_000);
    bondServicingTick(D + 2 * DAY);
    expect(issuer.credits()).toBe(0);
  });
});

describe("Bug #2574: a loan debtor's bond holdings are liquid", () => {
  it("are sold to the underwriter at 90% of face, only as many units as the debt takes, before any building", async () => {
    const lender = await corporation({ level: 1, credits: 100_000 });
    const debtor = await corporation({ level: 1, credits: 100_000 });
    const issuer = await corporation();
    const s = (await issuer.api.post(`/api/accounts/${issuer.id}/bonds/issue`).send({ quantity: 50, couponPct30: 5, maturityDays: 90, windowHours: 48 })).body.series;
    expect((await debtor.api.post(`/api/accounts/${debtor.id}/bonds/${s.id}/subscribe`).send({ units: 40 })).status).toBe(200);
    const T0 = Date.now();
    const offer = postLoanOffer(lender.id, { principal: 20_000, ratePct30: 3, termDays: 30, minGrade: "NR-accepted" }, T0);
    const { loan } = acceptLoanOffer(debtor.id, offer.offer.id, T0);
    mutateAccountState(debtor.id, (st) => {
      const l = st.corp.loans.find((x) => x.id === loan.id);
      Object.assign(l, { arrearsFees: 100, arrearsInterest: 400, arrearsPrincipal: 1_500, arrears: 2_000, balance: 20_000, state: "arrears", arrearsSince: T0, defaultedAt: T0 + 8 * DAY });
      st.corp.finances.credits = 0;
    }, { sanitize: false, settleMining: false });
    const r = recoverDefault(debtor.id, loan.id, T0 + 9 * DAY);
    expect(r.shortfall).toBe(0);
    expect(r.collected).toBe(22_000);
    const bond = r.sold.find((x) => x.kind === "bond");
    expect(bond.credits).toBe(25 * 900); // ceil(22,000 / 900) = 25 units
    expect(r.sold.some((x) => x.kind === "building")).toBe(false);
    expect(debtor.corp().bondHoldings).toEqual([{ seriesId: s.id, units: 15 }]);
    expect(bondSeriesList().find((x) => x.id === s.id).underwriterUnits).toBe(25);
    expect(debtor.credits()).toBe(25 * 900 - 22_000); // the surplus stays with the debtor
    expect(debtor.corp().finances.incomeBySource["bond-sale-received"]).toBe(22_500);
  });
});
