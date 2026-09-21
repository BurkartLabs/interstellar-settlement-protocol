import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, mutateState, getState } from "../../server/gameState.js";

// Bug #984: a sale added proceeds / 24 to dailyRevenue and nothing to incomeBySource, so a unit that put about 22
// credits in the bank read as about 1. Revenue is now booked where the cash arrives, at the price actually paid.

// The test process has no data/state.json, so the market the server seeds on load is absent (Bug #975). Seed the
// same Silicates buy order the server does (server/gameState.js NPC_BUY_SEED).
function seedMarket() {
  mutateState((draft) => {
    if (!draft.market) draft.market = {};
    if (!Array.isArray(draft.market.orderBook)) draft.market.orderBook = [];
    if (!Array.isArray(draft.market.npcBuyOrders)) draft.market.npcBuyOrders = [];
    if (!draft.market.npcBuyOrders.some((o) => o.id === "npc-buy-silicates-daily")) {
      draft.market.npcBuyOrders.push({ id: "npc-buy-silicates-daily", item: "Silicates", buyer: "GEX Commodities Authority",
        unitPrice: 24, totalQtyPerDay: 1000000, remainingQty: 1000000, lastResetDate: "" });
    }
  });
}

async function corpWith(silicates) {
  seedMarket();
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "earth-station-prime": { Silicates: silicates } };
    state.corp.finances.credits = 100000;
    state.corp.finances.dailyRevenue = 0;
    state.corp.finances.incomeBySource = {};
    state.corp.finances.expensesByCategory = {};
    state.corp.completedInsights = [];
  });
  return { id: account.id, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp };
}

describe("selling to an NPC buy order (Bug #984)", () => {
  it("books the gross as exchange income and the tax as an expense, and dailyRevenue moves by the gross", async () => {
    const { api, corp } = await corpWith(100);
    const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    expect(order?.unitPrice).toBe(24);

    const res = await api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 50 });
    expect(res.status).toBe(200);

    const gross = 50 * 24;
    const tax = Math.round(gross * 8 / 100);
    const f = corp().finances;
    expect(f.incomeBySource.exchange).toBe(gross);
    expect(f.expensesByCategory["exchange-tax"]).toBe(tax);
    expect(f.dailyRevenue).toBe(gross);
    expect(f.credits).toBe(100000 + gross - tax);
  });
});

describe("selling to another player (Bug #984)", () => {
  it("books the seller's gross as exchange income and the tax as an expense", async () => {
    const seller = await corpWith(0);
    const buyer = await corpWith(0);
    const orderId = `ord-test-${Date.now()}`;
    mutateState((draft) => {
      draft.market.orderBook.unshift({ id: orderId, type: "sell", item: "Silicates", quantity: 10, unitPrice: 30,
        seller: "Seller Corp", sellerAccountId: seller.id, createdAt: Date.now() });
    });

    const res = await buyer.api.post(`/api/market/orders/${orderId}/buy`).send({ quantity: 10 });
    expect(res.status).toBe(200);

    const gross = 10 * 30;
    const tax = Math.round(gross * 8 / 100);
    const f = seller.corp().finances;
    expect(f.incomeBySource.exchange).toBe(gross);
    expect(f.expensesByCategory["exchange-tax"]).toBe(tax);
    expect(f.dailyRevenue).toBe(gross);
    expect(f.credits).toBe(100000 + gross - tax);
    expect(buyer.corp().finances.incomeBySource.exchange).toBeUndefined();
  });
});
