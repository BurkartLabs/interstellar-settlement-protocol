import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getState } from "../../server/gameState.js";

// Bug #1167: when another player bought a listing, the seller was told nothing. Their open page kept the old credits and
// Trade History until a reload, and no notification came. The seller's own sockets now get a notification and
// "market:sold", and nobody else's do. Bug #1325: the buyer is named as the order book names a seller, never by email.
let app, url;
const sockets = [];

beforeAll(async () => {
  ({ app } = await getApp());
  url = await serverUrl();
});
afterAll(() => { for (const s of sockets) s.close(); });

async function player({ corpName } = {}) {
  const { account, accessToken, body } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 100000;
    const station = state.corp.currentStationId || "earth-station-prime";
    state.corp.inventory = { ...(state.corp.inventory || {}), [station]: { Silicates: 500 } };
    if (corpName !== undefined) state.corp.corporationName = corpName;
  });
  return { id: account.id, email: body.email, corpName: corpName ?? body.corpName, token: accessToken, api: authed(app, accessToken) };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
  sockets.push(s);
  const heard = [];
  s.onAny((event, payload) => heard.push({ event, payload }));
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return heard;
}

/** Wait (polling, at most 3 s) until `heard` has an event `name`; then a short settle so a stray event would show up. */
async function waitFor(heard, name) {
  for (let i = 0; i < 60 && !heard.some((x) => x.event === name); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 150));
  return heard.filter((x) => x.event === name);
}

const saleNotices = (heard) => heard.filter((x) => x.event === "notifications:new" && x.payload?.notification?.title === "Listing Sold");
const lastSold = (id) => getAccountById(id).state.corp.tradeHistory.find((t) => t.type === "sold");

describe("the seller is told of a sale, and only the seller (Bug #1167)", () => {
  let a, b, orderId;
  const heardBy = {};

  beforeAll(async () => {
    a = await player();
    b = await player();
    heardBy.A = await socket(a.token);
    heardBy.B = await socket(b.token);
    heardBy.anonymous = await socket();
    const listed = await a.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 4, unitPrice: 30 });
    expect(listed.status).toBe(200);
    orderId = listed.body.order.id;
  });

  it("a partial fill (2 of 4): A's sockets get the notification and market:sold; B's and an anonymous one get neither", async () => {
    const creditsBefore = getAccountById(a.id).state.corp.finances.credits;
    const bought = await b.api.post(`/api/market/orders/${orderId}/buy`).send({ quantity: 2 });
    expect(bought.status).toBe(200);

    const sold = await waitFor(heardBy.A, "market:sold");
    expect(sold.map((x) => x.payload)).toEqual([{ accountId: a.id }]);
    const [notice] = saleNotices(heardBy.A);
    expect(notice.payload.accountId).toBe(a.id);
    const row = lastSold(a.id);
    // What the seller is told is what their Sold row says: item, quantity, price, total, tax and proceeds, and the buyer.
    expect(row).toMatchObject({ item: "Silicates", quantity: 2, unitPrice: 30, total: 60, counterparty: b.corpName });
    expect(getAccountById(a.id).state.corp.finances.credits).toBe(creditsBefore + row.proceeds);
    expect(notice.payload.notification).toMatchObject({ type: "market", title: "Listing Sold" });
    expect(notice.payload.notification.body).toBe(
      `${b.corpName} bought 2 Silicates at 30 credits each: 60 credits, less ${row.taxAmount} credits exchange tax (${row.taxPct}%), ` +
        `${row.proceeds} credits paid to you. 2 still listed.`
    );
    // Nothing of the buyer's but the name: no account id, email or station.
    const text = JSON.stringify(notice.payload);
    for (const secret of [b.id, b.email, getAccountById(b.id).state.corp.currentStationId]) expect(text).not.toContain(secret);

    for (const who of ["B", "anonymous"]) {
      expect(heardBy[who].filter((x) => x.event === "market:sold"), who).toEqual([]);
      expect(saleNotices(heardBy[who]), who).toEqual([]);
    }
  });

  it("a full fill (the other 2) removes the listing and says it is sold out", async () => {
    const before = saleNotices(heardBy.A).length;
    const bought = await b.api.post(`/api/market/orders/${orderId}/buy`).send({ quantity: 2 });
    expect(bought.status).toBe(200);
    for (let i = 0; i < 60 && saleNotices(heardBy.A).length === before; i++) await new Promise((r) => setTimeout(r, 50));
    const notices = saleNotices(heardBy.A);
    expect(notices).toHaveLength(before + 1);
    expect(notices.at(-1).payload.notification.body).toMatch(/The listing is sold out\.$/);
    expect(heardBy.A.filter((x) => x.event === "market:sold")).toHaveLength(2);
    expect((getState().market.orderBook || []).some((o) => o.id === orderId)).toBe(false);
    expect(saleNotices(heardBy.B)).toEqual([]);
  });
});

describe("a seller who is signed out (Bug #1167)", () => {
  it("finds the notification waiting at the next login, and the sale does not fail", async () => {
    const a = await player();
    const b = await player();
    const listed = await a.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 3, unitPrice: 25 });
    expect(listed.status).toBe(200);
    // A has no socket open.
    const bought = await b.api.post(`/api/market/orders/${listed.body.order.id}/buy`).send({ quantity: 3 });
    expect(bought.status).toBe(200);
    const list = await a.api.get(`/api/accounts/${a.id}/notifications`);
    expect(list.status).toBe(200);
    const notice = list.body.notifications.find((n) => n.title === "Listing Sold");
    expect(notice.body).toMatch(new RegExp(`^${b.corpName} bought 3 Silicates at 25 credits each: 75 credits, .*The listing is sold out\\.$`));
    expect(list.body.unreadCount).toBeGreaterThan(0);
  });
});

describe("a buyer with no corporation name (Bug #1325)", () => {
  it("is 'Unregistered corporation' in the seller's Sold row and notification, never an email", async () => {
    const a = await player();
    const b = await player({ corpName: "" });
    const heard = await socket(a.token);
    const listed = await a.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 1, unitPrice: 40 });
    expect((await b.api.post(`/api/market/orders/${listed.body.order.id}/buy`).send({ quantity: 1 })).status).toBe(200);
    await waitFor(heard, "market:sold");
    expect(lastSold(a.id).counterparty).toBe("Unregistered corporation");
    const [notice] = saleNotices(heard);
    expect(notice.payload.notification.body).toMatch(/^Unregistered corporation bought 1 Silicates/);
    expect(JSON.stringify(notice.payload)).not.toContain("@");
    expect(JSON.stringify(lastSold(a.id))).not.toContain("@");
  });

  it("a listing whose stored seller name is an email reaches the buyer's Bought row as 'Unregistered corporation'", async () => {
    const a = await player();
    const b = await player();
    const listed = await a.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 1, unitPrice: 40 });
    // A listing made before names were required could be signed with the seller's email.
    const { mutateState } = await import("../../server/gameState.js");
    mutateState((s) => { s.market.orderBook.find((o) => o.id === listed.body.order.id).seller = a.email; });
    expect((await b.api.post(`/api/market/orders/${listed.body.order.id}/buy`).send({ quantity: 1 })).status).toBe(200);
    const bought = getAccountById(b.id).state.corp.tradeHistory.find((t) => t.type === "bought");
    expect(bought.counterparty).toBe("Unregistered corporation");
  });
});
