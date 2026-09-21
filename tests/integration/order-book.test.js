import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getState, mutateState } from "../../server/gameState.js";

// Bug #425: listing on the exchange put the order at the front of the one shared book and cut the book to 200, so
// past 200 orders each new listing deleted the oldest one, goods and all. The book is never cut now; a seller may
// have 50 open listings and can cancel one; what clients receive is capped when it is read.
const STATION = "earth-station-prime";

async function seller(silicates = 1000) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = STATION;
    state.corp.inventory = { [STATION]: { Silicates: silicates } };
  });
  const api = authed(app, accessToken);
  return {
    id: account.id, token: accessToken, api,
    list: (body) => api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 1, unitPrice: 10, ...body }),
    stock: () => getAccountById(account.id).state.corp.inventory?.[STATION]?.Silicates ?? 0,
    listed: () => getState().market.orderBook.filter((o) => o.sellerAccountId === account.id).reduce((n, o) => n + o.quantity, 0)
  };
}

describe("the order book loses nothing (Bug #425)", () => {
  it("keeps every order past 200, and every seller's goods are either in stock or listed", async () => {
    mutateState((draft) => { draft.market.orderBook = []; });
    const sellers = await Promise.all([1, 2, 3, 4, 5].map(() => seller(1000)));
    const first = await sellers[0].list({ quantity: 7 });
    expect(first.status).toBe(200);
    for (const s of sellers) {
      for (let i = 0; i < 41; i++) expect((await s.list({ quantity: 3 })).status).toBe(200);
    }
    const book = getState().market.orderBook;
    expect(book.length).toBe(206);
    expect(book.some((o) => o.id === first.body.order.id)).toBe(true);
    for (const s of sellers) expect(s.stock() + s.listed()).toBe(1000);
  });

  it("gives every order a distinct id", async () => {
    const ids = getState().market.orderBook.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^ord-[0-9a-f-]{36}$/);
  });
});

describe("a seller may have 50 open listings (Bug #425)", () => {
  it("refuses the 51st before taking any goods", async () => {
    const s = await seller(1000);
    for (let i = 0; i < 50; i++) expect((await s.list({ quantity: 1 })).status).toBe(200);
    const res = await s.list({ quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("You have 50 open listings; cancel one to list more.");
    expect(s.stock()).toBe(950);
  });
});

describe("POST /api/market/orders/:orderId/cancel (Bug #425)", () => {
  it("returns the unsold goods to the station they were listed from and removes the order", async () => {
    const s = await seller(100);
    const order = (await s.list({ quantity: 40 })).body.order;
    mutateAccountState(s.id, (state) => { state.corp.currentStationId = "luna-gateway"; });
    const res = await s.api.post(`/api/market/orders/${order.id}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(s.stock()).toBe(100);
    expect(getState().market.orderBook.some((o) => o.id === order.id)).toBe(false);
  });

  it("answers 404 to anyone but the seller and leaves the order alone", async () => {
    const owner = await seller(100);
    const other = await seller(0);
    const order = (await owner.list({ quantity: 10 })).body.order;
    expect((await other.api.post(`/api/market/orders/${order.id}/cancel`).send({})).status).toBe(404);
    const { app } = await getApp();
    expect((await request(app).post(`/api/market/orders/${order.id}/cancel`).send({})).status).toBe(401);
    expect(getState().market.orderBook.some((o) => o.id === order.id)).toBe(true);
    expect(owner.stock()).toBe(90);
  });
});

describe("hostile quantities and prices are refused before anything changes (Bug #425)", () => {
  const HOSTILE = ["abc", "NaN", "Infinity", -5, 0, null];

  for (const value of HOSTILE) {
    it(`player sell order refuses quantity ${JSON.stringify(value)} and price ${JSON.stringify(value)}`, async () => {
      const s = await seller(100);
      const before = getState().market.orderBook.length;
      expect((await s.list({ quantity: value })).status).toBe(400);
      expect((await s.list({ unitPrice: value })).status).toBe(400);
      expect(s.stock()).toBe(100);
      expect(getState().market.orderBook.length).toBe(before);
    });

    it(`NPC sell refuses quantity ${JSON.stringify(value)}`, async () => {
      const s = await seller(100);
      const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
      const res = await s.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: value });
      expect(res.status).toBe(400);
      expect(s.stock()).toBe(100);
    });
  }

  it("refuses a fractional quantity or price on both paths, and nothing moves (AB#731)", async () => {
    const s = await seller(100);
    expect((await s.list({ quantity: 2.5, unitPrice: 10 })).status).toBe(400);
    expect((await s.list({ quantity: 2, unitPrice: 10.9 })).status).toBe(400);
    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    expect((await s.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 3.7 })).status).toBe(400);
    expect(s.stock()).toBe(100);
  });
});

describe("what clients receive is capped when read, and always includes the caller's own orders (Bug #425)", () => {
  let url, server;
  const sockets = [];
  beforeAll(async () => {
    ({ server } = await getApp());
    url = await serverUrl();
  });
  afterAll(async () => {
    for (const s of sockets) s.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function crowdedBook() {
    mutateState((draft) => { draft.market.orderBook = []; });
    const mine = await seller(100);
    const oldest = (await mine.list({ quantity: 5 })).body.order;
    const others = await Promise.all([1, 2, 3, 4, 5].map(() => seller(1000)));
    for (const s of others) for (let i = 0; i < 45; i++) await s.list({ quantity: 1 });
    expect(getState().market.orderBook.length).toBe(226);
    return { mine, oldest };
  }

  it("GET /api/bootstrap sends the newest 200, plus the caller's own older orders when signed in", async () => {
    const { mine, oldest } = await crowdedBook();
    const { app } = await getApp();
    const anon = await request(app).get("/api/bootstrap");
    expect(anon.body.market.orderBook).toHaveLength(200);
    expect(anon.body.market.orderBook.some((o) => o.id === oldest.id)).toBe(false);
    const signedIn = await request(app).get("/api/bootstrap").set("Authorization", `Bearer ${mine.token}`);
    expect(signedIn.body.market.orderBook).toHaveLength(201);
    expect(signedIn.body.market.orderBook.some((o) => o.id === oldest.id)).toBe(true);
  });

  it("market:updated carries each socket's own orders", async () => {
    const { mine, oldest } = await crowdedBook();
    const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token: mine.token } });
    sockets.push(s);
    await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    const got = new Promise((resolve) => s.once("market:updated", resolve));
    await (await seller(10)).list({ quantity: 1 });
    const market = await got;
    expect(market.orderBook.length).toBe(201);
    expect(market.orderBook.some((o) => o.id === oldest.id)).toBe(true);
  });
});
