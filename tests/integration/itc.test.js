import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { getState, listAccountNotifications } from "../../server/gameState.js";
import { dutyOwed, findingsFor, itcSinkTotal, itcTick, recordOwnSale, resetItc } from "../../server/itcService.js";
import { saleQuote } from "../../public/scripts/tariffs.js";
import { withheldFrom } from "../../public/scripts/itcDuty.js"; // the sale confirmation's own arithmetic
import { listingWarning } from "../../public/scripts/dumping.js"; // ISP-233 (AB#928): the listing warning's rule

// ISP-232 (AB#927; docs/design/WARFARE.md, "Dumping, and the Trade Commission's watch"): the daily watch over sales at
// a price the seller chose, the investigation notice with its numbers, the duty levied a day later and never below
// zero, and the rest withheld from later sales. Normal value is seeded in the price history for the 7 days before the
// window; the sales are made today, and the watch is run as of 3 days later, when today is in its window.
const DAY = 86_400_000;
const ITEM = "Rare-Earth Magnets";
const STATION = "earth-station-prime";
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => { resetItc(); delete getState().market.priceHistory[ITEM]; });

async function corp({ credits = 1_000_000, stock = {} } = {}) {
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  Object.assign(raw.state.corp, { currentSystemId: "sol", currentStationId: STATION });
  raw.state.corp.finances.credits = credits;
  raw.state.corp.inventory = { [STATION]: { ...stock } };
  return { id: reg.account.id, corp: raw.state.corp, api: authed(app, reg.accessToken) };
}

/** The 7 days before today: `volume` a day at `price`, each with its traded value. */
function seedNormal(price = 270, volume = 1000, days = 7) {
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  getState().market.priceHistory[ITEM] = Array.from({ length: days }, (_, i) => {
    const day = new Date(today - (days - i) * DAY).toISOString().slice(0, 10);
    return { day, open: price, high: price, low: price, close: price, volume, trades: 10, value: price * volume };
  });
}

async function sellTo(seller, buyer, quantity, unitPrice) {
  const posted = await seller.api.post("/api/market/orders").send({ type: "sell", item: ITEM, quantity, unitPrice });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  const bought = await buyer.api.post(`/api/market/orders/${posted.body.order.id}/buy`).send({ quantity });
  expect(bought.status, JSON.stringify(bought.body)).toBe(200);
}
const expense = (c) => c.corp.finances.expensesByCategory?.["anti-dumping-duty"] || 0;
const later = (days) => Date.now() + days * DAY;

describe("the ITC's dumping watch (AB#927)", () => {
  it("finds a flood, tells the seller the numbers, and levies the margin a day later, never below zero; the rest is withheld from later sales", async () => {
    seedNormal();
    const seller = await corp({ stock: { [ITEM]: 600 } }), buyer = await corp();
    await sellTo(seller, buyer, 600, 160); // 59% of a normal value of 270; the volume line is 10% x 1,000 x 3 = 300
    const opened = itcTick(later(3));
    expect(opened.opened).toHaveLength(1);
    const [f] = findingsFor(seller.corp.publicId);
    expect(f).toMatchObject({ item: ITEM, N: 270, Q: 600, P: 160, duty: 66_000, volumeLine: 300, leviedAt: null });
    const notice = listAccountNotifications(seller.id).notifications.find((n) => n.title === "ITC Anti-Dumping Investigation");
    expect(notice.body).toContain(`${f.ref}. The Interplanetary Trade Commission has opened an anti-dumping investigation.`); // ISP-249 (AB#945): the finding's reference
    expect(notice.body).toContain("you sold 600 Rare-Earth Magnets at an average of 160 credits, below 85% of their normal value (270 credits; the line is 229.5)");
    expect(notice.body).toContain("The volume line for those 3 days was 300 units");
    expect(notice.body).toContain("A duty of 66,000 credits, the dumping margin, will be levied");
    expect(expense(seller)).toBe(0); // nothing is taken with the notice

    seller.corp.finances.credits = 50_000;
    itcTick(later(4)); // the next tick: levied from credits, never below zero, the rest owed
    expect(seller.corp.finances.credits).toBe(0);
    expect(expense(seller)).toBe(50_000);
    expect(dutyOwed(seller.corp)).toBe(16_000);
    expect(seller.corp.itcDuty).toEqual({ owed: 16_000, withholdPct: 50 }); // on the corporation, so its confirmation can show it
    expect(findingsFor(seller.corp.publicId)[0]).toMatchObject({ paid: 50_000, owedAtLevy: 16_000 });
    expect(listAccountNotifications(seller.id).notifications.find((n) => n.title === "ITC Anti-Dumping Duty Levied").body).toContain("The remaining 16,000 credits is owed");

    // a later sale, to the standing bid: half of what is left after tax is withheld toward the duty
    seller.corp.inventory[STATION] = { Silicates: 1000 };
    const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const quote = saleQuote(1000 * order.unitPrice, seller.corp.finances.exchangeTaxBreakdown, 0);
    const shown = quote.proceeds - withheldFrom(quote.proceeds, seller.corp.itcDuty); // what the confirmation says
    const sold = await seller.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 1000 });
    expect(sold.body.traded.proceeds).toBe(shown);
    const t = sold.body.traded;
    const net = t.total - t.taxAmount - (t.tariffAmount || 0);
    expect(t.dutyWithheld).toBe(Math.min(16_000, Math.floor(net / 2)));
    expect(t.proceeds).toBe(net - t.dutyWithheld);
    expect(dutyOwed(seller.corp)).toBe(16_000 - t.dutyWithheld);
    expect(sold.body.receipt.grants).toEqual(expect.arrayContaining([{ label: "Withheld for ITC duty", value: expect.any(String) }]));
    expect(itcSinkTotal()).toBe(50_000 + t.dutyWithheld);
  });

  it("charges one duty per investigation, and runs once a day", async () => {
    seedNormal();
    const seller = await corp({ stock: { [ITEM]: 600 } }), buyer = await corp();
    await sellTo(seller, buyer, 600, 160);
    // today's sales are in the windows of the next three ticks; the first finds them
    expect(itcTick(later(1)).opened).toHaveLength(1);
    expect(itcTick(later(1)).opened).toHaveLength(0); // the same day again
    const next = itcTick(later(2)); // still in the window, and in a finding already: levied, not found again
    expect(next).toEqual({ levied: [findingsFor(seller.corp.publicId)[0].id], opened: [] });
    expect(itcTick(later(3))).toEqual({ levied: [], opened: [] });
    expect(expense(seller)).toBe(66_000);
  });

  it("leaves alone a sale at 85% or more, a small flood, sales to a partner or the standing bid, and an item with no normal value", async () => {
    seedNormal();
    const fair = await corp({ stock: { [ITEM]: 5000 } }), small = await corp({ stock: { [ITEM]: 299 } }), buyer = await corp({ credits: 5_000_000 });
    await sellTo(fair, buyer, 5000, 230); // 85.2%: price competition, not dumping
    await sellTo(small, buyer, 299, 100); // under the 300-unit line
    const partner = await corp();
    recordOwnSale(partner.corp, { item: ITEM, quantity: 5000, unitPrice: 10, partner: true }); // inside its conglomerate
    const bidSeller = await corp({ stock: { Silicates: 7000 } });
    const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    await bidSeller.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 7000 }); // the ISA's price, not the seller's
    expect(itcTick(later(3)).opened).toEqual([]);

    resetItc();
    delete getState().market.priceHistory[ITEM];
    seedNormal(270, 1000, 2); // two traded days of seven: no normal value
    const seller = await corp({ stock: { [ITEM]: 600 } });
    await sellTo(seller, buyer, 600, 10);
    expect(itcTick(later(3)).opened).toEqual([]);
  });

  it("reads only the three complete days before the tick", async () => {
    seedNormal();
    const seller = await corp({ stock: { [ITEM]: 600 } }), buyer = await corp();
    await sellTo(seller, buyer, 600, 160);
    expect(itcTick(later(0)).opened).toEqual([]); // today is not complete
    resetItc();
    const again = await corp({ stock: { [ITEM]: 600 } });
    await sellTo(again, buyer, 600, 160);
    expect(itcTick(later(4)).opened).toEqual([]); // four days on, today has left the window
  });
});

describe("one withholding, on both sale paths (P-HALF-FIX, AB#927)", () => {
  it("every path that books sale income withholds duty owed, and the own-priced one is recorded for the watch", () => {
    const root = path.join(process.cwd(), "server");
    const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
    for (const f of ["marketSettlement.js", "routes/market.js"]) expect(read(f), f).toMatch(/withholdDuty\(/);
    expect(read("marketSettlement.js")).toMatch(/recordOwnSale\(/);
    expect(read("routes/market.js")).not.toMatch(/recordOwnSale\(/); // the standing bid's price is the ISA's
  });
});

describe("flooding made visible before it is found (ISP-233, AB#928)", () => {
  /** Normal trade at `price` on the 7 days the next tick reads as normal (9 to 3 days ago), and `lastDay` yesterday. */
  function seedForNextTick(price = 270, volume = 1000, lastDay = null) {
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const b = (offset, close, vol) => ({ day: new Date(today - offset * DAY).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: vol, trades: 10, value: close * vol });
    getState().market.priceHistory[ITEM] = [...Array.from({ length: 7 }, (_, i) => b(9 - i, price, volume)), ...(lastDay ? [b(1, lastDay.close, lastDay.volume)] : [])];
  }

  it("alerts on the Exchange's item view when the last day closed under the line, with the volume behind it", async () => {
    seedForNextTick(270, 1000, { close: 160, volume: 600 });
    const viewer = await corp();
    const res = await viewer.api.get(`/api/market/history/${encodeURIComponent(ITEM)}`);
    expect(res.status).toBe(200);
    expect(res.body.watch).toMatchObject({ normal: { price: 270, dailyVolume: 1000 }, line: 229.5, volumeLine: 300, alert: { close: 160, volume: 600, dropPct: 41, volumePct: 60 } });
    seedForNextTick(270, 1000, { close: 240, volume: 600 }); // 11% under: above the line, no alert
    expect((await viewer.api.get(`/api/market/history/${encodeURIComponent(ITEM)}`)).body.watch.alert).toBeNull();
  });

  it.each([
    ["at the volume line", 300, 229, true],
    ["one unit under the volume line", 299, 229, false],
    ["at the price line", 400, 229.5, false]
  ])("warns exactly as the watch then decides: %s", async (_, quantity, unitPrice, expected) => {
    seedForNextTick();
    const seller = await corp({ stock: { [ITEM]: quantity } }), buyer = await corp({ credits: 5_000_000 });
    const mine = (await seller.api.get(`/api/accounts/${seller.id}/itc/${encodeURIComponent(ITEM)}`)).body;
    expect(mine).toMatchObject({ line: 229.5, volumeLine: 300, sales: [], owed: 0 });
    const warned = listingWarning(mine, quantity, unitPrice);
    const posted = await seller.api.post("/api/market/orders").send({ type: "sell", item: ITEM, quantity, unitPrice: Math.ceil(unitPrice) === unitPrice ? unitPrice : Math.floor(unitPrice) });
    // prices are whole credits: 229 is under the 229.5 line, and 229.5 cannot be listed, so the line case lists at 230
    if (unitPrice === 229.5) {
      expect(warned).toBeNull();
      return;
    }
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    await buyer.api.post(`/api/market/orders/${posted.body.order.id}/buy`).send({ quantity });
    const found = itcTick(later(1)).opened.length > 0;
    expect(warned.found).toBe(expected);
    expect(found).toBe(expected);
    if (expected) expect(findingsFor(seller.corp.publicId)[0].duty).toBe(warned.duty);
  });

  it("counts what the seller already sold below the line in the window", async () => {
    seedForNextTick();
    const seller = await corp({ stock: { [ITEM]: 200 } }), buyer = await corp({ credits: 5_000_000 });
    await sellTo(seller, buyer, 200, 200);
    const mine = (await seller.api.get(`/api/accounts/${seller.id}/itc/${encodeURIComponent(ITEM)}`)).body;
    expect(mine.sales).toEqual([expect.objectContaining({ quantity: 200, unitPrice: 200 })]);
    expect(listingWarning(mine, 100, 200)).toMatchObject({ already: 200, Q: 300, found: true });
    expect(listingWarning(mine, 99, 200)).toMatchObject({ already: 200, Q: 299, found: false });
    expect((await seller.api.get(`/api/accounts/${seller.id}/itc/Unobtainium`)).status).toBe(404);
  });
});
