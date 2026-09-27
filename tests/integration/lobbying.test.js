import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { getState } from "../../server/gameState.js";
import { lobbyingTick, openCampaign, parameterInForce, pledge, resetLobbying } from "../../server/lobbyingService.js";
import { tariffCap } from "../../server/tariffService.js";
import { itcTick, resetItc } from "../../server/itcService.js";
import { listingWarning } from "../../public/scripts/dumping.js";
import { withBasePct } from "../../public/scripts/exchangeTax.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";
import { preview } from "../../public/scripts/lobbying.js"; // ISP-240 (AB#935): the office's preview

// ISP-239 (AB#934; docs/design/WARFARE.md, "Lobbying"): a campaign opened with standing, pledged to with credits and
// standing, closed on the curve, held for 28 days on the one function the tariff cap, the sales tax and the ITC's lines
// read, then back to base; the hostile inputs refused with nothing charged; and the register public, amounts private.
const H = 3_600_000, DAY = 24 * H;
const EA = "earth-assembly", ITC = "interplanetary-trade-commission";
const ALPHA = "alpha-centauri";
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => { resetLobbying(); resetItc(); delete getState().market.priceHistory["Rare-Earth Magnets"]; });

async function corp({ credits = 1_000_000, standing = {}, stationId = "earth-station-prime", systemId = "sol", stock = {} } = {}) {
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  Object.assign(raw.state.corp, { currentSystemId: systemId, currentStationId: stationId, standing: { ...standing } });
  raw.state.corp.finances.credits = credits;
  raw.state.corp.inventory = { [stationId]: { ...stock } };
  return { id: reg.account.id, corp: raw.state.corp, api: authed(app, reg.accessToken) };
}
/** Open, pledge and close a campaign whose pledging ended an hour ago, so it holds now. */
function held(opener, { parameter, systemId, direction }, pledges) {
  const T = Date.now() - 73 * H;
  const opened = openCampaign(opener.corp, { parameter, systemId, direction }, T);
  expect(opened.ok, JSON.stringify(opened)).toBe(true);
  for (const [who, p] of pledges) expect(pledge(who.corp, opened.campaign.id, p, T + H).ok).toBe(true);
  lobbyingTick(Date.now());
  return opened.campaign.id;
}

describe("a campaign moves its parameter by the curve, and returns it to base (AB#934)", () => {
  it("Helios's 15,000 raises Alpha Centauri's cap to 3.5 for 28 days; the tariff reads it; then it is back to 3", async () => {
    const helios = await corp({ standing: { [EA]: 25 } });
    held(helios, { parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" }, [[helios, { side: "for", credits: 15_000 }]]);
    expect(helios.corp.standing[EA]).toBe(20); // opening spent 5
    expect(helios.corp.finances.expensesByCategory["lobbying-pledge"]).toBe(15_000); // final, a sink
    expect(tariffCap(ALPHA)).toBe(3.5);
    expect(parameterInForce(ALPHA, "tariffCapPct", Date.now() + 27 * DAY)).toBe(3.5);
    expect(parameterInForce(ALPHA, "tariffCapPct", Date.now() + 28 * DAY)).toBe(3);
    expect(parameterInForce("barnards-star", "tariffCapPct")).toBe(3); // one system only
  });

  it("nets opposing pledges: Kestrel's 10,000 against 15,000 holds the cap at 3, and a campaign that moved nothing ends at once", async () => {
    const helios = await corp({ standing: { [EA]: 25 } }), kestrel = await corp({ standing: { [EA]: 6 } });
    held(helios, { parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" }, [[helios, { side: "for", credits: 15_000 }], [kestrel, { side: "against", credits: 10_000 }]]);
    expect(tariffCap(ALPHA)).toBe(3);
    const reg = (await request(app).get("/api/lobbying")).body.campaigns; // public, no login
    expect(reg[0]).toMatchObject({ parameter: "tariffCapPct", systemId: ALPHA, direction: "raise", state: "ended", result: { from: 3, to: 3 } });
    expect(reg[0].pledgers.map((p) => p.side).sort()).toEqual(["against", "for"]);
    expect(JSON.stringify(reg)).not.toMatch(/credits|15000|10000/); // who and which side, never the amounts
  });

  it("standing counts: 20 points pledged is 50,000 of influence", async () => {
    const small = await corp({ standing: { [EA]: 45 } });
    held(small, { parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" }, [[small, { side: "for", standing: 20 }]]);
    expect(small.corp.standing[EA]).toBe(20); // 45 - 5 to open - 20 pledged
    expect(tariffCap(ALPHA)).toBe(3.75); // E(50,000) = 0.918: three quarter-point steps
  });
});

describe("the rules a campaign moves are the ones the game charges (AB#934)", () => {
  it("the sales tax: a sale at the system's stations pays the lobbied rate, and the confirmation quotes it", async () => {
    const lobby = await corp({ standing: { [EA]: 25 } });
    held(lobby, { parameter: "salesTaxPct", systemId: ALPHA, direction: "lower" }, [[lobby, { side: "for", credits: 100_000 }]]);
    expect(parameterInForce(ALPHA, "salesTaxPct")).toBe(7.5); // E(100,000) = 0.86: one half-point step
    const seller = await corp({ stationId: "centauri-prime-station", systemId: ALPHA, stock: { Silicates: 1000 } });
    const order = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    const sold = (await seller.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 1000 })).body.traded;
    expect(sold.taxPct).toBe(7.5);
    const here = (await seller.api.get(`/api/accounts/${seller.id}/tariffs`)).body.here;
    expect(withBasePct(seller.corp.finances.exchangeTaxBreakdown, here.salesTaxPct).ratePct).toBe(7.5);
    const elsewhere = await corp({ stock: { Silicates: 1000 } }); // Sol: the catalog's 8%
    expect((await elsewhere.api.post(`/api/market/npc-orders/${order.id}/sell`).send({ quantity: 1000 })).body.traded.taxPct).toBe(8);
  });

  it("the ITC's price line: lowered to 81% in Alpha Centauri, a sale at 82% there is no longer dumping, and the warning agrees", async () => {
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    getState().market.priceHistory["Rare-Earth Magnets"] = Array.from({ length: 7 }, (_, i) => ({ day: new Date(today - (9 - i) * DAY).toISOString().slice(0, 10), open: 270, high: 270, low: 270, close: 270, volume: 1000, trades: 10, value: 270_000 }));
    const lobby = await corp({ standing: { [ITC]: 25 } });
    held(lobby, { parameter: "dumpingPriceThresholdPct", systemId: ALPHA, direction: "lower" }, [[lobby, { side: "for", credits: 500_000 }]]);
    // E(500,000) is 4.9999997 of M = 5: rounded toward zero, four steps. No spend ever reaches the full M (the design's words).
    expect(parameterInForce(ALPHA, "dumpingPriceThresholdPct")).toBe(81);
    const seller = await corp({ stationId: "centauri-prime-station", systemId: ALPHA, stock: { "Rare-Earth Magnets": 600 } }), buyer = await corp({ credits: 5_000_000 });
    const watch = (await seller.api.get(`/api/accounts/${seller.id}/itc/Rare-Earth%20Magnets`)).body;
    expect(watch.line).toBeCloseTo(218.7, 6);
    expect(listingWarning(watch, 600, 222)).toBeNull(); // 82% of 270: above the lobbied line
    const posted = await seller.api.post("/api/market/orders").send({ type: "sell", item: "Rare-Earth Magnets", quantity: 600, unitPrice: 222 });
    await buyer.api.post(`/api/market/orders/${posted.body.order.id}/buy`).send({ quantity: 600 });
    expect(itcTick(Date.now() + DAY).opened).toEqual([]); // at the catalog's 85% it would have been found
    const solSeller = await corp({ stock: { "Rare-Earth Magnets": 600 } }); // the same sale in Sol, at the catalog's 85%
    expect(listingWarning((await solSeller.api.get(`/api/accounts/${solSeller.id}/itc/Rare-Earth%20Magnets`)).body, 600, 222)).toMatchObject({ found: true });
  });
});

describe("what a campaign refuses, charging nothing (AB#934)", () => {
  it("a parameter not in the list, a system never concedable, Procyon's cap, too little standing, and a parameter already held", async () => {
    const c = await corp({ standing: { [EA]: 50, [ITC]: 50 } });
    const post = (body) => c.api.post(`/api/accounts/${c.id}/lobbying`).send(body);
    expect((await post({ parameter: "gravityPct", systemId: ALPHA, direction: "raise" })).status).toBe(400);
    expect((await post({ parameter: "salesTaxPct", systemId: "sol", direction: "raise" })).status).toBe(400); // never concedable
    expect((await post({ parameter: "tariffCapPct", systemId: "procyon", direction: "raise" })).status).toBe(400); // a free port
    expect((await post({ parameter: "tariffCapPct", systemId: ALPHA, direction: "sideways" })).status).toBe(400);
    const poor = await corp({ standing: { [EA]: 19 } });
    expect((await poor.api.post(`/api/accounts/${poor.id}/lobbying`).send({ parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" })).status).toBe(403);
    expect(c.corp.standing).toEqual({ [EA]: 50, [ITC]: 50 });
    const ok = await post({ parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await post({ parameter: "tariffCapPct", systemId: ALPHA, direction: "lower" })).status).toBe(409); // one at a time
  });

  it("a pledge above holdings, non-numeric, without the standing to pledge, or after pledging closed", async () => {
    const opener = await corp({ standing: { [EA]: 25 } }), pledger = await corp({ credits: 1_000, standing: { [EA]: 6 } }), outsider = await corp({ standing: { [EA]: 4 } });
    const id = (await opener.api.post(`/api/accounts/${opener.id}/lobbying`).send({ parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" })).body.campaign.id;
    const give = (c, body) => c.api.post(`/api/accounts/${c.id}/lobbying/${id}/pledges`).send(body);
    expect((await give(pledger, { side: "for", credits: 1_001 })).status).toBe(400); // above its credits
    expect((await give(pledger, { side: "for", standing: 6.5 })).status).toBe(400); // above its standing
    expect((await give(pledger, { side: "for", credits: "lots" })).status).toBe(400);
    expect((await give(pledger, { side: "for", credits: -5 })).status).toBe(400);
    expect((await give(pledger, { side: "for" })).status).toBe(400); // nothing pledged
    expect((await give(outsider, { side: "against", credits: 10 })).status).toBe(403); // under 5 standing
    expect(pledger.corp.finances.credits).toBe(1_000);
    expect(pledger.corp.standing[EA]).toBe(6);
    expect((await give(pledger, { side: "for", credits: 1_000, standing: 1 })).status).toBe(200);
    expect(pledger.corp.finances.credits).toBe(0);
    expect(pledger.corp.standing[EA]).toBe(5);
    lobbyingTick(Date.now() + 73 * H);
    expect(pledge(pledger.corp, id, { side: "for", credits: 1 }, Date.now() + 73 * H)).toMatchObject({ status: 409 });
  });

  it("refuses a campaign whose curve cannot be evaluated, before anything is charged (fails closed)", async () => {
    const spec = WARFARE_CATALOG.lobbying.parameters.salesTaxPct;
    const K = spec.spendScale;
    spec.spendScale = 0;
    try {
      const c = await corp({ standing: { [EA]: 30 } });
      expect(openCampaign(c.corp, { parameter: "salesTaxPct", systemId: ALPHA, direction: "raise" })).toMatchObject({ status: 400 });
      expect(c.corp.standing[EA]).toBe(30);
    } finally {
      spec.spendScale = K;
    }
  });

  it("waits the cooldown after a campaign ends before another opens on the same parameter and system", async () => {
    const helios = await corp({ standing: { [EA]: 60 } });
    const T = Date.now() - 40 * DAY; // opened 40 days ago: pledging closed 37 days ago, it held 28 and ended 9 days ago
    const id = openCampaign(helios.corp, { parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" }, T).campaign.id;
    pledge(helios.corp, id, { side: "for", credits: 15_000 }, T + H);
    lobbyingTick(T + 73 * H);
    expect(openCampaign(helios.corp, { parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" }, T + 73 * H + 30 * DAY)).toMatchObject({ status: 409 }); // in the cooldown
    expect(openCampaign(helios.corp, { parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" }).ok).toBe(true); // 9 days after it ended
  });
});

describe("the lobbying office (ISP-240, AB#935)", () => {
  it("previews exactly what the server applies when the campaign closes, and shows only the caller's own amounts", async () => {
    const helios = await corp({ standing: { [EA]: 25 } }), kestrel = await corp({ standing: { [EA]: 8 } });
    const seen = (await helios.api.get(`/api/accounts/${helios.id}/lobbying`)).body;
    const alpha = seen.systems.find((s) => s.id === ALPHA);
    expect(alpha.values.tariffCapPct).toMatchObject({ base: 3, inForce: 3, lobbyable: true, campaign: null });
    expect(seen.systems.find((s) => s.id === "procyon").values.tariffCapPct.lobbyable).toBe(false);
    expect(seen.systems.some((s) => s.id === "sol")).toBe(false); // never concedable: not offered
    for (const credits of [5_000, 10_000, 15_000, 30_000]) {
      const p = preview(alpha.values.tariffCapPct.base, "raise", credits, 0, seen.parameters.tariffCapPct, seen.terms.creditsPerStandingPoint);
      const T = Date.now() - 73 * H;
      const opened = openCampaign(helios.corp, { parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" }, T);
      pledge(helios.corp, opened.campaign.id, { side: "for", credits }, T + H);
      lobbyingTick(Date.now());
      expect(parameterInForce(ALPHA, "tariffCapPct"), `${credits}`).toBe(p.to);
      resetLobbying();
      helios.corp.standing[EA] = 25;
    }
    // the register: Kestrel sees Helios's side, and its own amount, never Helios's
    const id = openCampaign(helios.corp, { parameter: "tariffCapPct", systemId: ALPHA, direction: "raise" }).campaign.id;
    pledge(helios.corp, id, { side: "for", credits: 15_000 });
    pledge(kestrel.corp, id, { side: "against", credits: 4_000 });
    const k = (await kestrel.api.get(`/api/accounts/${kestrel.id}/lobbying`)).body.campaigns.find((c) => c.id === id);
    expect(k).toMatchObject({ systemName: "Alpha Centauri", openedByYou: false, own: [expect.objectContaining({ side: "against", credits: 4_000 })] });
    expect(k.pledgers).toEqual(expect.arrayContaining([expect.objectContaining({ side: "for" }), expect.objectContaining({ side: "against" })]));
    expect(JSON.stringify(k)).not.toContain("15000");
    expect((await kestrel.api.get(`/api/accounts/${helios.id}/lobbying`)).status).toBe(403);
  });
});
