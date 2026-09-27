import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, getStatements } from "../../server/gameState.js";
import { clearQuotes } from "../../server/loans.js";

// ISP-151 (AB#845): what the Development Bank's view reads from the server: the building is open, the offers route
// gives each product's limit for this corporation, and borrowing and paying off answer with the account and an
// ISP-19 receipt naming what was borrowed and the first payment date.
const DAY = 86_400_000;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
beforeEach(() => clearQuotes());

async function corporation(days = 30) {
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
  }, { sanitize: false, settleMining: false });
  getStatements(account.id);
  const api = authed(app, accessToken);
  return { id: account.id, api, corp: () => getAccountById(account.id).state.corp };
}

describe("ISP-151 the Development Bank's building", () => {
  it("is available, and its action opens its own view", () => {
    const { buildings } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../data/buildings.json"), "utf8"));
    expect(buildings.find((b) => b.id === "deep-space-development-bank")).toMatchObject({ available: true, action: "building:deep-space-development-bank" });
    const station = fs.readFileSync(path.resolve(import.meta.dirname, "../../public/scripts/views/station.js"), "utf8");
    expect(station).toMatch(/building\.id === "deep-space-development-bank"\) \{\s+const station = getCurrentStationInfo\(data\);\s+renderDevelopmentBank\(/);
  });
});

describe("ISP-151 GET /loans/offers", () => {
  it("a rated corporation: its grade, and each product's limit from 30 days of income", async () => {
    const c = await corporation();
    const r = await c.api.get(`/api/accounts/${c.id}/loans/offers`);
    expect(r.status).toBe(200);
    expect(r.body.grade).not.toBe("NR");
    expect(r.body.minPrincipal).toBe(1_000);
    expect(r.body.products.map((p) => [p.id, p.maxPrincipal, p.available])).toEqual([["dsdb-7", 180_000, true], ["dsdb-30", 450_000, true], ["dsdb-90", 900_000, true]]);
  });

  it("an unrated corporation: the one product it may use, up to its cap, and why the others are closed", async () => {
    const c = await corporation(3);
    const r = await c.api.get(`/api/accounts/${c.id}/loans/offers`);
    expect(r.body.grade).toBe("NR");
    const byId = Object.fromEntries(r.body.products.map((p) => [p.id, p]));
    expect(byId["dsdb-90"]).toMatchObject({ available: true, maxPrincipal: 25_000 });
    expect(byId["dsdb-7"]).toMatchObject({ available: false, maxPrincipal: 0 });
    expect(byId["dsdb-7"].why).toMatch(/Unrated/);
  });

  it("another corporation's offers are refused", async () => {
    const a = await corporation();
    const b = await corporation();
    expect((await a.api.get(`/api/accounts/${b.id}/loans/offers`)).status).toBe(403);
  });
});

describe("ISP-151 borrowing and paying off answer with the account and a receipt", () => {
  it("accept: the new state, and a receipt naming the amount and the first payment date; payoff: its own receipt", async () => {
    const c = await corporation();
    const q = await c.api.post(`/api/accounts/${c.id}/loans/quote`).send({ productId: "dsdb-30", principal: 63_000 });
    expect(q.status).toBe(200);
    const a = await c.api.post(`/api/accounts/${c.id}/loans/accept`).send({ quoteId: q.body.quote.id });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.state.corp.loans.map((l) => l.id)).toEqual([a.body.loan.id]);
    expect(a.body.state.corp.finances.credits).toBe(150_000 + 63_000 - q.body.quote.originationFee);
    const first = new Date(a.body.loan.nextDueAt);
    expect(a.body.receipt.title).toBe("Loan of 63,000 credits disbursed");
    expect(a.body.receipt.summary).toMatch(/Deep Space Development Bank/);
    expect(a.body.receipt.cost).toBe(`${q.body.quote.originationFee.toLocaleString("en-US")} credits origination fee, taken at disbursal`);
    const grants = Object.fromEntries(a.body.receipt.grants.map((g) => [g.label, g.value]));
    expect(grants.Received).toBe(`${(63_000 - q.body.quote.originationFee).toLocaleString("en-US")} credits`);
    expect(grants["First payment"]).toContain(`${first.getUTCDate()} ${first.toUTCString().split(" ")[2]} ${first.getUTCFullYear()}`);
    expect(grants["First payment"]).toMatch(/UTC$/);

    const p = await c.api.post(`/api/accounts/${c.id}/loans/${a.body.loan.id}/payoff`).send({});
    expect(p.status).toBe(200);
    expect(p.body.paid).toBe(63_000 + 630);
    expect(p.body.receipt).toMatchObject({ title: "Loan paid off", cost: "63,630 credits, including the 1% early settlement fee" });
    expect(p.body.state.corp.loans[0].state).toBe("repaid");
  });
});
