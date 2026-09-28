import { describe, it, expect, afterAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, listAccountMessages, listAccountNotifications, mutateAccountState, mutateState } from "../../server/gameState.js";
import { asteroidExpeditionTick } from "../../server/ticks.js";
import { beltRespawnTick, ensureBeltState } from "../../server/game/belts.js";

// AB#2330: expeditions mine the belt in the world state, out of a reserve every corporation on it shares; the tick that
// empties it ends every expedition on it, and the slot stays empty, unscouted by anyone, until a new generation forms.
// In a test the durations are the dev ones: a Standard Survey lasts 10 seconds and yields about 180 units.
const BELT = "sol:belt";
const belt = () => getState().belts[BELT];
const setRemaining = (n) => mutateState((w) => { w.belts[BELT].remaining = n; });
const total = (yields) => Object.values(yields || {}).reduce((a, b) => a + b, 0);

async function corp() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const api = authed(app, accessToken);
  mutateAccountState(account.id, (s) => {
    s.corp.finances.credits = 100_000;
    s.corp.unlockedTech = [...(s.corp.unlockedTech || []), "tt-asteroid-prospecting"];
    s.corp.currentStationId = "earth-station-prime";
    s.corp.currentSystemId = "sol";
    s.corp.asteroidMining = { probeCount: 2, maxDeployments: 2, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [], scoutedBelts: [] };
  }, { sanitize: false, settleMining: false });
  const post = (path, body) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
  const am = () => getAccountById(account.id).state.corp.asteroidMining;
  return {
    id: account.id, am,
    scout: () => post("scout-belt", { beltKey: BELT }),
    launch: () => post("launch-expedition", { beltKey: BELT, duration: "standard" }),
    compositions: () => api.get(`/api/accounts/${account.id}/gameplay/belt-compositions`),
    credits: () => getAccountById(account.id).state.corp.finances.credits,
    ore: () => total(getAccountById(account.id).state.corp.inventory?.["earth-station-prime"]),
    mined: () => total(am().activeExpeditions[0]?.yields) + am().completedExpeditions.reduce((s, e) => s + total(e.yields), 0),
    // Bug AB#4778: Sol has Rats (pirateDensity 11) and these probes fly unescorted, so an encounter can take part of the
    // haul after the belt has paid for it. What the belt lost is what the probes hold plus what the Rats took.
    raided: () => [...am().activeExpeditions, ...am().completedExpeditions].flatMap((e) => e.rats?.encounters || []).reduce((s, r) => s + total(r.haulLost), 0)
  };
}

/** Everything the corporations drew from the belt: what they carry and what Rats took from them on the way. */
const drawn = (...corps) => corps.reduce((s, c) => s + c.mined() + c.raided(), 0);

afterAll(() => mutateState((w) => { delete w.belts[BELT]; ensureBeltState(w); }));

describe("belts run out, and expeditions with them (AB#2330)", () => {
  it("two corporations share one belt's reserve exactly; the tick that empties it ends both, and the slot stays empty until it respawns", async () => {
    mutateState((w) => { delete w.belts[BELT]; ensureBeltState(w); });
    const a = await corp();
    const b = await corp();
    for (const c of [a, b]) {
      expect((await c.scout()).status).toBe(200);
      expect((await c.launch()).status).toBe(200);
      expect(c.am().activeExpeditions[0].generation).toBe(1);
    }
    const t0 = Math.max(a.am().activeExpeditions[0].deployedAt, b.am().activeExpeditions[0].deployedAt);
    const credits = [a.credits(), b.credits()];
    const ore = [a.ore(), b.ore()];

    // A tick the belt can afford: what both took is exactly what it lost.
    setRemaining(1000);
    asteroidExpeditionTick(t0 + 2000);
    expect(a.mined()).toBeGreaterThan(0);
    expect(b.mined()).toBeGreaterThan(0);
    expect(drawn(a, b), `carried ${a.mined() + b.mined()}, taken by Rats ${a.raided() + b.raided()}`).toBe(1000 - belt().remaining);

    // A tick it cannot: they take what is left, no more, and both come home now, seven seconds early.
    const drawnBefore = drawn(a, b);
    setRemaining(5);
    asteroidExpeditionTick(t0 + 4000);
    expect(drawn(a, b)).toBe(drawnBefore + 5);
    expect(belt()).toMatchObject({ remaining: 0, emptiedAt: t0 + 4000, generation: 1 });
    for (const [i, c] of [a, b].entries()) {
      const am = c.am();
      expect(am.activeExpeditions).toEqual([]);
      expect(am.probeCount).toBe(2); // the probe is back
      const [done] = am.completedExpeditions;
      expect(done.endedEarly).toMatchObject({ reason: "belt-depleted", at: t0 + 4000 });
      expect(c.ore() - ore[i]).toBe(total(done.yields)); // what it carried is deposited
      expect(c.credits()).toBe(credits[i]); // the launch cost is not refunded
      expect(am.scoutedBelts).not.toContain(BELT);
      const note = listAccountNotifications(c.id).notifications.find((n) => n.title === "Expedition Ended Early");
      expect(note?.body).toMatch(/The belt was mined out, so the probe came home \d+ minutes? early\. The launch fee is not refunded\./);
      const report = listAccountMessages(c.id).find((m) => m.subject.startsWith("Mining Probe Return"));
      expect(report?.body).toMatch(/cut short \d+ minute\(s\) before its scheduled return: the belt was mined out/);
    }

    // The empty slot: nothing to scout or launch at, and the refusal says when the next chance is.
    const nextHour = new Date(Math.floor((t0 + 4000) / 3_600_000) * 3_600_000 + 3_600_000).getUTCHours();
    for (const res of [await a.launch(), await a.scout()]) {
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(`This belt has been mined out. An empty belt has a 20% chance of forming anew each hour on the hour; the next chance is at ${String(nextHour).padStart(2, "0")}:00 UTC.`);
    }
    expect(a.am().probeCount).toBe(2);
    expect(a.credits()).toBe(credits[0]);

    // A new generation is unscouted for everyone; scouting it shows its own composition, and a launch mines it.
    let spawned;
    mutateState((w) => { [spawned] = beltRespawnTick(w, t0 + 4 * 3_600_000, () => 0); });
    expect(spawned.generation).toBe(2);
    expect((await b.compositions()).body.compositions).toEqual({});
    expect((await b.scout()).status).toBe(200);
    expect((await b.compositions()).body.compositions[BELT]).toEqual(spawned.composition);
    expect((await b.launch()).status).toBe(200);
    expect(b.am().activeExpeditions[0].generation).toBe(2);
  });

  it("an expedition left over from an earlier generation comes home at the next tick, carrying only what it had", async () => {
    mutateState((w) => { delete w.belts[BELT]; ensureBeltState(w); w.belts[BELT].generation = 3; });
    const c = await corp();
    const now = Date.now();
    mutateAccountState(c.id, (s) => {
      s.corp.asteroidMining.probeCount = 1;
      s.corp.asteroidMining.activeExpeditions = [{ id: "exp-old", beltKey: BELT, systemId: "sol", duration: "standard", generation: 2,
        deployedAt: now, lastTickAt: now, completesAt: now + 10_000, yields: { Nickel: 12 }, status: "active" }];
    }, { sanitize: false, settleMining: false });
    const before = belt().remaining;
    asteroidExpeditionTick(now + 3000);
    const [done] = c.am().completedExpeditions;
    expect(done).toMatchObject({ id: "exp-old", yields: { Nickel: 12 }, endedEarly: { reason: "belt-depleted" } });
    expect(c.am().probeCount).toBe(2);
    expect(belt().remaining).toBe(before); // it took nothing from the belt there now
  });
});
