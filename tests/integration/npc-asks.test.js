import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState, mutateState, normalizeGlobalState } from "../../server/gameState.js";
import { NPC_CATALOG } from "../../server/npcCorporations.js";
import { ECONOMY } from "../../server/economy.js";
import { npcAskSpecs, placeNpcAsks } from "../../server/game/npcAsks.js";
import * as ticks from "../../server/ticks.js";

// ISP-122 (AB#815): the NPC corporations' asks (docs/design/npc-corporations.md), placed and refreshed by the server's
// tick, kept apart from player listings (AB#425: a global cap once deleted the oldest listings, goods and all), and
// bought through the same route as a player's listing.
const EARTH = "earth-station-prime";
const asks = () => (getState().market.orderBook || []).filter((o) => o.npc === true);
const playerListings = () => (getState().market.orderBook || []).filter((o) => o.npc !== true);
/** The daily refresh, as the tick runs it when the date turns. */
const refresh = () => { mutateState((d) => { d.market.npcAsksRefilledOn = "a day ago"; }); ticks.checkAndResetNpcBuyOrders(); };

async function buyer(credits = 1_000_000) {
  const { app } = await getApp();
  const me = await registerAccount(app);
  mutateAccountState(me.account.id, (s) => { s.corp.finances.credits = credits; s.corp.currentStationId = EARTH; s.corp.inventory = { [EARTH]: {} }; }, { sanitize: false, settleMining: false });
  return { id: me.account.id, api: authed(app, me.accessToken), corp: () => getAccountById(me.account.id).state.corp };
}

beforeEach(() => mutateState((d) => { d.market.orderBook = []; d.market.buyOrders = []; }));

describe("NPC sell orders (AB#815)", () => {
  it("after a refresh, each NPC corporation has the asks the design specifies", () => {
    refresh();
    const byId = new Map(asks().map((o) => [o.id, o]));
    const expected = NPC_CATALOG.corporations.flatMap((c) => c.trades.map((item) => ({ c, item })));
    expect(byId.size).toBe(expected.length);
    for (const { c, item } of expected) {
      const ask = [...byId.values()].find((o) => o.item === item);
      const base = ECONOMY.npcBuyers.find((b) => b.item === item).unitPrice;
      const qty = ECONOMY.npcAsks.dailyQty.find((d) => d.item === item).qty;
      expect(ask, item).toMatchObject({ type: "sell", npc: true, seller: c.name, npcCorporationId: c.id, stationId: c.homeStationId, unitPrice: Math.round(base * 1.5), quantity: qty });
      expect(ask.sellerAccountId, item).toBeUndefined();
    }
    expect(byId.get("npc-sell-silicates")).toMatchObject({ seller: "Meridian Glassworks", unitPrice: 36, quantity: 3000 });
  });

  it("a player buys from one through the listing route: charged the ask, goods at their station, a Bought row, the ask drawn down", async () => {
    refresh();
    const me = await buyer();
    const res = await me.api.post("/api/market/orders/npc-sell-silicates/buy").send({ quantity: 500 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The buyer pays the price, as from a player's listing; the exchange tax is levied on sellers, and an NPC has no
    // account to tax, so no one is paid for the sale.
    expect(1_000_000 - me.corp().finances.credits).toBe(500 * 36);
    expect(res.body.receipt).toMatchObject({ action: "buy", costCredits: 500 * 36 });
    expect(me.corp().inventory[EARTH].Silicates).toBe(500);
    expect(me.corp().tradeHistory[0]).toMatchObject({ type: "bought", item: "Silicates", quantity: 500, unitPrice: 36, counterparty: "Meridian Glassworks" });
    expect(asks().find((o) => o.id === "npc-sell-silicates").quantity).toBe(2500);
  });

  it("sold out, an ask stays in the book at zero until the next day's refill", async () => {
    refresh();
    const me = await buyer();
    expect((await me.api.post("/api/market/orders/npc-sell-titanium/buy").send({ quantity: 80 })).status).toBe(200);
    expect(asks().find((o) => o.id === "npc-sell-titanium").quantity).toBe(0);
    expect((await me.api.post("/api/market/orders/npc-sell-titanium/buy").send({ quantity: 1 })).status).toBe(400);
    refresh();
    expect(asks().find((o) => o.id === "npc-sell-titanium").quantity).toBe(80);
  });

  it("with 200 player listings present, a refresh leaves every listing, its goods and its place intact", async () => {
    const now = Date.now();
    mutateState((d) => {
      for (let i = 0; i < 200; i += 1) {
        d.market.orderBook.unshift({ id: `ord-p${i}`, type: "sell", item: "Silicates", quantity: 10 + i, unitPrice: 20 + (i % 9), seller: `Player ${i}`, sellerAccountId: `acc-${i}`, stationId: EARTH, createdAt: now - i });
      }
    });
    const before = JSON.stringify(playerListings());
    refresh();
    refresh();
    expect(JSON.stringify(playerListings())).toBe(before);
    expect(asks()).toHaveLength(npcAskSpecs().length);

    // And what a client sees: all 200 players' listings plus the NPC asks, the asks outside the 200-order cap.
    const me = await buyer();
    const view = (await me.api.get("/api/bootstrap")).body.market.orderBook;
    expect(view.filter((o) => !o.npc)).toHaveLength(200);
    expect(view.filter((o) => o.npc)).toHaveLength(npcAskSpecs().length);
    mutateState((d) => { d.market.orderBook.unshift({ id: "ord-p200", type: "sell", item: "Carbon", quantity: 5, unitPrice: 10, seller: "Player 200", sellerAccountId: "acc-200", stationId: EARTH, createdAt: now + 1 }); });
    const capped = (await me.api.get("/api/bootstrap")).body.market.orderBook;
    expect(capped.filter((o) => !o.npc)).toHaveLength(200); // the cap counts player listings only
    expect(capped.filter((o) => o.npc)).toHaveLength(npcAskSpecs().length);
  });

  it("no route creates, edits or cancels an NPC order", async () => {
    refresh();
    const me = await buyer();
    mutateAccountState(me.id, (s) => { s.corp.inventory[EARTH].Silicates = 100; }, { sanitize: false, settleMining: false });
    for (const body of [
      { type: "sell", item: "Silicates", quantity: 10, unitPrice: 30, npc: true },
      { type: "sell", item: "Silicates", quantity: 10, unitPrice: 30, npc: false },
      { type: "buy", item: "Silicates", quantity: 10, unitPrice: 30, npc: true }
    ]) {
      const res = await me.api.post("/api/market/orders").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe("NPC orders are placed by the exchange, not by corporations.");
    }
    expect(playerListings()).toEqual([]);
    expect((await me.api.post("/api/market/orders/npc-sell-silicates/cancel").send({})).status).toBe(404);
    expect(asks().find((o) => o.id === "npc-sell-silicates").quantity).toBe(3000);
  });

  it("a player's buy order never fills against an NPC ask: the NPC takes no side of a player's order", async () => {
    refresh();
    const me = await buyer();
    const res = await me.api.post("/api/market/orders").send({ type: "buy", item: "Silicates", quantity: 100, unitPrice: 100 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fills).toEqual([]);
    expect(asks().find((o) => o.id === "npc-sell-silicates").quantity).toBe(3000);
  });

  it("survives a restart without duplicating or refilling: placing again and normalizing again change nothing", async () => {
    refresh();
    const me = await buyer();
    await me.api.post("/api/market/orders/npc-sell-carbon/buy").send({ quantity: 150 });
    const before = JSON.stringify(asks());
    mutateState((d) => { placeNpcAsks(d.market); placeNpcAsks(d.market); });
    expect(JSON.stringify(asks())).toBe(before);
    const restarted = normalizeGlobalState(JSON.parse(JSON.stringify(getState()))); // a save read back at start
    const again = normalizeGlobalState(JSON.parse(JSON.stringify(restarted)));
    const npcOf = (s) => s.market.orderBook.filter((o) => o.npc === true);
    expect(npcOf(restarted)).toHaveLength(npcAskSpecs().length);
    expect(JSON.stringify(npcOf(again))).toBe(JSON.stringify(npcOf(restarted)));
    expect(npcOf(restarted).find((o) => o.id === "npc-sell-carbon").quantity).toBe(250); // not topped up by a restart
  });
});
