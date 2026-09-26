import request from "supertest";
import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { stationHops, transferFee, transitMinutes } from "../../public/scripts/logistics.js";
import { navigationFor } from "../../public/scripts/navigation.js";

// AB#718: the transfer fee grows with distance. The Logistics tab quotes it from the rates GET /api/stations sends,
// with the shared function, and the server charges exactly that. Nothing the client sends sets the fee.
async function corpAtEarthWithStock() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "mars-orbital-dock": { Silicates: 120 }, "kestrel-platform": { Silicates: 100, Nickel: 30 }, "earth-station-prime": {} };
    state.corp.finances.credits = 10_000;
    state.corp.finances.expensesByCategory = {};
  });
  const corp = () => getAccountById(account.id).state.corp;
  const transfer = (body) => authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/transfer-resources`).send(body);
  const set = (fn) => mutateAccountState(account.id, (state) => fn(state.corp));
  return { app, corp, transfer, set };
}
const snapshot = (corp) => JSON.stringify({ inv: corp.inventory, credits: corp.finances.credits, history: corp.logisticsHistory || [] });

describe("transfer fees by distance (AB#718)", () => {
  it("charges what the Logistics tab quotes, within Sol and across three jumps", async () => {
    const { app, corp, transfer } = await corpAtEarthWithStock();
    const catalog = (await request(app).get("/api/stations")).body;
    // ISP-112 (AB#804): the routes the page counts jumps on, from the catalog route it loads them from.
    const navigation = navigationFor((await request(app).get("/api/systems")).body.systems);
    expect(catalog.logistics).toEqual({ sameSystemFeePerUnit: 2, perJumpFeePerUnit: 3, sameSystemTransitMinutes: 30, perJumpTransitMinutes: 120 });
    // The quote, computed the way the Logistics tab computes it.
    const quote = (from, units) => transferFee(catalog.logistics, stationHops(catalog.stations, from, "earth-station-prime", navigation), [{ quantity: units }]);
    expect(quote("mars-orbital-dock", 120)).toBe(240);
    expect(quote("kestrel-platform", 130)).toBe(1430);
    // ISP-279 (AB#986): the quoted arrival time, computed the same way the Logistics tab computes it.
    const quoteMinutes = (from) => transitMinutes(catalog.logistics, stationHops(catalog.stations, from, "earth-station-prime", navigation));
    expect(quoteMinutes("mars-orbital-dock")).toBe(30); // same system: sameSystemTransitMinutes
    expect(quoteMinutes("kestrel-platform")).toBe(390); // 3 jumps: 30 + 120*3

    const dispatchedAt1 = Date.now();
    expect((await transfer({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 120 }] })).status).toBe(200);
    expect(corp().finances.credits).toBe(10_000 - 240);
    const dispatchedAt2 = Date.now();
    expect((await transfer({ fromStationId: "kestrel-platform", lines: [{ item: "Silicates", quantity: 100 }, { item: "Nickel", quantity: 30 }] })).status).toBe(200);
    const c = corp();
    expect(c.finances.credits).toBe(10_000 - 240 - 1430);
    expect(c.finances.expensesByCategory["transfer-fees"]).toBe(1670);
    // AB#985: the fee is charged at dispatch, but delivery is a shipment that arrives on a later tick.
    const marsShipment = c.shipments.find((s) => s.fromStationId === "mars-orbital-dock");
    const kestrelShipment = c.shipments.find((s) => s.fromStationId === "kestrel-platform");
    expect(marsShipment).toMatchObject({ toStationId: "earth-station-prime", fee: 240 });
    expect(kestrelShipment).toMatchObject({ toStationId: "earth-station-prime", fee: 1430 });
    // The server's arrival time equals the quote (within a second of scheduling jitter either side).
    expect(marsShipment.arrivesAt - marsShipment.dispatchedAt).toBe(quoteMinutes("mars-orbital-dock") * 60_000);
    expect(kestrelShipment.arrivesAt - kestrelShipment.dispatchedAt).toBe(quoteMinutes("kestrel-platform") * 60_000);
    expect(marsShipment.dispatchedAt).toBeGreaterThanOrEqual(dispatchedAt1);
    expect(kestrelShipment.dispatchedAt).toBeGreaterThanOrEqual(dispatchedAt2);
    expect(c.inventory["earth-station-prime"]).toEqual({});
    expect(c.inventory["mars-orbital-dock"]).toEqual({});
    expect(c.inventory["kestrel-platform"]).toEqual({});
  });

  it("a fee, a price or a distance in the request changes nothing: the server computes them from the two stations", async () => {
    const { corp, transfer } = await corpAtEarthWithStock();
    const res = await transfer({ fromStationId: "kestrel-platform", fee: 0, hops: 0, feePerUnit: 0, toStationId: "kestrel-platform", lines: [{ item: "Nickel", quantity: 10, fee: 0 }] });
    expect(res.status).toBe(200);
    expect(corp().finances.credits).toBe(10_000 - 110);
    expect(corp().shipments[0]).toMatchObject({ toStationId: "earth-station-prime", fee: 110 });
  });

  it("refuses an unknown station, a fraction, more than is held, a huge number and an unpayable fee, changing nothing", async () => {
    const { corp, transfer, set } = await corpAtEarthWithStock();
    const before = snapshot(corp());
    for (const [body, error] of [
      [{ fromStationId: "nowhere", lines: [{ item: "Silicates", quantity: 1 }] }, /source station does not exist/],
      [{ fromStationId: "__proto__", lines: [{ item: "Silicates", quantity: 1 }] }, /source station does not exist/],
      [{ fromStationId: "kestrel-platform", lines: [{ item: "Silicates", quantity: 2.5 }] }, /whole number of at least 1/],
      [{ fromStationId: "kestrel-platform", lines: [{ item: "Silicates", quantity: "10" + "0".repeat(400) }] }, /holds 100 Silicates|whole number/],
      [{ fromStationId: "kestrel-platform", lines: [{ item: "Silicates", quantity: 1e21 }] }, /holds 100 Silicates|whole number/],
      [{ fromStationId: "kestrel-platform", lines: [{ item: "Silicates", quantity: 101 }] }, /holds 100 Silicates; you asked to move 101/]
    ]) {
      const res = await transfer(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body.error).toMatch(error);
    }
    set((c) => { c.finances.credits = 500; });
    const poor = snapshot(corp());
    const res = await transfer({ fromStationId: "kestrel-platform", lines: [{ item: "Silicates", quantity: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("The fee is 1,100 credits (11 per unit for 100 units, 3 jumps); you have 500. Move fewer units or sell goods first.");
    expect(snapshot(corp())).toBe(poor);
    expect(JSON.parse(before).inv).toEqual(JSON.parse(poor).inv);
  });
});
