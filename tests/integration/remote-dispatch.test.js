import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { getState } from "../../server/gameState.js";
import { BELT_KEYS } from "../../server/game/asteroids.js";
import { beltAt, isBeltPresent, recordBeltScouted } from "../../server/game/belts.js";
import { RESEARCH_LIBRARY } from "../../server/game/catalog.js";
import { answerInvitation, findConglomerate, inviteCorporation } from "../../server/game/membership.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";
import { asteroidExpeditionTick } from "../../server/ticks.js";

// Bug #4656: shared intel pays. A member may launch to a belt a partner scouted from any system its research reaches;
// the probe brings home remoteDispatchYieldPct of what it mines. Without a partner's scouting, or without the reach, the
// old rule stands: be in the system.
const DAY = 86_400_000;
let seq = 0;
afterEach(() => vi.useRealTimers());

/** A present belt outside Sol, and its system. */
function farBelt() {
  const state = getState();
  const belt = BELT_KEYS.filter((k) => !k.startsWith("sol:")).map((k) => beltAt(state, k)).find(isBeltPresent);
  expect(belt, "a present belt outside Sol").toBeTruthy();
  return belt;
}

async function prospector({ reach = true, systemId = "sol" } = {}) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  const corp = raw.state.corp;
  corp.unlockedTech = reach ? Object.keys(RESEARCH_LIBRARY) : [...new Set([...(corp.unlockedTech || []), "tt-asteroid-prospecting"])];
  corp.asteroidMining = { ...(corp.asteroidMining || {}), probeCount: 3, maxDeployments: 5, activeExpeditions: [] };
  corp.currentSystemId = systemId;
  corp.finances.credits = 1_000_000;
  return { id: reg.account.id, raw, corp, corpId: corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}

async function partners(memberOptions) {
  const belt = farBelt();
  const f = await prospector({ systemId: belt.key.split(":")[0] });
  f.raw.createdAt = Date.now() - 8 * DAY;
  f.corp.currentStationId = C.charterStationId; // the charter is filed at the Bureau
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Relay ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const c = findConglomerate(res.body.conglomerate.id);
  const m = await prospector(memberOptions);
  const inv = inviteCorporation(f.id, c.id, m.corpId);
  expect(answerInvitation(m.id, c.id, inv.invitation.id, "accept").refused).toBeUndefined();
  recordBeltScouted(f.corp.asteroidMining, belt);
  return { f, m, belt };
}
const launch = (p, belt) => p.api.post(`${p.base}/gameplay/launch-expedition`).send({ beltKey: belt.key, duration: "standard" });
const total = (yields) => Object.values(yields || {}).reduce((a, q) => a + q, 0);

describe("remote launch on a partner's scouting (Bug #4656)", () => {
  it("a member in Sol launches to a partner-scouted belt in another system, and brings home the remote share", async () => {
    const { f, m, belt } = await partners();
    expect(m.corp.currentSystemId).not.toBe(belt.key.split(":")[0]);
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const remote = await launch(m, belt);
    expect(remote.status, JSON.stringify(remote.body)).toBe(200);
    expect(remote.body.state.corp.asteroidMining.activeExpeditions.at(-1)).toMatchObject({ beltKey: belt.key, sharedIntel: true, remote: true, remoteYieldPct: C.remoteDispatchYieldPct });
    const local = await launch(f, belt); // the partner, in the system, the same moment
    expect(local.status).toBe(200);
    vi.setSystemTime(t0 + 11_000); // dev durations: 10 seconds
    asteroidExpeditionTick(t0 + 11_000);
    const done = (p) => p.raw.state.corp.asteroidMining.completedExpeditions.at(-1);
    expect(done(m)).toMatchObject({ remote: true, sharedIntel: true }); // kept through the tick's normalization
    // Bug #4752: the belt has Rats, and an encounter on either probe (seeded by its id, so a different one each run)
    // takes part of that probe's haul; the share is of what each probe mined, so what the Rats took is added back
    const mined = (e) => total(e.yields) + (e.rats?.encounters || []).reduce((sum, enc) => sum + total(enc.haulLost), 0);
    const ratio = mined(done(m)) / mined(done(f));
    expect(ratio).toBeGreaterThan(C.remoteDispatchYieldPct / 100 - 0.03);
    expect(ratio).toBeLessThan(C.remoteDispatchYieldPct / 100 + 0.03);
  });

  it("the belt list tells the client the remote share", async () => {
    const { m } = await partners();
    expect((await m.api.get(`${m.base}/gameplay/belt-compositions`)).body.remoteDispatchYieldPct).toBe(C.remoteDispatchYieldPct);
  });

  it("a member whose research does not reach the system is refused, and so is a corporation that scouted it itself but left", async () => {
    const { m, belt } = await partners({ reach: false });
    const refused = await launch(m, belt);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/research does not reach/);

    const loner = await prospector();
    recordBeltScouted(loner.corp.asteroidMining, belt); // scouted on an earlier visit; intel is a partner's, not one's own
    const away = await launch(loner, belt);
    expect(away.status).toBe(400);
    expect(away.body.error).toMatch(/same system/i);
  });
});
