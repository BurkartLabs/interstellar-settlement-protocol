import { describe, it, expect, beforeEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, listAccountNotifications, mutateAccountState, mutateState } from "../../server/gameState.js";

// AB#1054: players' buy orders on the Galactic Exchange. The credits are held when the order is posted; it fills from
// listings at or under its price, oldest first, at the listing's price; the rest waits and a later listing at or under
// it fills it; cancelling returns what is still held. Both ledgers and both trade histories are written.

const EARTH = "earth-station-prime";

async function corp({ credits = 100_000, stock = {} } = {}) {
  const { app } = await getApp();
  const me = await registerAccount(app);
  const id = me.account.id;
  mutateAccountState(id, (s) => {
    s.corp.finances.credits = credits;
    s.corp.currentStationId = EARTH;
    s.corp.inventory = { [EARTH]: { ...stock } };
  }, { sanitize: false, settleMining: false });
  const api = authed(app, me.accessToken);
  const c = () => getAccountById(id).state.corp;
  return {
    id,
    api,
    corp: c,
    credits: () => Number(c().finances.credits),
    held: (item) => Number(c().inventory?.[EARTH]?.[item] || 0),
    list: (item, quantity, unitPrice) => api.post("/api/market/orders").send({ type: "sell", item, quantity, unitPrice }),
    bid: (item, quantity, unitPrice) => api.post("/api/market/orders").send({ type: "buy", item, quantity, unitPrice }),
    cancel: (orderId) => api.post(`/api/market/orders/${orderId}/cancel`).send({})
  };
}

const bids = () => getState().market.buyOrders || [];
const listings = () => getState().market.orderBook || [];
/** Listings are matched oldest first by createdAt; tests posting several in one millisecond set it apart. */
const age = (orderId, createdAt) => mutateState((d) => { d.market.orderBook.find((o) => o.id === orderId).createdAt = createdAt; });

beforeEach(() => mutateState((d) => { d.market.orderBook = []; d.market.buyOrders = []; }));

describe("posting a buy order (AB#1054)", () => {
  it("holds the credits and waits in the book when nothing is for sale at the price, shown without the buyer's ids", async () => {
    const buyer = await corp();
    const res = await buyer.bid("Titanium", 100, 30);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(buyer.credits()).toBe(100_000 - 3000);
    expect(buyer.corp().finances.expensesByCategory["exchange-escrow"]).toBe(3000);
    expect(res.body.fills).toEqual([]);
    expect(res.body.receipt).toMatchObject({ action: "place-buy-order", costCredits: 3000 });
    expect(bids()).toHaveLength(1);
    expect(bids()[0]).toMatchObject({ item: "Titanium", quantity: 100, unitPrice: 30, buyerAccountId: buyer.id, stationId: EARTH });
    expect(buyer.corp().tradeHistory[0]).toMatchObject({ type: "bid", item: "Titanium", quantity: 100, unitPrice: 30 });

    const seen = (await buyer.api.get("/api/bootstrap")).body.market.buyOrders;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ item: "Titanium", quantity: 100, unitPrice: 30, mine: true });
    expect(seen[0]).not.toHaveProperty("buyerAccountId");
    expect(seen[0]).not.toHaveProperty("stationId");
  });

  it("fills from listings at or under its price, oldest first, at each listing's price, and returns the difference", async () => {
    const a = await corp({ stock: { Titanium: 60 } });
    const b = await corp({ stock: { Titanium: 60 } });
    const dear = await corp({ stock: { Titanium: 60 } });
    const older = (await a.list("Titanium", 60, 28)).body.order;
    const newer = (await b.list("Titanium", 60, 25)).body.order;
    const tooDear = (await dear.list("Titanium", 60, 31)).body.order;
    age(older.id, 1_000); age(newer.id, 2_000); age(tooDear.id, 500);
    const buyer = await corp();
    const aBefore = a.credits();

    const res = await buyer.bid("Titanium", 100, 30);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Oldest first among those at or under 30: a's 60 at 28, then 40 of b's at 25. The 31 is never touched.
    expect(res.body.fills.map((f) => [f.listingId, f.quantity, f.unitPrice])).toEqual([[older.id, 60, 28], [newer.id, 40, 25]]);
    const paid = 60 * 28 + 40 * 25;
    expect(buyer.credits()).toBe(100_000 - paid);
    expect(res.body.spent).toBe(paid);
    expect(buyer.held("Titanium")).toBe(100);
    expect(buyer.corp().finances.expensesByCategory["exchange-purchases"]).toBe(paid);
    expect(buyer.corp().finances.expensesByCategory["exchange-escrow"]).toBe(3000);
    expect(buyer.corp().finances.incomeBySource["exchange-escrow-return"]).toBe(3000); // held and returned: nets to zero
    expect(bids()).toEqual([]); // filled, so nothing waits
    expect(listings().map((o) => [o.id, o.quantity])).toEqual(expect.arrayContaining([[newer.id, 20], [tooDear.id, 60]]));
    expect(listings().find((o) => o.id === older.id)).toBeUndefined();

    // The seller's side is a sale like any other: paid less the exchange tax, with a Sold row naming the buyer.
    const sold = a.corp().tradeHistory.find((t) => t.type === "sold");
    expect(sold).toMatchObject({ item: "Titanium", quantity: 60, unitPrice: 28, total: 1680 });
    expect(a.credits() - aBefore).toBe(sold.proceeds);
    expect(a.corp().finances.incomeBySource.exchange).toBe(1680);
    const bought = buyer.corp().tradeHistory.filter((t) => t.type === "bought");
    expect(bought.map((t) => [t.quantity, t.unitPrice])).toEqual(expect.arrayContaining([[60, 28], [40, 25]]));
  });

  it("a partial fill leaves the rest standing with its credits held, and cancelling returns exactly those", async () => {
    const seller = await corp({ stock: { Nickel: 40 } });
    await seller.list("Nickel", 40, 30);
    const buyer = await corp();
    const res = await buyer.bid("Nickel", 100, 30);
    expect(res.body.fills.map((f) => f.quantity)).toEqual([40]);
    expect(bids()).toHaveLength(1);
    expect(bids()[0].quantity).toBe(60);
    expect(res.body.order).toMatchObject({ quantity: 60, mine: true });
    expect(buyer.credits()).toBe(100_000 - 40 * 30 - 60 * 30);

    const cancel = await buyer.cancel(bids()[0].id);
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.refunded).toBe(1800);
    expect(buyer.credits()).toBe(100_000 - 40 * 30);
    expect(bids()).toEqual([]);
    expect(buyer.corp().tradeHistory[0]).toMatchObject({ type: "cancelled", item: "Nickel", quantity: 60 });
  });

  it("a listing posted later at or under a waiting order's price fills it at the listing's price, and tells the buyer", async () => {
    const buyer = await corp();
    await buyer.bid("Carbon", 50, 30);
    const seller = await corp({ stock: { Carbon: 80 } });
    const res = await seller.list("Carbon", 80, 26);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fills.map((f) => [f.quantity, f.unitPrice])).toEqual([[50, 26]]);
    expect(res.body.receipt.grants).toEqual(expect.arrayContaining([{ label: "Sold at once to buy orders", value: "50 Carbon" }]));
    expect(buyer.credits()).toBe(100_000 - 50 * 26); // held 50 x 30, paid 50 x 26, 200 back
    expect(buyer.held("Carbon")).toBe(50);
    expect(bids()).toEqual([]);
    expect(listings().find((o) => o.id === res.body.order.id).quantity).toBe(30);
    expect(seller.held("Carbon")).toBe(0); // all 80 left the hold when listed: 50 sold, 30 still listed
    const told = listAccountNotifications(buyer.id).notifications.find((n) => n.title === "Buy Order Filled");
    expect(told.body).toMatch(/sold you 50 Carbon at .*26.* against your order at .*30/);
    expect(told.protocol).toEqual({ meaning: "complete", screen: "market" }); // ISP-255 (AB#951): filled is Concluded
  });

  it("Bug #4827: a refusal over a quantity or for want of credits says what would work", async () => {
    const seller = await corp({ stock: { Carbon: 40 } });
    const over = await seller.list("Carbon", 50, 20);
    expect(over.status).toBe(400);
    expect(over.body.error).toBe("You hold 40 Carbon at this station. List 40 or fewer.");
    expect((await seller.list("Titanium", 5, 20)).body.error).toBe("You hold no Titanium at this station. Bring some here to list it.");
    const listed = (await seller.list("Carbon", 30, 20)).body.order;
    const buyer = await corp({ credits: 100 });
    const tooMany = await buyer.api.post(`/api/market/orders/${listed.id}/buy`).send({ quantity: 31 });
    expect(tooMany.body.error).toBe("Only 30 remain on that listing. Buy 30 or fewer.");
    const unfunded = await buyer.api.post(`/api/market/orders/${listed.id}/buy`).send({ quantity: 10 });
    expect(unfunded.status).toBe(400);
    expect(unfunded.body).toMatchObject({ code: "insufficient-credits" });
    expect(unfunded.body.error).toMatch(/Sell goods or finish an assignment to raise the credits, or buy fewer\.$/);
    expect(buyer.credits()).toBe(100);
  });

  it("never fills against the corporation's own listing", async () => {
    const me = await corp({ stock: { Silicates: 100 } });
    await me.list("Silicates", 100, 20);
    const res = await me.bid("Silicates", 100, 25);
    expect(res.body.fills).toEqual([]);
    expect(bids()).toHaveLength(1);
    expect(listings()[0].quantity).toBe(100);
  });

  it("refuses too little credit and an item the exchange does not trade, changing nothing", async () => {
    const poor = await corp({ credits: 999 });
    const short = await poor.bid("Titanium", 100, 10);
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/holds 1,000 credits; you have 999 credits\. Sell goods or finish an assignment to raise the credits, or buy fewer\.$/); // Bug #4827
    expect(short.body.code).toBe("insufficient-credits");
    const odd = await poor.bid("Unobtainium", 1, 1);
    expect(odd.status).toBe(400);
    const zero = await poor.bid("Titanium", 0, 10);
    expect(zero.status).toBe(400);
    expect(poor.credits()).toBe(999);
    expect(bids()).toEqual([]);
  });

  it("another corporation cannot cancel an order: 404, and the credits stay held", async () => {
    const buyer = await corp();
    await buyer.bid("Titanium", 10, 30);
    const other = await corp();
    const res = await other.cancel(bids()[0].id);
    expect(res.status).toBe(404);
    expect(bids()).toHaveLength(1);
    expect(buyer.credits()).toBe(100_000 - 300);
  });
});

describe("two buyers racing for one listing (AB#1054)", () => {
  it("fill it once between them: one gets the goods, the other waits with its credits held", async () => {
    const seller = await corp({ stock: { Titanium: 50 } });
    await seller.list("Titanium", 50, 20);
    const one = await corp();
    const two = await corp();

    const [r1, r2] = await Promise.all([one.bid("Titanium", 50, 25), two.bid("Titanium", 50, 25)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const filled = [...r1.body.fills, ...r2.body.fills];
    expect(filled.reduce((sum, f) => sum + f.quantity, 0)).toBe(50);
    expect(listings()).toEqual([]);
    expect(one.held("Titanium") + two.held("Titanium")).toBe(50);
    const winner = one.held("Titanium") === 50 ? one : two;
    const loser = winner === one ? two : one;
    expect(winner.credits()).toBe(100_000 - 50 * 20);
    expect(loser.credits()).toBe(100_000 - 50 * 25);
    expect(bids().map((o) => [o.buyerAccountId, o.quantity])).toEqual([[loser.id, 50]]);
    // The seller was paid for 50 once, not twice.
    expect(seller.corp().tradeHistory.filter((t) => t.type === "sold").reduce((sum, t) => sum + t.quantity, 0)).toBe(50);
  });
});
