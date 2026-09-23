// ISP-87 (AB#777): the bid a seller is paid is worked out on the server from the volume already sold into today's
// quota. A corporation dumping stock moves the price against itself and down to the floor, and never past it, so
// the next corporation to come along is never stranded.

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { ECONOMY, npcBidFor } from "../../server/economy.js";

const SILICATES = "npc-buy-silicates-daily";
const BASE = 24;
const floor = Math.round(BASE * (ECONOMY.npcBid.floorPct / 100));

let app;
beforeAll(async () => {
  ({ app } = await getApp());
});

/** A corporation with silicates at Earth Station Prime, ready to sell. */
async function sellerWith(units) {
  const { account, accessToken } = await registerAccount(app);
  const { mutateAccountState } = await import("../../server/gameState.js");
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    if (!state.corp.inventory || typeof state.corp.inventory !== "object") state.corp.inventory = {};
    state.corp.inventory["earth-station-prime"] = { ...(state.corp.inventory["earth-station-prime"] || {}), Silicates: units };
  });
  return { accountId: account.id, accessToken };
}

const sell = (token, quantity) =>
  request(app).post(`/api/market/npc-orders/${SILICATES}/sell`).set("Authorization", `Bearer ${token}`).send({ quantity });

describe("the standing bid drifts with the day's volume (ISP-87)", () => {
  it("pays less to the second seller than to the first, and says what it paid", async () => {
    const quarter = Math.round(ECONOMY.npcBid.quotaPerDay / 4);
    const first = await sellerWith(quarter);
    const second = await sellerWith(quarter);

    const one = await sell(first.accessToken, quarter);
    expect(one.status).toBe(200);
    const two = await sell(second.accessToken, quarter);
    expect(two.status).toBe(200);

    expect(one.body.traded.unitPrice).toBe(BASE);
    expect(two.body.traded.unitPrice).toBeLessThan(one.body.traded.unitPrice);
    // What the response says it paid is what it paid.
    expect(two.body.traded.total).toBe(two.body.traded.unitPrice * quarter);
  });

  it("a corporation dumping everything it has moves the bid to the floor and no further", async () => {
    const lots = ECONOMY.npcBid.quotaPerDay;
    const dumper = await sellerWith(lots);
    let sold = 0;
    const slice = Math.round(lots / 5);
    for (let i = 0; i < 5; i += 1) {
      const res = await sell(dumper.accessToken, slice);
      if (res.status !== 200) break; // the quota runs out; that is the point of it
      expect(res.body.traded.unitPrice).toBeGreaterThanOrEqual(floor);
      sold += slice;
    }
    expect(sold).toBeGreaterThan(0);

    // Whatever happened, the next corporation is still offered the floor or better.
    const newcomer = await sellerWith(100);
    const after = await sell(newcomer.accessToken, 100);
    if (after.status === 200) {
      expect(after.body.traded.unitPrice).toBeGreaterThanOrEqual(floor);
    } else {
      // The day's quota is spent, which is a limit on the buyer and not a price: tomorrow it refills.
      expect(after.body.error).toMatch(/remaining|filled/i);
    }
  });

  it("the price is the server's, whatever the request asks for", async () => {
    const seller = await sellerWith(1000);
    const res = await request(app)
      .post(`/api/market/npc-orders/${SILICATES}/sell`)
      .set("Authorization", `Bearer ${seller.accessToken}`)
      .send({ quantity: 100, unitPrice: 10_000, price: 10_000, total: 1_000_000 });
    expect(res.status).toBe(200);
    expect(res.body.traded.unitPrice).toBeLessThanOrEqual(BASE);
    expect(res.body.traded.total).toBe(res.body.traded.unitPrice * 100);
  });

  it("the bid the table shows is the bid the next seller is paid", async () => {
    const seller = await sellerWith(2000);
    await sell(seller.accessToken, 2000);
    const bootstrap = await request(app).get("/api/bootstrap");
    const order = bootstrap.body.market.npcBuyOrders.find((o) => o.id === SILICATES);
    expect(order.unitPrice).toBe(npcBidFor(order.basePrice, order.soldToday));
    expect(order.remainingQty).toBe(order.totalQtyPerDay - order.soldToday);
  });
});
