// ISP-302 (AB#2285): the ISA lease royalty through the real routes. A sale to a standing buyer and a player-to-player
// sale see the same rate (both call the one function), the royalty's share is booked under its own ledger category,
// "lease-royalty", and the rate the Exchange page reads moves as soon as a lease is added.

import { describe, expect, it } from "vitest";
import { getApp } from "../helpers/app.js";
import { authed, registerAccount } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState } from "../../server/gameState.js";

async function corporation(leases) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const c = state.corp;
    c.currentStationId = "earth-station-prime";
    c.completedInsights = [];
    c.miningLeases = Array.from({ length: leases }, (_, i) => ({ id: `lease-r-${i}`, body: "Earth" }));
    c.inventory = { "earth-station-prime": { Silicates: 500 } };
    c.finances.credits = 1_000_000;
    c.finances.expensesByCategory = {};
  });
  const corp = () => getAccountById(account.id).state.corp;
  return { id: account.id, api: authed(app, accessToken), corp };
}

describe("the lease royalty on real sales (AB#2285)", () => {
  it("a sale to a standing buyer at 3 leases is taxed 10%, and 2 of those points are booked as lease-royalty", async () => {
    const { api, corp } = await corporation(3);
    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const before = corp().finances.credits;
    const res = await api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 100 });
    expect(res.status).toBe(200);
    const sold = corp().tradeHistory.find((t) => t.type === "sold-npc");
    expect(sold.taxPct).toBe(10);
    const royalty = Math.round(sold.total * 2 / 100);
    expect(corp().finances.expensesByCategory["lease-royalty"]).toBe(royalty);
    expect(corp().finances.expensesByCategory["exchange-tax"]).toBe(sold.taxAmount - royalty);
    expect(corp().finances.credits - before).toBe(sold.total - sold.taxAmount);
  });

  it("a player-to-player sale by a 3-lease seller is taxed at the same rate, royalty booked the same way", async () => {
    const seller = await corporation(3);
    const buyer = await corporation(1);
    const listed = await seller.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 40, unitPrice: 30 });
    expect(listed.status).toBe(200);
    const orderId = getState().market.orderBook.find((o) => o.sellerAccountId === seller.id)?.id;
    expect((await buyer.api.post(`/api/market/orders/${orderId}/buy`).send({ quantity: 40 })).status).toBe(200);
    const sold = seller.corp().tradeHistory.find((t) => t.type === "sold");
    expect(sold.taxPct).toBe(10);
    expect(sold.total).toBe(1200);
    expect(seller.corp().finances.expensesByCategory["lease-royalty"]).toBe(24);
    expect(seller.corp().finances.expensesByCategory["exchange-tax"]).toBe(96);
  });

  it("a one-lease corporation pays no royalty: 8%, nothing booked under lease-royalty", async () => {
    const { api, corp } = await corporation(1);
    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    expect((await api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 100 })).status).toBe(200);
    expect(corp().tradeHistory.find((t) => t.type === "sold-npc").taxPct).toBe(8);
    expect(corp().finances.expensesByCategory["lease-royalty"] || 0).toBe(0);
  });

  it("the rate and breakdown the Exchange page reads move as soon as a lease is added", async () => {
    const { id, corp } = await corporation(1);
    expect(corp().finances.exchangeSalesTaxPct).toBe(8);
    expect(corp().finances.exchangeTaxBreakdown).toMatchObject({ leasesHeld: 1, royaltyPct: 0, salesTaxPct: 8, ratePct: 8 });
    mutateAccountState(id, (state) => { state.corp.miningLeases.push({ id: "lease-r-new", body: "Earth" }); });
    expect(corp().finances.exchangeSalesTaxPct).toBe(9);
    expect(corp().finances.exchangeTaxBreakdown).toMatchObject({ leasesHeld: 2, royaltyPct: 1, salesTaxPct: 8, ratePct: 9 });
  });
});
