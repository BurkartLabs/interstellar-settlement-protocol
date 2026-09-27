import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { openOffering } from "../../server/shareOfferings.js";

// ISP-161 (AB#855): what the Stock Exchange's view reads. An open offering carries the issuer's grade, the company value
// and shares outstanding its price came from, trailing 30-day net income and payout ratio; the caller sees its own
// standing as an issuer; a holding carries its dividends; a purchase and an exit answer with a receipt.
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function corp({ credits = 0 } = {}) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => { s.corp.finances.credits = credits; s.corp.level = 15; }, { sanitize: false, settleMining: false });
  return { id: account.id, api: authed(app, accessToken), base: `/api/accounts/${account.id}`, corp: () => getAccountById(account.id).state.corp };
}
/** Ten closed days of `net` a day, the latest worth `netWorth`. */
function history(c, net, netWorth) {
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(c.id, (s) => {
    s.statements = Array.from({ length: 10 }, (_, i) => ({ day: `d${i}`, dayStart: today - (10 - i) * DAY, pnl: { net }, cashFlow: {}, balanceSheet: { credits: 0, facilities: 0, inventory: 0, liabilities: 0, totalAssets: netWorth, netWorth } }));
    s.corp.shareRegistry.state = "listed";
    s.corp.shareRegistry.payoutRatioPct = 30;
  }, { sanitize: false, settleMining: false });
}

describe("the Stock Exchange's reads (AB#855)", () => {
  it("lists an open offering with grade, company value, shares outstanding, trailing net income and payout ratio", async () => {
    const issuer = await corp(), investor = await corp({ credits: 100_000 });
    history(issuer, 2_000, 1_000_000);
    const opened = openOffering(issuer.id, { quantity: 500 });
    expect(opened.ok).toBe(true);
    const res = await investor.api.get(`${investor.base}/equity/offerings`);
    expect(res.status).toBe(200);
    const row = res.body.open.find((o) => o.id === opened.offering.id);
    expect(row).toMatchObject({ pricePerShare: 100, companyValue: 1_000_000, outstanding: 10_000, netIncome30: 20_000, payoutRatioPct: 30 });
    expect(typeof row.grade).toBe("string");
    expect(row).not.toHaveProperty("issuerAccountId");
    expect(res.body.issuer).toMatchObject({ corpId: investor.corp().publicId, state: "private", payoutRatioBounds: { min: 0, max: 80, step: 5 } });

    const mine = await issuer.api.get(`${issuer.base}/equity/offerings`);
    expect(mine.body.issuer).toMatchObject({ state: "listed", payoutRatioPct: 30, listingFee: 0, canChangePayoutAt: null });
  });

  it("a purchase and an exit answer with a receipt, and a holding carries its dividends", async () => {
    const issuer = await corp(), investor = await corp({ credits: 100_000 });
    history(issuer, 2_000, 1_000_000);
    const { offering } = openOffering(issuer.id, { quantity: 500 });
    const bought = await investor.api.post(`${investor.base}/equity/offerings/${offering.id}/buy`).send({ quantity: 50 });
    expect(bought.status).toBe(200);
    expect(bought.body.receipt).toMatchObject({ title: expect.stringMatching(/^50 shares of .+ bought$/), cost: "5,000 credits" });

    mutateAccountState(issuer.id, (s) => { s.corp.shareRegistry.holders[0].dividendsReceived = 321; }, { sanitize: false, settleMining: false });
    const held = await investor.api.get(`${investor.base}/equity/holdings`);
    expect(held.body.holdings[0]).toMatchObject({ shares: 50, costBasis: 5_000, dividendsReceived: 321 });

    const sold = await investor.api.post(`${investor.base}/equity/holdings/${issuer.corp().publicId}/exit`).send({ quantity: 10 });
    expect(sold.status).toBe(200);
    expect(sold.body.receipt).toMatchObject({ title: expect.stringMatching(/^10 shares of .+ sold$/), grants: [{ label: "Received", value: `${(sold.body.paid).toLocaleString("en-US")} credits` }] });
  });
});
