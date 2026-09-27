import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { getState } from "../../server/gameState.js";
import { BELT_KEYS } from "../../server/game/asteroids.js";
import { beltAt, isBeltPresent, recordBeltScouted } from "../../server/game/belts.js";
import { answerInvitation, findConglomerate, inviteCorporation, leaveConglomerate } from "../../server/game/membership.js";

// ISP-207 (AB#902): intel shared inside a conglomerate. A member can launch an expedition to a belt only a partner
// scouted, and a non-member cannot; leaving ends it on the next request; the intel read carries only the fields the
// design lists, and anyone who is not a current member gets 403 and nothing.
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

/** A present belt in Sol, where registered corporations start. */
function solBelt() {
  const state = getState();
  const belt = BELT_KEYS.filter((k) => k.startsWith("sol:")).map((k) => beltAt(state, k)).find(isBeltPresent);
  expect(belt, "a present belt in Sol").toBeTruthy();
  return belt;
}

/** A registered corporation ready to launch expeditions: the research, probes and credits, in Sol. */
async function prospector() {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  const corp = raw.state.corp;
  corp.unlockedTech = [...new Set([...(corp.unlockedTech || []), "tt-asteroid-prospecting"])];
  corp.asteroidMining = { ...(corp.asteroidMining || {}), probeCount: 3, maxDeployments: 5, activeExpeditions: [] };
  corp.currentSystemId = "sol";
  corp.finances.credits = 1_000_000;
  return { id: reg.account.id, raw, corp, corpId: corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}

/** A founder and one member, in one conglomerate. */
async function partners() {
  const f = await prospector();
  f.raw.createdAt = Date.now() - 8 * DAY;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Survey ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
  expect(res.status).toBe(201);
  const c = findConglomerate(res.body.conglomerate.id);
  const m = await prospector();
  const inv = inviteCorporation(f.id, c.id, m.corpId);
  expect(answerInvitation(m.id, c.id, inv.invitation.id, "accept").refused).toBeUndefined();
  return { f, m, c, intel: (p) => `${p.base}/conglomerates/${c.id}/intel` };
}

const launch = (p, belt) => p.api.post(`${p.base}/gameplay/launch-expedition`).send({ beltKey: belt.key, duration: "short" });

describe("a partner's scouting is a member's dispatch target (ISP-207, AB#902)", () => {
  it("a member launches to a belt only its partner scouted, and the expedition is marked as sent on shared intel", async () => {
    const { f, m } = await partners();
    const belt = solBelt();
    recordBeltScouted(f.corp.asteroidMining, belt);
    const res = await launch(m, belt);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.state.corp.asteroidMining.activeExpeditions.at(-1)).toMatchObject({ beltKey: belt.key, sharedIntel: true });
    // The dispatch screen shows the composition, and who scouted it.
    const seen = (await m.api.get(`${m.base}/gameplay/belt-compositions`)).body;
    expect(seen.belts[belt.key]).toMatchObject({ scouted: true, sharedBy: [f.corp.corporationName], composition: belt.composition });
    expect(seen.compositions[belt.key]).toEqual(belt.composition);
  });

  it("a corporation in no conglomerate cannot", async () => {
    const f = await prospector();
    const loner = await prospector();
    const belt = solBelt();
    recordBeltScouted(f.corp.asteroidMining, belt);
    const res = await launch(loner, belt);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/has not been scouted/);
    expect((await loner.api.get(`${loner.base}/gameplay/belt-compositions`)).body.belts[belt.key].scouted).toBe(false);
  });

  it("leaving ends it on the next request, both ways", async () => {
    const { f, m, c, intel } = await partners();
    const belt = solBelt();
    recordBeltScouted(f.corp.asteroidMining, belt);
    expect((await m.api.get(intel(m))).status).toBe(200);
    expect(leaveConglomerate(m.id, c.id).refused).toBeUndefined();
    const res = await launch(m, belt);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/has not been scouted/);
    expect((await m.api.get(`${m.base}/gameplay/belt-compositions`)).body.belts[belt.key].scouted).toBe(false);
    const after = await m.api.get(intel(m));
    expect(after.status).toBe(403);
    expect(after.body).toMatchObject({ code: "not-a-member", belts: [], listings: [] });
  });

  it("a leaver's own scouting leaves with it: its former partners lose the belt on their next request", async () => {
    const { f, m, c } = await partners();
    const belt = solBelt();
    recordBeltScouted(m.corp.asteroidMining, belt); // only the member scouted it
    expect((await f.api.get(`${f.base}/gameplay/belt-compositions`)).body.belts[belt.key]).toMatchObject({ scouted: true, sharedBy: [m.corp.corporationName] });
    expect(leaveConglomerate(m.id, c.id).refused).toBeUndefined();
    expect((await f.api.get(`${f.base}/gameplay/belt-compositions`)).body.belts[belt.key].scouted).toBe(false);
    expect((await launch(f, belt)).body.error).toMatch(/has not been scouted/);
    expect((await launch(m, belt)).status).toBe(200); // it keeps what it scouted itself
  });
});

describe("the intel read (ISP-207, AB#902)", () => {
  it("carries only the design's fields: no account id, credits or inventory", async () => {
    const { f, m, intel } = await partners();
    const belt = solBelt();
    recordBeltScouted(f.corp.asteroidMining, belt);
    const book = getState().market.orderBook;
    const outsider = await prospector();
    book.unshift(
      { id: `ord-intel-${seq}-a`, type: "sell", item: "Silicates", quantity: 40, unitPrice: 27, seller: f.corp.corporationName, sellerAccountId: f.id, stationId: "earth-station-prime", createdAt: Date.now() },
      { id: `ord-intel-${seq}-b`, type: "sell", item: "Silicates", quantity: 10, unitPrice: 25, seller: m.corp.corporationName, sellerAccountId: m.id, stationId: "earth-station-prime", createdAt: Date.now() },
      { id: `ord-intel-${seq}-c`, type: "sell", item: "Silicates", quantity: 99, unitPrice: 20, seller: outsider.corp.corporationName, sellerAccountId: outsider.id, stationId: "earth-station-prime", createdAt: Date.now() }
    );
    const res = await m.api.get(intel(m));
    expect(res.status).toBe(200);
    const b = res.body.belts.find((x) => x.key === belt.key);
    expect(Object.keys(b).sort()).toEqual(["composition", "generation", "key", "rarity", "remaining", "reserve", "scoutedBy", "scoutedByYou"]);
    expect(b.scoutedBy).toEqual([f.corp.corporationName]);
    const silicates = res.body.listings.find((x) => x.item === "Silicates");
    expect(silicates.listings.map((l) => [l.seller, l.unitPrice, l.mine])).toEqual([[m.corp.corporationName, 25, true], [f.corp.corporationName, 27, false]]);
    expect(silicates.lowest).toBe(25);
    for (const l of silicates.listings) expect(Object.keys(l).sort()).toEqual(["item", "listedAt", "mine", "quantity", "seller", "unitPrice"]);
    const text = JSON.stringify(res.body);
    for (const who of [f, m, outsider]) expect(text).not.toContain(who.id);
    expect(text).not.toContain(outsider.corp.corporationName); // not a member: its listing is not intel
    expect(text).not.toMatch(/credits|inventory|finances|stationId|sellerAccountId|email/);
    getState().market.orderBook = book.filter((o) => !String(o.id).startsWith(`ord-intel-${seq}`));
  });

  it("answers 403 and nothing to another conglomerate's member and to a corporation in none", async () => {
    const [g, h] = [await partners(), await partners()];
    const loner = await prospector();
    for (const [p, url] of [[h.m, `${h.m.base}/conglomerates/${g.c.id}/intel`], [loner, `${loner.base}/conglomerates/${g.c.id}/intel`], [loner, `${loner.base}/conglomerates/cgl-does-not-exist/intel`]]) {
      const res = await p.api.get(url);
      expect(res.status, url).toBe(403);
      expect(res.body).toEqual({ error: "Only a conglomerate's current members see its intel.", code: "not-a-member", belts: [], listings: [] });
    }
  });
});
