import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed, longLivedAccessToken } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// ISP-279 (AB#986): the Logistics tab moves a shipment to history (or shows it held) with no reload. The socket
// event is the mechanism: logistics:arrived, per account, the same shape travel:arrived already uses for travel.
let url, server, mod;
const sockets = [];

beforeAll(async () => {
  mod = await getApp();
  ({ server } = mod);
  url = await serverUrl();
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});
afterEach(() => {
  vi.useRealTimers();
});

async function corpAtEarthWithMarsStock() {
  const { app } = await getApp();
  const { account } = await registerAccount(app);
  const accessToken = await longLivedAccessToken(account.id); // AB#2294: outlives the clock moves below
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "mars-orbital-dock": { Silicates: 50 } };
    state.corp.finances.credits = 10_000;
  });
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  return { id: account.id, token: accessToken, api, corp };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return s;
}

/**
 * Listens on every `sockets` for `event`, runs `tick` (a ticker function called under fake time the caller has
 * already fast-forwarded to), then switches to real timers and waits `ms` for socket.io to actually deliver what
 * the tick already emitted. Real and fake timers are never active in more than one place at once here: switching
 * to real time before the tick runs would revert Date.now() to the real wall clock first, undoing the
 * fast-forward the tick needs to see, so the switch happens only after the tick has already run.
 */
async function heardOnEach(socketList, event, tick, ms = 300) {
  const heard = socketList.map(() => []);
  const handlers = socketList.map((s, i) => {
    const on = (payload) => heard[i].push(payload);
    s.on(event, on);
    return on;
  });
  await tick();
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, ms));
  socketList.forEach((s, i) => s.off(event, handlers[i]));
  return heard;
}

describe("logistics:arrived (ISP-279, AB#986)", () => {
  it("fires only for the shipment's own account, on delivery", async () => {
    const a = await corpAtEarthWithMarsStock();
    const b = await corpAtEarthWithMarsStock();
    const [sa, sb, anon] = [await socket(a.token), await socket(b.token), await socket()];

    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    await a.api.post(`/api/accounts/${a.id}/gameplay/transfer-resources`).send({ fromStationId: "mars-orbital-dock", lines: [{ item: "Silicates", quantity: 10 }] });
    const shipmentId = a.corp().shipments[0].id;
    vi.setSystemTime(start + 30 * 60_000); // sameSystemTransitMinutes

    const [gotA, gotB, gotAnon] = await heardOnEach([sa, sb, anon], "logistics:arrived", () => mod.shipmentTick());
    expect(gotA).toEqual([{ accountId: a.id, shipmentId, delivered: true }]);
    expect(gotB).toEqual([]);
    expect(gotAnon).toEqual([]);
  });

  it("fires with delivered: false when the shipment is held, not delivered", async () => {
    const a = await corpAtEarthWithMarsStock();
    const sa = await socket(a.token);
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    mutateAccountState(a.id, (state) => {
      state.corp.shipments = [{
        id: "shp-held-socket-test", fromStationId: "mars-orbital-dock", toStationId: "decommissioned-station",
        lines: [{ item: "Silicates", quantity: 10 }], fee: 20, dispatchedAt: start, arrivesAt: start + 1000, status: "in-transit"
      }];
    });
    vi.setSystemTime(start + 2000);

    const [got] = await heardOnEach([sa], "logistics:arrived", () => mod.shipmentTick());
    expect(got).toEqual([{ accountId: a.id, shipmentId: "shp-held-socket-test", delivered: false }]);
  });
});
