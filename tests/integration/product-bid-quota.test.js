import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { ECONOMY, npcBidFor } from "../../server/economy.js";
import { bidQuotaFor, ensureBidShape, freshGlobalState, normalizeGlobalState, mutateAccountState, mutateState, getState } from "../../server/gameState.js";

// AB#2365: every standing bid drifted on the world's 7,000 quota, so a product sold at a Refinery's rate (Fusion
// Pellets: 160 a day) barely moved its bid, and tier3-recipes.md section 4's "product glut" could not happen in play.
// Each order now drifts on its own item's quota: a product's npcBuyers dailyQty, a raw item's 7,000.
const order = (item) => getState().market.npcBuyOrders.find((o) => o.item === item);
const orderId = (item) => `npc-buy-${item.toLowerCase().replace(/\s+/g, "-")}-daily`;

async function sellerOf(item, units) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.currentStationId = "earth-station-prime";
    s.corp.inventory = { "earth-station-prime": { [item]: units } };
  });
  const sell = (quantity) => request(app).post(`/api/market/npc-orders/${orderId(item)}/sell`).set("Authorization", `Bearer ${accessToken}`).send({ quantity });
  return { sell };
}
/** Today's order for an item, as if nobody had sold into it. */
const fresh = (item) => mutateState((d) => {
  const o = d.market.npcBuyOrders.find((x) => x.item === item);
  Object.assign(o, { soldToday: 0, remainingQty: o.totalQtyPerDay, unitPrice: o.basePrice });
});

describe("each standing bid drifts on its own item's quota (AB#2365)", () => {
  it("gives a product its npcBuyers dailyQty and a raw item the world's 7,000", () => {
    const seeds = Object.fromEntries(ECONOMY.npcBuyers.map((b) => [b.item, b.dailyQty]));
    expect(seeds["Silicates"]).toBeGreaterThan(ECONOMY.npcBid.quotaPerDay); // the old fixed bid's volume
    expect(bidQuotaFor("Silicates")).toBe(ECONOMY.npcBid.quotaPerDay);
    expect(bidQuotaFor("Fusion Pellets")).toBe(seeds["Fusion Pellets"]);
    expect(bidQuotaFor("Ion Thrusters")).toBe(seeds["Ion Thrusters"]);
    expect(bidQuotaFor("No Such Item")).toBe(ECONOMY.npcBid.quotaPerDay);
    const orders = freshGlobalState().market.npcBuyOrders;
    for (const o of orders) expect([o.item, o.totalQtyPerDay, o.remainingQty]).toEqual([o.item, bidQuotaFor(o.item), bidQuotaFor(o.item)]);
    expect(orders.find((o) => o.item === "Ion Thrusters").totalQtyPerDay).toBe(12); // the Bug's repro printed 7000
  });

  it("a product's bid falls across its own quota: half of Fusion Pellets' day moves it as half the world's quota moves Silicates", async () => {
    await getApp();
    const quota = bidQuotaFor("Fusion Pellets");
    fresh("Fusion Pellets");
    const s = await sellerOf("Fusion Pellets", quota);
    const first = await s.sell(quota / 2);
    expect(first.status, JSON.stringify(first.body.error)).toBe(200);
    const base = order("Fusion Pellets").basePrice;
    const expected = npcBidFor(base, quota / 2, { ...ECONOMY.npcBid, quotaPerDay: quota });
    expect(expected).toBeLessThan(base);
    expect(order("Fusion Pellets").unitPrice).toBe(expected);
    const second = await s.sell(quota / 2);
    expect(second.body.traded.unitPrice).toBe(expected);
    // the day's quota is the product's, so the order is full
    expect(order("Fusion Pellets").remainingQty).toBe(0);
    expect((await s.sell(1)).status).toBe(400);
  });

  it("a raw item's bid is unchanged: 7,000 still takes it from base to its lowest", async () => {
    await getApp();
    fresh("Silicates");
    const s = await sellerOf("Silicates", 3500);
    expect((await s.sell(3500)).status).toBe(200);
    expect(order("Silicates").unitPrice).toBe(npcBidFor(24, 3500, ECONOMY.npcBid));
    expect(order("Silicates").remainingQty).toBe(3500);
  });

  it("an order saved with the world's 7,000 moves to its own quota and keeps what was sold today", () => {
    const quota = bidQuotaFor("Aerogel");
    const saved = { id: "npc-buy-aerogel-daily", item: "Aerogel", buyer: "Meridian Glassworks", basePrice: 41, unitPrice: 41, soldToday: 100, totalQtyPerDay: 7000, remainingQty: 6900 };
    ensureBidShape(saved);
    expect(saved.totalQtyPerDay).toBe(quota);
    expect(saved.remainingQty).toBe(quota - 100);
    expect(saved.unitPrice).toBe(npcBidFor(41, 100, { ...ECONOMY.npcBid, quotaPerDay: quota }));
    // a whole state loaded from disk is reshaped on load, not at its next sale
    const state = freshGlobalState();
    for (const o of state.market.npcBuyOrders) o.totalQtyPerDay = o.remainingQty = 7000;
    const loaded = normalizeGlobalState(state);
    expect(loaded.market.npcBuyOrders.find((o) => o.item === "Ion Thrusters")).toMatchObject({ totalQtyPerDay: 12, remainingQty: 12 });
  });
});
