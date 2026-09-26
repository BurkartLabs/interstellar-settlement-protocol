import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState, mutateState } from "../../server/gameState.js";
import { asteroidExpeditionTick, beltTick } from "../../server/ticks.js";
import { ensureBeltState } from "../../server/game/belts.js";

// AB#2331: GET .../belt-compositions tells a corporation about every belt slot: whether a belt is there, its generation
// and, when empty, the next hourly draw; its rarity, composition and reserve only when it scouted this generation.
// Scouting is of a generation, so a respawned belt is unscouted even for a corporation whose key list still names it.
// A slot that empties or fills is broadcast (belts:changed, keys only) so an open panel refetches.
const BELT = "sol:belt";
const HOUR = 3_600_000;
let app, url;
const sockets = [];
beforeAll(async () => {
  ({ app } = await getApp());
  url = await serverUrl();
});
afterAll(() => {
  for (const s of sockets) s.close();
  mutateState((w) => { delete w.belts[BELT]; ensureBeltState(w); });
});

async function corp() {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.finances.credits = 100_000;
    s.corp.unlockedTech = [...(s.corp.unlockedTech || []), "tt-asteroid-prospecting"];
    s.corp.currentSystemId = "sol";
    s.corp.currentStationId = "earth-station-prime";
    s.corp.asteroidMining = { probeCount: 1, maxDeployments: 1, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [], scoutedBelts: [] };
  }, { sanitize: false, settleMining: false });
  const api = authed(app, accessToken);
  return {
    id: account.id, token: accessToken,
    scout: () => api.post(`/api/accounts/${account.id}/gameplay/scout-belt`).send({ beltKey: BELT }),
    launch: () => api.post(`/api/accounts/${account.id}/gameplay/launch-expedition`).send({ beltKey: BELT, duration: "standard" }),
    slots: async () => (await api.get(`/api/accounts/${account.id}/gameplay/belt-compositions`)).body
  };
}

async function listen(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token } });
  sockets.push(s);
  const heard = [];
  s.onAny((event, payload) => heard.push({ event, payload }));
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return heard;
}
const heardBelts = async (heard, n) => {
  for (let i = 0; i < 60 && heard.filter((h) => h.event === "belts:changed").length < n; i++) await new Promise((r) => setTimeout(r, 50));
  return heard.filter((h) => h.event === "belts:changed").map((h) => h.payload);
};

describe("belt slots, as each corporation may see them (AB#2331)", () => {
  it("an unscouted belt shows only that it is there; a scouted one its rarity, composition and reserve", async () => {
    mutateState((w) => { delete w.belts[BELT]; ensureBeltState(w); });
    const c = await corp();
    let body = await c.slots();
    expect(body.respawnChancePerHour).toBe(0.2);
    expect(Object.keys(body.belts).length).toBe(body.allBeltKeys.length);
    expect(body.belts[BELT]).toEqual({ key: BELT, generation: 1, present: true, scouted: false, nextDrawAt: null });
    expect(body.compositions).toEqual({});

    expect((await c.scout()).status).toBe(200);
    body = await c.slots();
    const belt = getState().belts[BELT];
    expect(body.belts[BELT]).toEqual({ key: BELT, generation: 1, present: true, scouted: true, nextDrawAt: null,
      rarity: belt.rarity, composition: belt.composition, reserve: belt.reserve, remaining: belt.remaining });
    expect(body.compositions).toEqual({ [BELT]: belt.composition });
    expect(getAccountById(c.id).state.corp.asteroidMining.scoutedGenerations).toEqual({ [BELT]: 1 });
  });

  it("an emptied slot says when its next draw is, is broadcast by key, and its respawn is unscouted even to a key list that still names it", async () => {
    mutateState((w) => { delete w.belts[BELT]; ensureBeltState(w); });
    const c = await corp();
    const other = await corp();
    const heard = await listen(other.token); // not mining here: every socket hears which slots changed
    expect((await c.scout()).status).toBe(200);
    expect((await c.launch()).status).toBe(200);

    const t = Date.now() + 2000;
    mutateState((w) => { w.belts[BELT].remaining = 3; });
    asteroidExpeditionTick(t);
    expect(await heardBelts(heard, 1)).toEqual([{ keys: [BELT] }]);
    const empty = (await c.slots()).belts[BELT];
    expect(empty).toEqual({ key: BELT, generation: 1, present: false, scouted: false, nextDrawAt: Math.floor(t / HOUR) * HOUR + HOUR });

    // A new generation, and a corporation whose key list still names the belt (as one saved before AB#2330's stripping
    // would): it is unscouted, cannot be launched at, and can be scouted afresh.
    mutateAccountState(c.id, (s) => { s.corp.asteroidMining.scoutedBelts = [BELT]; s.corp.asteroidMining.scoutedGenerations = { [BELT]: 1 }; },
      { sanitize: false, settleMining: false });
    const random = Math.random;
    Math.random = () => 0; // the respawn draw hits
    try { beltTick(t + 2 * HOUR); } finally { Math.random = random; }
    expect(await heardBelts(heard, 2)).toEqual([{ keys: [BELT] }, { keys: [BELT] }]);
    expect((await c.slots()).belts[BELT]).toMatchObject({ generation: 2, present: true, scouted: false });
    const refused = await c.launch();
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/has not been scouted/);
    expect((await c.scout()).status).toBe(200);
    expect((await c.slots()).belts[BELT]).toMatchObject({ generation: 2, scouted: true });
    expect(getAccountById(c.id).state.corp.asteroidMining.scoutedGenerations).toEqual({ [BELT]: 2 });
  });
});
