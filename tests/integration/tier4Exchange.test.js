import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getState } from "../../server/gameState.js";
import { ECONOMY } from "../../server/economy.js";
import { ITEMS } from "../../server/game/items.js";
import { NO_NPC_BUYER, bidQuotaFor } from "../../server/game/world.js";
import { dayKey } from "../../server/priceHistory.js";
import { marketView } from "../../server/marketView.js";

// ISP-190 (AB#884): the final five and the Tier 4 products on the Galactic Exchange: a standing bid at the design's
// base and quota for each (docs/design/v0.11-tier4.md section 3), listed, bought and sold between players through the
// same routes and checks as every other item, and charted once traded.
const DOC = readFileSync(new URL("../../docs/design/v0.11-tier4.md", import.meta.url), "utf8");
const bidTable = DOC.split("### NPC bids")[1].split("### The engine")[0];
const DESIGNED = bidTable.split("\n").filter((l) => /^\| [A-Z]/.test(l) && !l.startsWith("| Item")).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
  .map(([item, , , base, floor, quota]) => ({ item, base: Number(base), floor: Number(floor), quota: Number(quota.replace(/raw: |,/g, "")) }));
const TIER4 = ITEMS.filter((i) => i.tier === 4).map((i) => i.name);
const EARTH = "earth-station-prime";

async function corpWith(stock, credits = 1_000_000) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = EARTH;
    state.corp.inventory = { [EARTH]: { ...stock } };
    state.corp.finances.credits = credits;
  });
  return { id: account.id, api: authed(app, accessToken), held: () => ({ ...(getAccountById(account.id).state.corp.inventory?.[EARTH] || {}) }), credits: () => getAccountById(account.id).state.corp.finances.credits };
}

describe("ISP-190 every catalog item has a standing bid, or is named as having none", () => {
  it("loops the catalog: each item is in one of the two, never both", () => {
    const bid = new Set(ECONOMY.npcBuyers.map((b) => b.item));
    for (const { name } of ITEMS) expect(bid.has(name) !== NO_NPC_BUYER.includes(name), name).toBe(true);
  });

  it("each Tier 4 bid is the design's: its base, a floor at 55% of it, and its daily quantity", () => {
    expect(DESIGNED.map((d) => d.item).sort()).toEqual([...TIER4].sort());
    for (const d of DESIGNED) {
      const seed = ECONOMY.npcBuyers.find((b) => b.item === d.item);
      expect(seed?.unitPrice, d.item).toBe(d.base);
      expect(Math.round(seed.unitPrice * ECONOMY.npcBid.floorPct / 100), d.item).toBe(d.floor);
      expect(bidQuotaFor(d.item), d.item).toBe(d.quota);
      const order = getState().market.npcBuyOrders.find((o) => o.item === d.item);
      expect(order, `${d.item} standing order in the world`).toMatchObject({ basePrice: d.base, totalQtyPerDay: d.quota });
    }
  });

  it("the market a client receives carries each item's tier, for the Tier filter", () => {
    const view = marketView(getState().market, null);
    for (const name of TIER4) expect(view.itemTiers[name], name).toBe(4);
    expect(view.itemTiers.Silicates).toBe(1);
    for (const name of TIER4) expect(view.tradeItems, name).toContain(name);
  });
});

describe("ISP-190 each Tier 4 item trades between players and is charted", () => {
  for (const item of ["Uranium", "Exotic Matter", "Platinum-Group Metals", "Metallic Hydrogen", "Antimatter", "Superconducting Coils", "Field Emitters", "Breeder Reactor Cores", "Antimatter Drives", "Catalyst Beds"]) {
    it(`${item}: listed by one corporation, bought by another, sold into its bid, and in the price history`, async () => {
      const seller = await corpWith({ [item]: 10 });
      const buyer = await corpWith({});
      // Bug #4797: at 1.5x the item's bid, what an NPC corporation asks, and under the line of 5x (a flat 5,000 was 22x Uranium's)
      const unitPrice = Math.round(ECONOMY.npcBuyers.find((b) => b.item === item).unitPrice * 1.5);
      const listed = await seller.api.post("/api/market/orders").send({ type: "sell", item, quantity: 6, unitPrice });
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(seller.held()[item]).toBe(4);
      const order = getState().market.orderBook.find((o) => o.sellerAccountId === seller.id && o.item === item);
      const bought = await buyer.api.post(`/api/market/orders/${order.id}/buy`).send({ quantity: 2 });
      expect(bought.status, JSON.stringify(bought.body)).toBe(200);
      expect(buyer.held()[item]).toBe(2);
      const npc = getState().market.npcBuyOrders.find((o) => o.item === item);
      const sold = await buyer.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 1 });
      expect(sold.status, JSON.stringify(sold.body)).toBe(200);
      expect(buyer.held()[item]).toBe(1);
      const history = await buyer.api.get(`/api/market/history/${encodeURIComponent(item)}`);
      expect(history.status).toBe(200);
      expect(history.body.buckets.at(-1)).toMatchObject({ day: dayKey(Date.now()) });
      expect(history.body.buckets.at(-1).volume).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("ISP-190 listing a Tier 4 item goes through the same checks as any other", () => {
  it('a quantity of "abc" is a 400, and nothing is debited', async () => {
    const seller = await corpWith({ Antimatter: 5 });
    const before = { held: seller.held(), credits: seller.credits(), book: getState().market.orderBook.length };
    const res = await seller.api.post("/api/market/orders").send({ type: "sell", item: "Antimatter", quantity: "abc", unitPrice: 5_000 });
    expect(res.status).toBe(400);
    expect(seller.held()).toEqual(before.held);
    expect(seller.credits()).toBe(before.credits);
    expect(getState().market.orderBook.length).toBe(before.book);
  });

  it("more than is held, a fraction or a negative is refused too", async () => {
    const seller = await corpWith({ "Catalyst Beds": 3 });
    for (const quantity of [4, 1.5, -1]) {
      const res = await seller.api.post("/api/market/orders").send({ type: "sell", item: "Catalyst Beds", quantity, unitPrice: 1_000 });
      expect(res.status, String(quantity)).toBe(400);
    }
    expect(seller.held()["Catalyst Beds"]).toBe(3);
  });
});
