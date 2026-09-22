import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getState } from "../../server/gameState.js";

// AB#1164: the Exchange forms now send what the player typed, so the server's refusal is what stands between a
// cleared price field and a listing at $1. These are the values a form field produces when it is cleared or filled with
// spaces, which the existing hostile-input tests (Bug #425, AB#732) did not send. Each is refused and changes nothing.
const STATION = "earth-station-prime";

async function trader() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = STATION;
    state.corp.inventory = { [STATION]: { Silicates: 50 } };
    state.corp.finances.credits = 100000;
  });
  const api = authed(app, accessToken);
  const snapshot = () => JSON.stringify({ corp: getAccountById(account.id).state.corp, book: getState().market.orderBook.filter((o) => o.sellerAccountId === account.id) });
  return { id: account.id, api, snapshot };
}

describe("a cleared Exchange field is refused, not read as 1 (AB#1164)", () => {
  for (const typed of ["", "   "]) {
    it(`Create Listing with unit price ${JSON.stringify(typed)}: 400, nothing listed`, async () => {
      const t = await trader();
      const before = t.snapshot();
      const res = await t.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: "1", unitPrice: typed });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/price/i);
      expect(t.snapshot()).toBe(before);
    });
    it(`Create Listing with quantity ${JSON.stringify(typed)}: 400, nothing listed`, async () => {
      const t = await trader();
      const before = t.snapshot();
      const res = await t.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: typed, unitPrice: "30" });
      expect(res.status).toBe(400);
      expect(t.snapshot()).toBe(before);
    });
    it(`Sell to a standing order with quantity ${JSON.stringify(typed)}: 400, nothing sold`, async () => {
      const t = await trader();
      const before = t.snapshot();
      const res = await t.api.post("/api/market/npc-orders/npc-buy-silicates-daily/sell").send({ quantity: typed });
      expect(res.status).toBe(400);
      expect(t.snapshot()).toBe(before);
    });
  }

  it("Buy with a cleared quantity: 400, nothing bought, and the listing is untouched", async () => {
    const seller = await trader();
    const listed = await seller.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: "3", unitPrice: "30" });
    expect(listed.status).toBe(200);
    const buyer = await trader();
    const before = buyer.snapshot();
    const bookBefore = JSON.stringify(getState().market.orderBook.find((o) => o.id === listed.body.order.id));
    for (const typed of ["", "   "]) {
      const res = await buyer.api.post(`/api/market/orders/${listed.body.order.id}/buy`).send({ quantity: typed });
      expect(res.status).toBe(400);
    }
    expect(buyer.snapshot()).toBe(before);
    expect(JSON.stringify(getState().market.orderBook.find((o) => o.id === listed.body.order.id))).toBe(bookBefore);
  });
});
