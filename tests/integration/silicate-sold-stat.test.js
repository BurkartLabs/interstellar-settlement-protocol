import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState } from "../../server/gameState.js";

// Bug #4869: "Sell N Silicate" (levels 3, 4 and 10: sell300Silicate, sell50000Silicate, sell100000Silicate) reads
// stat:silicateSoldOnExchange, and the NPC sell route added every good's quantity to it. Only Silicates count.
describe("the Silicate-sold stat counts Silicates only (Bug #4869)", () => {
  it("a sale of Silicates to a standing bid counts; a sale of another good does not", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    const bids = getState().market.npcBuyOrders.filter((o) => o.remainingQty > 0);
    const silicates = bids.find((o) => o.item === "Silicates");
    const other = bids.find((o) => o.item !== "Silicates");
    expect(silicates && other, "the seeded market has a Silicates bid and another").toBeTruthy();
    // a sale to a standing bid draws on the seller's stock where it is docked
    const station = getAccountById(account.id).state.corp.currentStationId;
    mutateAccountState(account.id, (s) => {
      s.corp.inventory = { ...s.corp.inventory, [station]: { ...(s.corp.inventory?.[station] || {}), Silicates: 100, [other.item]: 100 } };
    });
    const stat = () => Number(getAccountById(account.id).state.corp.stats?.silicateSoldOnExchange) || 0;
    const before = stat();

    const first = await api.post(`/api/market/npc-orders/${silicates.id}/sell`).send({ quantity: 50 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(stat()).toBe(before + 50);

    const res = await api.post(`/api/market/npc-orders/${other.id}/sell`).send({ quantity: 20 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(stat(), `a sale of ${other.item} must not count toward "Sell N Silicate"`).toBe(before + 50);
  });
});
