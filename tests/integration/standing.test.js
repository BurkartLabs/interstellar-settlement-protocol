import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { getState } from "../../server/gameState.js";
import { itcTick, resetItc } from "../../server/itcService.js";
import { onSale, resetStandingTick, standingTick } from "../../server/standingService.js";
import * as standing from "../../server/game/standing.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";

// ISP-238 (AB#933; docs/design/WARFARE.md, "Faction standing"): each earning action raises standing by the catalog's
// amount through the server's own bookings, a dumping finding lowers it, it decays once a day, it is private to the
// corporation, and nothing but the listed writers ever writes it.
const T = WARFARE_CATALOG.standing;
const DAY = 86_400_000;
const ITEM = "Rare-Earth Magnets";
const EA = standing.EARTH_ASSEMBLY, ITC = standing.ITC;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => { resetItc(); resetStandingTick(); delete getState().market.priceHistory[ITEM]; });

async function corp({ credits = 5_000_000, stock = {} } = {}) {
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  Object.assign(raw.state.corp, { currentSystemId: "sol", currentStationId: "earth-station-prime" });
  raw.state.corp.finances.credits = credits;
  raw.state.corp.inventory = { "earth-station-prime": { ...stock } };
  return { id: reg.account.id, corp: raw.state.corp, api: authed(app, reg.accessToken) };
}

/** Normal trade at 270 on the 7 days the ITC's next watch reads as normal (9 to 3 days ago). */
function seedNormal(price = 270, volume = 1000) {
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  getState().market.priceHistory[ITEM] = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today - (9 - i) * DAY).toISOString().slice(0, 10);
    return { day, open: price, high: price, low: price, close: price, volume, trades: 10, value: price * volume };
  });
}
async function sell(seller, buyer, quantity, unitPrice) {
  const posted = await seller.api.post("/api/market/orders").send({ type: "sell", item: ITEM, quantity, unitPrice });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  const bought = await buyer.api.post(`/api/market/orders/${posted.body.order.id}/buy`).send({ quantity });
  expect(bought.status, JSON.stringify(bought.body)).toBe(200);
}
const of = (c, f) => standing.standingOf(c.corp, f);

describe("earning standing (AB#933)", () => {
  it("Earth Assembly: a point per 10,000 credits of GEX sales tax, on a sale to the standing bid", async () => {
    const seller = await corp({ stock: { Silicates: 1000 } });
    const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const sold = await seller.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 1000 });
    const salesTax = seller.corp.finances.expensesByCategory["exchange-tax"];
    expect(salesTax).toBeGreaterThan(0);
    expect(of(seller, EA)).toBe(Math.floor((salesTax * 100) / T.eaTaxPerPoint) / 100);
    expect(sold.body.traded.total).toBeGreaterThan(0);
  });

  it("ITC: a point per 20,000 credits of goods sold at or above normal value, and none below it or without one", async () => {
    seedNormal(270);
    const fair = await corp({ stock: { [ITEM]: 500 } }), cheap = await corp({ stock: { [ITEM]: 500 } }), buyer = await corp();
    await sell(fair, buyer, 500, 270); // at normal value: 135,000 of goods
    expect(of(fair, ITC)).toBe(Math.floor((135_000 * 100) / T.itcTradePerPoint) / 100);
    expect(of(fair, EA)).toBeGreaterThan(0); // and its tax earns Earth Assembly standing
    await sell(cheap, buyer, 500, 269);
    expect(of(cheap, ITC)).toBe(0);
    delete getState().market.priceHistory[ITEM];
    const unjudged = await corp({ stock: { [ITEM]: 500 } });
    await sell(unjudged, buyer, 500, 400); // no normal value: it cannot be judged, so it earns nothing
    expect(of(unjudged, ITC)).toBe(0);
  });

  it("ITC: nothing for a sale to a conglomerate partner", async () => {
    seedNormal(270);
    const c = await corp();
    expect(onSale(c.corp, { item: ITEM, quantity: 500, unitPrice: 300, salesTax: 0, partner: true })[ITC]).toBe(0);
    expect(onSale(c.corp, { item: ITEM, quantity: 500, unitPrice: 300, salesTax: 0 })[ITC]).toBe(7.5);
  });
});

describe("losing standing (AB#933)", () => {
  it("a dumping finding costs 10 ITC standing, never below 0", async () => {
    seedNormal(270);
    const flooder = await corp({ stock: { [ITEM]: 600 } }), small = await corp({ stock: { [ITEM]: 600 } }), buyer = await corp();
    flooder.corp.standing = { [EA]: 3, [ITC]: 15 };
    small.corp.standing = { [ITC]: 4 };
    await sell(flooder, buyer, 600, 160);
    await sell(small, buyer, 600, 160);
    expect(itcTick(Date.now() + DAY).opened).toHaveLength(2);
    expect(of(flooder, ITC)).toBe(5);
    expect(of(small, ITC)).toBe(0);
  });

  it("decays by 2% of the value once a UTC day", async () => {
    const c = await corp();
    c.corp.standing = { [EA]: 50, [ITC]: 20 };
    const now = Date.now() + 3 * DAY;
    expect(standingTick(now)).toBeGreaterThan(0);
    expect(c.corp.standing).toEqual({ [EA]: 49, [ITC]: 19.6 });
    standingTick(now);
    resetStandingTick();
    standingTick(now); // the corporation's own day is kept, so a restart the same day does not decay it again
    expect(c.corp.standing).toEqual({ [EA]: 49, [ITC]: 19.6 });
    standingTick(now + DAY);
    expect(c.corp.standing).toEqual({ [EA]: 48.02, [ITC]: 19.21 });
  });
});

describe("standing is the corporation's own (AB#933)", () => {
  it("is served to the corporation and refused to anyone else", async () => {
    const mine = await corp(), other = await corp();
    mine.corp.standing = { [EA]: 12.5 };
    const own = await mine.api.get(`/api/accounts/${mine.id}/standing`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ standing: { [EA]: 12.5, [ITC]: 0 }, max: 100, decayPctPerDay: 2 });
    expect((await other.api.get(`/api/accounts/${mine.id}/standing`)).status).toBe(403);
  });

  it("is written only by the listed writers, each of which writes it, and no route can reach them (T-019)", () => {
    const root = path.join(process.cwd(), "server");
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith(".js") ? [path.join(dir, d.name)] : []));
    const writes = /\.standing(Carry)?\s*=[^=]|\.standing(Carry)?\[[^\]]+\]\s*=[^=]/;
    const writers = files(root).filter((f) => writes.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f).replace(/\\/g, "/"));
    expect(writers).toEqual(["game/standing.js"]);
    for (const name of standing.STANDING_WRITERS) {
      expect(typeof standing[name], name).toBe("function");
      expect(String(standing[name]), `${name} writes corp.standing`).toMatch(/corp\.standing\s*=/);
    }
    // a route never calls a writer; standing moves only from the two sale settlements' own bookings and the ITC's watch
    for (const f of files(path.join(root, "routes"))) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/game\/standing\.js|addStanding\(|earnStanding\(|decayStanding\(|onDumpingFinding\(/);
    const callers = files(root).filter((f) => /\bonSale\(/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f).replace(/\\/g, "/")).sort();
    expect(callers).toEqual(["marketSettlement.js", "routes/market.js", "standingService.js"]);
  });
});
