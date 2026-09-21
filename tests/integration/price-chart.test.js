import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getState } from "../../server/gameState.js";
import { shapePriceHistory } from "../../public/scripts/priceChart.js";

// AB#716: the chart's last close is the most recent trade price, checked against what the history route (AB#715)
// actually serves after real trades.
async function corpWith(stock) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "earth-station-prime": { ...stock } };
    state.corp.finances.credits = 1_000_000;
  });
  return { id: account.id, api: authed(app, accessToken) };
}

describe("the price chart against the history route (AB#716)", () => {
  it("ends on the price of the most recent trade, after trades at different prices", async () => {
    const seller = await corpWith({ Silicates: 500 });
    const buyer = await corpWith({});
    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const chartNow = async () => shapePriceHistory((await seller.api.get("/api/market/history/Silicates")).body.buckets, 7);

    expect((await seller.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 100 })).status).toBe(200);
    expect((await chartNow()).lastClose).toBe(npc.unitPrice);

    // A player sale at a different price becomes the last close.
    expect((await seller.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 50, unitPrice: 31 })).status).toBe(200);
    const order = getState().market.orderBook.find((o) => o.sellerAccountId === seller.id && o.item === "Silicates");
    expect((await buyer.api.post(`/api/market/orders/${order.id}/buy`).send({ quantity: 20 })).status).toBe(200);
    const afterPlayer = await chartNow();
    expect(afterPlayer.lastClose).toBe(31);
    expect(afterPlayer.closes.at(-1)).toBe(31);
    expect(afterPlayer.high).toBeGreaterThanOrEqual(31);

    // And another NPC sale moves it back.
    expect((await seller.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 10 })).status).toBe(200);
    const last = await chartNow();
    expect(last.lastClose).toBe(npc.unitPrice);
    expect(last.closes.at(-1)).toBe(npc.unitPrice);
    expect(last.trades).toBeGreaterThanOrEqual(3);
  });

  it("has nothing to draw for an item nobody has traded", async () => {
    const { api } = await corpWith({});
    const res = await api.get("/api/market/history/Thorium");
    expect(res.status).toBe(200);
    expect(shapePriceHistory(res.body.buckets, 7)).toMatchObject({ hasAny: false, lastClose: null });
  });
});
