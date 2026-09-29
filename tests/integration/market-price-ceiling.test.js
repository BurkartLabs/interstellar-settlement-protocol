import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState, mutateState } from "../../server/gameState.js";
import { ECONOMY, priceCeilingFor } from "../../server/economy.js";

// Bug #4797: a listing or a buy order took any price up to 1,000,000,000 a unit, so one unit of Silicates listed at
// 250,000 by account A and bought by account B moved 250,000 less tax between them, booked as A's exchange revenue,
// dominance and standing. The line is now a multiple of the item's catalog standing-bid price (economy.json
// exchange.maxPriceMultipleOfBid).
const ITEM = "Silicates";
const base = ECONOMY.npcBuyers.find((b) => b.item === ITEM).unitPrice;
const CEILING = priceCeilingFor(ITEM);

async function corp(app, { stock = 0, credits = 1_000_000 } = {}) {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.currentStationId = "earth-station-prime";
    s.corp.inventory = { "earth-station-prime": { [ITEM]: stock } };
    s.corp.finances.credits = credits;
  });
  return { id: account.id, api: authed(app, accessToken) };
}
const credits = (id) => Number(getAccountById(id).state.corp.finances.credits);
const held = (id) => Number(getAccountById(id).state.corp.inventory?.["earth-station-prime"]?.[ITEM] || 0);

describe("a market price is bounded by the item's value (Bug #4797)", () => {
  it("the line is the multiple of the catalog standing bid, and it is well above the bid", () => {
    expect(CEILING).toBe(Math.floor(base * ECONOMY.exchange.maxPriceMultipleOfBid));
    expect(CEILING).toBeGreaterThan(base);
  });

  it("refuses a listing over the line, and no goods leave the seller", async () => {
    const { app } = await getApp();
    const a = await corp(app, { stock: 10 });
    const res = await a.api.post("/api/market/orders").send({ type: "sell", item: ITEM, quantity: 1, unitPrice: 250_000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("price-above-ceiling");
    expect(res.body.error).toContain(CEILING.toLocaleString("en-US"));
    expect(held(a.id)).toBe(10);
    expect((getState().market.orderBook || []).some((o) => o.sellerAccountId === a.id)).toBe(false);
  });

  it("refuses a buy order over the line, and no credits are held", async () => {
    const { app } = await getApp();
    const b = await corp(app);
    const res = await b.api.post("/api/market/orders").send({ type: "buy", item: ITEM, quantity: 1, unitPrice: CEILING + 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("price-above-ceiling");
    expect(credits(b.id)).toBe(1_000_000);
  });

  it("lists and sells at the line itself, as any trade near the item's value does", async () => {
    const { app } = await getApp();
    const a = await corp(app, { stock: 10, credits: 0 });
    const b = await corp(app);
    const listed = await a.api.post("/api/market/orders").send({ type: "sell", item: ITEM, quantity: 2, unitPrice: CEILING });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const orderId = listed.body.order?.id ?? getState().market.orderBook.find((o) => o.sellerAccountId === a.id).id;
    const bought = await b.api.post(`/api/market/orders/${orderId}/buy`).send({ quantity: 2 });
    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    expect(held(b.id)).toBe(2);
    expect(credits(a.id)).toBeGreaterThan(0);
    // and a price at the bid, the ordinary case, lists too
    expect((await a.api.post("/api/market/orders").send({ type: "sell", item: ITEM, quantity: 1, unitPrice: base })).status).toBe(200);
  });

  it("will not sell a listing placed over the line before it existed", async () => {
    const { app } = await getApp();
    const a = await corp(app, { credits: 0 });
    const b = await corp(app);
    const id = `ord-old-${Date.now()}`;
    mutateState((d) => {
      d.market.orderBook.unshift({ id, type: "sell", item: ITEM, quantity: 1, unitPrice: 250_000, seller: "Old Listing Co", sellerAccountId: a.id, stationId: "earth-station-prime", createdAt: Date.now() - 86_400_000 });
    });
    const res = await b.api.post(`/api/market/orders/${id}/buy`).send({ quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("price-above-ceiling");
    expect(credits(b.id)).toBe(1_000_000);
    expect(credits(a.id)).toBe(0);
  });
});
