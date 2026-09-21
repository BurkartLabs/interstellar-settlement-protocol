import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, mutateState, getAccountById, getState, normalizeGlobalState } from "../../server/gameState.js";
import { dayKey, historyFor } from "../../server/priceHistory.js";

// AB#715: both trade paths feed the per-item daily history, it is part of the saved state, and the read route serves
// prices and volumes for catalog items only.
async function corpWith(stock) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "earth-station-prime": { ...stock } };
    state.corp.finances.credits = 1_000_000;
  });
  return { app, id: account.id, api: authed(app, accessToken), name: getAccountById(account.id).state.corp.corporationName };
}
const today = () => getState().market.priceHistory;
const todays = (item) => (today()[item] || []).find((b) => b.day === dayKey(Date.now()));

describe("price history from settled trades (AB#715)", () => {
  it("records one player trade and one NPC sale, and serves both back", async () => {
    const seller = await corpWith({ Aerogel: 40 });
    const buyer = await corpWith({});
    const npcSeller = await corpWith({ Silicates: 500 });
    const before = { aerogel: todays("Aerogel")?.volume || 0, silicates: todays("Silicates")?.volume || 0 };

    // A player lists through the real listing route and another buys through the real buy route.
    const listed = await seller.api.post("/api/market/orders").send({ type: "sell", item: "Aerogel", quantity: 40, unitPrice: 310 });
    expect(listed.status).toBe(200);
    const order = getState().market.orderBook.find((o) => o.sellerAccountId === seller.id && o.item === "Aerogel");
    expect((await buyer.api.post(`/api/market/orders/${order.id}/buy`).send({ quantity: 15 })).status).toBe(200);

    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    expect((await npcSeller.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 200 })).status).toBe(200);

    expect(todays("Aerogel")).toMatchObject({ close: 310, volume: before.aerogel + 15 });
    expect(todays("Silicates")).toMatchObject({ close: npc.unitPrice, volume: before.silicates + 200 });

    const res = await request(seller.app).get("/api/market/history/Aerogel");
    expect(res.status).toBe(200);
    expect(res.body.item).toBe("Aerogel");
    expect(res.body.buckets.at(-1)).toMatchObject({ day: dayKey(Date.now()), close: 310 });
    const multiWord = await request(seller.app).get(`/api/market/history/${encodeURIComponent("Rare Earths")}`);
    expect(multiWord.status).toBe(200);

    // Prices and volumes only: nobody who traded appears anywhere in the response.
    const silicates = await request(seller.app).get("/api/market/history/Silicates");
    const text = JSON.stringify([res.body, silicates.body]);
    const who = [seller.id, buyer.id, npcSeller.id, seller.name, buyer.name, npcSeller.name, npc.buyer];
    expect(who.every(Boolean)).toBe(true);
    for (const w of who) expect(text).not.toContain(w);
    expect(Object.keys(res.body.buckets[0]).sort()).toEqual(["close", "day", "high", "low", "open", "trades", "volume"]);
  });

  it("serves only the price fields even if a bucket in state carries something else", async () => {
    const seller = await corpWith({ Silicates: 10 });
    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    expect((await seller.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 10 })).status).toBe(200);
    mutateState((draft) => { draft.market.priceHistory.Silicates.at(-1).lastSeller = seller.name; });
    const res = await request(seller.app).get("/api/market/history/Silicates");
    expect(JSON.stringify(res.body)).not.toContain(seller.name);
    for (const b of res.body.buckets) expect(Object.keys(b).sort()).toEqual(["close", "day", "high", "low", "open", "trades", "volume"]);
  });

  it("refuses an item not in the catalog, and never repeats it back", async () => {
    const { app } = await getApp();
    for (const input of ["Unobtainium", "<script>alert(1)</script>", "__proto__", "constructor", "silicates", "..%2F..%2Fdata%2Fstate"]) {
      const res = await request(app).get(`/api/market/history/${encodeURIComponent(input)}`);
      expect(res.status, input).toBe(400);
      expect(JSON.stringify(res.body), input).not.toContain(input);
      expect(res.body).toEqual({ error: "Unknown item." });
    }
  });

  // The server writes getState() to data/state.json as JSON and loads it back through normalizeGlobalState; this is
  // that round trip, without a disk (tests run serverless, Bug #588).
  it("survives a restart: the saved state loads back with its history", async () => {
    const seller = await corpWith({ Silicates: 50 });
    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    expect((await seller.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 50 })).status).toBe(200);
    const saved = JSON.parse(JSON.stringify(getState()));
    const reloaded = normalizeGlobalState(saved);
    expect(reloaded.market.priceHistory.Silicates).toEqual(historyFor(getState().market.priceHistory, "Silicates"));
    expect(reloaded.market.priceHistory.Silicates.length).toBeGreaterThan(0);
  });
});
