import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { getState } from "../../server/gameState.js";
import { recordControlDay, resetControlHistory } from "../../server/controlService.js";
import { chargeUpkeep, petitionConcession, publicConcession, resetConcessions, reviewConcessions } from "../../server/concessions.js";
import { levyTotal, resetTariffs, setTariff, tariffTick, tariffView } from "../../server/tariffService.js";
import { WARFARE_CATALOG as W } from "../../server/warfare.js";
import { saleQuote, transferTariff } from "../../public/scripts/tariffs.js"; // ISP-231 (AB#926): the client's quotes

// ISP-230 (AB#925; docs/design/WARFARE.md, "Tariffs"): a concession holder's tariff, charged on every exchange sale and
// every transfer into its system through one settlement function, paid to the holder daily less the ISA's levy, with 72
// hours' notice before an increase and the lower of the posted and current rate on a listing.
const H = 3_600_000, DAY = 24 * H;
const ALPHA = "alpha-centauri", STATION = "centauri-prime-station";
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => { resetConcessions(); resetControlHistory(); resetTariffs(); });

async function corp({ systemId = ALPHA, stationId = STATION, credits = 500_000, stock = {} } = {}) {
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  Object.assign(raw.state.corp, { currentSystemId: systemId, currentStationId: stationId });
  raw.state.corp.finances.credits = credits;
  raw.state.corp.inventory = { [stationId]: { ...stock } };
  const c = raw.state.corp;
  return { id: reg.account.id, corp: c, holder: { type: "corp", id: c.publicId, name: c.corporationName }, api: authed(app, reg.accessToken), token: reg.accessToken };
}

function readings(systemId, rows, newestAt, n = 14) {
  for (let i = n - 1; i >= 0; i -= 1) {
    recordControlDay({ computedAt: newestAt - i * DAY, holders: { [systemId]: { live: ["extraction", "leases"], groups: rows.map(([h, s]) => ({ type: h.type, id: h.id, name: h.name, parts: { extraction: s, leases: s, sales: 0 } })) } } });
  }
}

/** `a` petitions for and is granted the system (TERRITORY.md's review), against a rival `b`. */
function grant(a, b, systemId = ALPHA, T = Date.now()) {
  readings(systemId, [[a.holder, 0.6], [b.holder, 0.2]], T - H);
  expect(petitionConcession(a.id, systemId, T).refused).toBeUndefined();
  readings(systemId, [[a.holder, 0.6], [b.holder, 0.2]], T + 71 * H);
  reviewConcessions(T + 72 * H);
  expect(publicConcession(systemId).holders).toEqual([expect.objectContaining({ state: "granted" })]);
}

/** File `pct` long enough ago that its notice has run. */
const inForce = (c, pct, systemId = ALPHA) => expect(setTariff(c.corp, systemId, pct, Date.now() - (W.tariffs.noticeHours + 1) * H).ok).toBe(true);
const silicateOrder = () => getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
const expense = (c, k) => c.corp.finances.expensesByCategory?.[k] || 0;

describe("the tariff on sales (AB#925)", () => {
  it("a sale to the standing bid pays GEX tax plus the tariff, and the holder is paid the tariff less the levy, daily", async () => {
    const holder = await corp(), rival = await corp(), seller = await corp({ stock: { Silicates: 1000 } });
    grant(holder, rival);
    inForce(holder, 3);
    const holderBefore = holder.corp.finances.credits;
    const res = await seller.api.post(`/api/market/npc-orders/${silicateOrder().id}/sell`).send({ quantity: 1000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const t = res.body.traded;
    const tariff = Math.round((t.total * 3) / 100); // the arithmetic: 3% of the gross, beside the tax
    expect(t).toMatchObject({ tariffPct: 3, tariffAmount: tariff, proceeds: t.total - t.taxAmount - tariff });
    expect(expense(seller, "tariff")).toBe(tariff);
    expect(res.body.receipt.grants).toEqual(expect.arrayContaining([{ label: "Concession tariff", value: expect.stringContaining("(3%)") }]));
    // the levy at the cap is 75% (3% of a 3% cap): the ISA keeps 75%, the holder 25%, paid once at the day's tick
    const levy = Math.round(tariff * 0.75);
    expect(holder.corp.finances.credits).toBe(holderBefore);
    const paid = tariffTick(Date.now());
    expect(paid).toEqual([expect.objectContaining({ systemId: ALPHA, credits: tariff - levy })]);
    expect(holder.corp.finances.credits).toBe(holderBefore + tariff - levy);
    expect(holder.corp.finances.incomeBySource?.["tariff-revenue"]).toBe(tariff - levy);
    expect(levyTotal()).toBe(levy);
    expect(tariffTick(Date.now())).toEqual([]); // once a day
  });

  it("a listing pays the lower of the rate when it was posted and the rate when it fills", async () => {
    const holder = await corp(), rival = await corp(), seller = await corp({ stock: { Silicates: 500 } }), buyer = await corp();
    grant(holder, rival);
    inForce(holder, 3);
    const posted = await seller.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 200, unitPrice: 30 });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.order.tariffPct).toBe(3);
    getState().market.orderBook.find((o) => o.id === posted.body.order.id).tariffPct = 1; // as if posted while the rate was 1%
    const bought = await buyer.api.post(`/api/market/orders/${posted.body.order.id}/buy`).send({ quantity: 200 });
    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    expect(expense(seller, "tariff")).toBe(Math.round((200 * 30 * 1) / 100));
  });

  it("charges nothing to the holder's own side, in grace, or where no concession is held", async () => {
    const holder = await corp({ stock: { Silicates: 100 } }), rival = await corp(), seller = await corp({ stock: { Silicates: 100 } });
    const before = await seller.api.post(`/api/market/npc-orders/${silicateOrder().id}/sell`).send({ quantity: 50 });
    expect(before.body.traded.tariffAmount).toBe(0); // nobody holds the system yet
    grant(holder, rival);
    inForce(holder, 3);
    const own = await holder.api.post(`/api/market/npc-orders/${silicateOrder().id}/sell`).send({ quantity: 50 });
    expect(own.body.traded.tariffAmount).toBe(0); // the holder pays itself nothing
    holder.corp.finances.credits = 0; // the day's upkeep cannot be paid: grace suspends the benefits
    chargeUpkeep(Date.now() + DAY);
    expect(publicConcession(ALPHA).holders[0].state).toBe("grace");
    const inGrace = await seller.api.post(`/api/market/npc-orders/${silicateOrder().id}/sell`).send({ quantity: 50 });
    expect(inGrace.body.traded.tariffAmount).toBe(0);
    expect(expense(seller, "tariff")).toBe(0);
  });

  it("splits a condominium's revenue and charges the lower of its two holders' rates", async () => {
    const T = Date.now();
    const x = await corp({ systemId: "61-cygni", stationId: "cygni-condominium" }), y = await corp({ systemId: "61-cygni", stationId: "cygni-condominium" }), z = await corp({ systemId: "61-cygni", stationId: "cygni-condominium" });
    readings("61-cygni", [[x.holder, 0.45], [y.holder, 0.42], [z.holder, 0.1]], T - H);
    petitionConcession(x.id, "61-cygni", T);
    readings("61-cygni", [[x.holder, 0.45], [y.holder, 0.42], [z.holder, 0.1]], T + 71 * H);
    reviewConcessions(T + 72 * H);
    resetControlHistory();
    readings("61-cygni", [[y.holder, 0.46], [z.holder, 0.44], [x.holder, 0.05]], T + 72 * H);
    petitionConcession(y.id, "61-cygni", T + 73 * H);
    readings("61-cygni", [[y.holder, 0.46], [z.holder, 0.44], [x.holder, 0.05]], T + 144 * H);
    reviewConcessions(T + 145 * H);
    expect(publicConcession("61-cygni").holders.filter((h) => h.benefits)).toHaveLength(2);
    inForce(x, 3, "61-cygni");
    expect(tariffView("61-cygni").pct).toBe(0); // y has filed nothing: 0% until both raise it
    inForce(y, 1, "61-cygni");
    expect(tariffView("61-cygni").pct).toBe(1);
    z.corp.inventory["cygni-condominium"].Silicates = 1000;
    const sold = await z.api.post(`/api/market/npc-orders/${silicateOrder().id}/sell`).send({ quantity: 1000 });
    const tariff = sold.body.traded.tariffAmount;
    expect(tariff).toBe(Math.round((sold.body.traded.total * 1) / 100));
    const paid = tariffTick(Date.now());
    const levy = Math.round((tariff * 75 * 1) / (100 * 3));
    expect(paid.map((p) => p.credits).reduce((s, v) => s + v, 0)).toBe(tariff - levy);
    expect(paid).toHaveLength(2);
    expect(Math.abs(paid[0].credits - paid[1].credits)).toBeLessThanOrEqual(1);
  });
});

describe("the tariff on transfers into the system (AB#925)", () => {
  it("goods shipped in pay the tariff at dispatch on their normal value, beside the fee; the fee and tariff are covered or nothing moves", async () => {
    const holder = await corp(), rival = await corp(), shipper = await corp();
    shipper.corp.inventory = { "earth-station-prime": { Silicates: 1000 } };
    grant(holder, rival);
    inForce(holder, 3);
    const res = await shipper.api.post(`/api/accounts/${shipper.id}/gameplay/transfer-resources`).send({ fromStationId: "earth-station-prime", lines: [{ item: "Silicates", quantity: 1000 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const tariff = Math.round((1000 * 24 * 3) / 100); // no traded history yet: the NPC bid's base, 24
    expect(expense(shipper, "tariff")).toBe(tariff);
    expect(shipper.corp.shipments[0].tariff).toEqual({ pct: 3, amount: tariff });
    const poor = await corp({ credits: 100 });
    poor.corp.inventory = { "earth-station-prime": { Silicates: 1000 } };
    const refused = await poor.api.post(`/api/accounts/${poor.id}/gameplay/transfer-resources`).send({ fromStationId: "earth-station-prime", lines: [{ item: "Silicates", quantity: 1000 }] });
    expect(refused.status).toBe(400);
    expect(poor.corp.inventory["earth-station-prime"].Silicates).toBe(1000);
    expect(poor.corp.finances.credits).toBe(100);
  });

  it("a transfer inside the system pays no tariff", async () => {
    const holder = await corp(), rival = await corp(), shipper = await corp({ stationId: "earth-station-prime", systemId: "sol" });
    grant(holder, rival);
    inForce(holder, 3);
    shipper.corp.inventory = { "luna-gateway": { Silicates: 100 } };
    const res = await shipper.api.post(`/api/accounts/${shipper.id}/gameplay/transfer-resources`).send({ fromStationId: "luna-gateway", lines: [{ item: "Silicates", quantity: 100 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(expense(shipper, "tariff")).toBe(0);
  });
});

describe("setting a tariff (AB#925)", () => {
  it("an increase is public as pending and takes effect only after 72 hours; a decrease takes effect at once", async () => {
    const holder = await corp(), rival = await corp();
    grant(holder, rival);
    const T = Date.now();
    expect(setTariff(holder.corp, ALPHA, 2, T).ok).toBe(true);
    const view = (await request(app).get(`/api/systems/${ALPHA}/tariff`)).body; // public: no login
    expect(view).toEqual({ systemId: ALPHA, cap: 3, pct: 0, pending: { pct: 2, effectiveAt: T + 72 * H }, held: true });
    expect(tariffView(ALPHA, T + 72 * H - 1).pct).toBe(0);
    expect(tariffView(ALPHA, T + 72 * H).pct).toBe(2);
    expect(setTariff(holder.corp, ALPHA, 1, T + 73 * H).ok).toBe(true);
    expect(tariffView(ALPHA, T + 73 * H)).toMatchObject({ pct: 1, pending: null });
  });

  it("refuses a rate out of bounds or off its steps (400), a caller who does not hold the system (403), and a holder not there (409)", async () => {
    const holder = await corp(), rival = await corp();
    grant(holder, rival);
    const post = (c, body) => c.api.post(`/api/accounts/${c.id}/tariffs/${ALPHA}`).send(body);
    expect((await post(holder, { pct: 4 })).status).toBe(400); // above Alpha Centauri's 3% cap
    expect((await post(holder, { pct: 1.1 })).status).toBe(400); // not a 0.25-point step
    expect((await post(holder, { pct: "abc" })).status).toBe(400);
    expect((await post(holder, { pct: 99 })).status).toBe(400);
    expect((await post(rival, { pct: 1 })).status).toBe(403);
    holder.corp.currentSystemId = "sol";
    expect((await post(holder, { pct: 1 })).status).toBe(409);
    holder.corp.currentSystemId = ALPHA;
    const ok = await post(holder, { pct: 1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.tariff.pending).toMatchObject({ pct: 1 });
    expect((await request(app).get("/api/systems/atlantis/tariff")).status).toBe(404);
  });
});

describe("one settlement function (P-HALF-FIX, AB#925)", () => {
  it("every path that books sale income or a transfer fee calls chargeTariff", () => {
    const root = path.join(process.cwd(), "server");
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith(".js") ? [path.join(dir, d.name)] : []));
    const sites = files(root).filter((f) => /applyCredits\([^)]*"(exchange|transfer-fees)"\)/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f).replace(/\\/g, "/")).sort();
    expect(sites).toEqual(["marketSettlement.js", "routes/logistics.js", "routes/market.js"]);
    for (const f of sites) expect(fs.readFileSync(path.join(root, f), "utf8"), f).toMatch(/chargeTariff\(/);
  });
});

describe("what a trader sees before committing, and the holder's schedule (ISP-231, AB#926)", () => {
  it("quotes a sale and a transfer with the server's own arithmetic: the confirmation's net is the settlement's", async () => {
    const holder = await corp(), rival = await corp(), seller = await corp({ stock: { Silicates: 1000 } });
    seller.corp.inventory["earth-station-prime"] = { Silicates: 400, Titanium: 50 };
    grant(holder, rival);
    inForce(holder, 3);
    const mine = (await seller.api.get(`/api/accounts/${seller.id}/tariffs`)).body;
    expect(mine.here).toEqual({ stationId: STATION, systemId: ALPHA, cap: 3, pct: 3, exempt: false, pending: null });
    expect(mine.systems[ALPHA]).toMatchObject({ pct: 3, held: true });
    expect(mine.holdings).toEqual([]);
    expect(mine.normalValues).toEqual({ Silicates: 24, Titanium: 64 }); // the goods it holds outside this system
    // the sale: the confirmation's rows come from saleQuote with the stored breakdown and here.pct
    const order = silicateOrder();
    const unitPrice = order.unitPrice;
    const quote = saleQuote(1000 * unitPrice, seller.corp.finances.exchangeTaxBreakdown, mine.here.pct);
    const sold = await seller.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 1000 });
    expect(sold.body.traded.total).toBe(1000 * unitPrice);
    expect(quote.tariff).toBe(sold.body.traded.tariffAmount);
    expect(quote.proceeds).toBe(sold.body.traded.proceeds);
    // the transfer: the Logistics quote is transferTariff over the summary's normal values
    const lines = [{ item: "Silicates", quantity: 400 }, { item: "Titanium", quantity: 50 }];
    const quoted = transferTariff(lines, mine.normalValues, mine.here.pct);
    const shipped = await seller.api.post(`/api/accounts/${seller.id}/gameplay/transfer-resources`).send({ fromStationId: "earth-station-prime", lines });
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
    expect(shipped.body.shipment.tariff.amount).toBe(quoted);
    expect(shipped.body.receipt.grants).toEqual(expect.arrayContaining([{ label: "Concession tariff", value: expect.stringContaining("(3%)") }]));
  });

  it("shows a trader a pending increase with its time, and the holder its schedule, what it collected and what is owed", async () => {
    const holder = await corp(), rival = await corp(), seller = await corp({ stock: { Silicates: 1000 } });
    grant(holder, rival);
    inForce(holder, 1);
    const T = Date.now();
    expect(setTariff(holder.corp, ALPHA, 2, T).ok).toBe(true);
    const theirs = (await seller.api.get(`/api/accounts/${seller.id}/tariffs`)).body;
    expect(theirs.here).toMatchObject({ pct: 1, pending: { pct: 2, effectiveAt: T + 72 * H } });
    await seller.api.post(`/api/market/npc-orders/${silicateOrder().id}/sell`).send({ quantity: 1000 });
    const before = (await holder.api.get(`/api/accounts/${holder.id}/tariffs`)).body;
    expect(before.here).toMatchObject({ exempt: true, pct: 0, pending: null }); // the holder pays itself nothing
    expect(before.holdings).toEqual([expect.objectContaining({ systemId: ALPHA, cap: 3, pct: 1, pending: { pct: 2, effectiveAt: T + 72 * H }, docked: true, paidTotal: 0 })]);
    const owed = before.holdings[0].accrued;
    expect(owed).toBeGreaterThan(0);
    tariffTick(Date.now());
    const after = (await holder.api.get(`/api/accounts/${holder.id}/tariffs`)).body.holdings[0];
    expect(after).toMatchObject({ accrued: 0, paidTotal: owed });
  });
});
