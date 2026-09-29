import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState, mutateState } from "../../server/gameState.js";
import { allStations } from "../../server/game/stations.js";
import { SYSTEMS_BY_ID } from "../../server/game/catalog.js";
import { RATS, encounterChance, forceSupply, ratGroup } from "../../server/game/rats.js";
import { BOUNTY_TAP, HUNT_RATE, declareHunt, huntMs, huntOutcome, huntTick, quietOf, rateFactorFor, resolveHunts } from "../../server/hunts.js";
import { ledgerEntries } from "../../server/settlement.js";
import { declareRaid } from "../../server/raids.js";
import { offerFleet } from "../../server/mercenaries.js";

// ISP-284 (AB#991; docs/design/rats.md section 5): hunting a belt's Rats. A fleet stationed in the belt's system fights
// the belt's group at its base size; a win pays the ISA's bounty through settleTransfer and makes the belt quiet.
const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const WOLF = "wolf-359", WOLF_BELT = "wolf-359:wf-shards";
const stationIn = (systemId) => allStations().find((s) => s.systemId === systemId).id;
const STRONG = { ds: 6, at: 6 }, WEAK = { lf: 4 };
const clearQuiet = () => mutateState((d) => { if (d.rats?.quiet) d.rats.quiet = {}; });

/** A corporation at Wolf 359 with three fleets: a strong one there, the same at Earth, and a weak one there. */
async function hunter(credits = 1_000_000) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const station = stationIn(WOLF);
  mutateAccountState(reg.account.id, (s) => {
    s.corp.finances.credits = credits;
    s.corp.currentSystemId = WOLF;
    s.corp.currentStationId = station;
    s.corp.military = {
      units: { lf: 4, ds: 12, se: 0, at: 12, dt: 0 }, readiness: 100,
      fleets: [
        { id: "flt-a", name: "Aegis", units: { ...STRONG }, stationId: station, transit: null, formedAt: Date.now() },
        { id: "flt-b", name: "Bastion", units: { ...STRONG }, stationId: "earth-station-prime", transit: null, formedAt: Date.now() },
        { id: "flt-c", name: "Corsair", units: { ...WEAK }, stationId: station, transit: null, formedAt: Date.now() }
      ]
    };
  }, { sanitize: false, settleMining: false });
  const api = authed(app, reg.accessToken);
  const at = (p) => `/api/accounts/${reg.account.id}/gameplay${p}`;
  return {
    id: reg.account.id, api, at,
    corp: () => getAccountById(reg.account.id).state.corp,
    state: () => JSON.stringify(getAccountById(reg.account.id).state)
  };
}
const hunt = (h, fleetId, beltKey = WOLF_BELT) => h.api.post(h.at(`/fleets/${fleetId}/hunt`)).send({ beltKey });

describe("the design's arithmetic, fought by the resolver (section 5)", () => {
  // The design's table: fleet, result, units lost, Rats destroyed, bounty and net of provisions, reproduced exactly.
  it.each([
    ["sol", STRONG, "attacker", 946, 9734, 3894, 2048],
    [WOLF, STRONG, "attacker", 8078, 26482, 10593, 1615],
    [WOLF, { ds: 4, at: 4 }, "draw", 12372, 0, 0, -12972],
    ["van-maanens-star", { ds: 8, at: 8 }, "attacker", 14264, 38936, 15574, 110]
  ])("%s with %j: %s, lost %i, destroyed %i, bounty %i, net %i", (system, fleet, winner, lost, destroyed, bounty, net) => {
    const o = huntOutcome(fleet, ratGroup(SYSTEMS_BY_ID.get(system).pirateDensity));
    const provisions = Math.round(RATS.escortCostPerSupplyHour * forceSupply(fleet) * RATS.lengthsHours.standard);
    expect([o.winner, o.lostValue, o.ratsDestroyedValue, o.bounty, o.bounty - o.lostValue - provisions]).toEqual([winner, lost, destroyed, bounty, net]);
  });

  it("the quiet period is what makes a hunt worth it where Rats are many, and not in Sol", () => {
    // An hour's expedition's chance of meeting Rats, before and after a won hunt: the saving grows with the density.
    const saving = (system) => {
      const d = SYSTEMS_BY_ID.get(system).pirateDensity;
      return encounterChance(d, 1, 0) - encounterChance(d, 1, 0, RATS.quietRateFactor);
    };
    expect(saving("sol")).toBeLessThan(0.12);
    expect(saving("van-maanens-star")).toBeGreaterThan(0.3);
    expect(saving("van-maanens-star")).toBeGreaterThan(3 * saving("sol"));
  });

  it("is the same every time for the same fleet and group: the resolver has no chance in it", () => {
    const group = ratGroup(31);
    expect(huntOutcome(STRONG, group)).toEqual(huntOutcome(STRONG, group));
  });
});

describe("declaring a hunt (AB#991)", () => {
  it("charges the provisions and commits the fleet, which then takes no other order until it returns", async () => {
    clearQuiet();
    const h = await hunter();
    const before = h.corp().finances.credits;
    const res = await hunt(h, "flt-a");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hunt).toMatchObject({ fleetId: "flt-a", beltKey: WOLF_BELT, rats: ratGroup(31), provisions: 900 });
    expect(h.corp().finances.credits).toBe(before - 900);
    expect(h.corp().military.fleets.find((f) => f.id === "flt-a").hunt.endsAt - res.body.hunt.declaredAt).toBe(huntMs());

    // cannot escort, deploy, split, merge, be offered, or hunt again
    const escort = await h.api.post(h.at("/launch-expedition")).send({ beltKey: WOLF_BELT, duration: "short", escortFleetId: "flt-a" });
    expect(escort.status).toBe(400);
    const deploy = await h.api.post(h.at("/fleets/flt-a/deploy")).send({ toStationId: "earth-station-prime" });
    expect(deploy.status).toBe(400); // the fleet routes answer every refusal 400
    expect(deploy.body.error).toMatch(/hunting Rats/);
    expect((await h.api.post(h.at("/fleets/flt-a/split")).send({ ds: 1 })).body.error).toMatch(/hunting Rats/);
    expect((await h.api.post(h.at("/fleets/flt-c/merge")).send({ intoFleetId: "flt-a" })).body.error).toMatch(/hunting Rats/);
    expect(offerFleet(h.id, "flt-a", { price: 1000, collateral: 1000, allowedUse: "pve" })).toMatchObject({ ok: false, status: 409 });
    expect((await hunt(h, "flt-a")).body.error).toMatch(/already hunting/);
  });

  it("cannot raid while hunting", async () => {
    clearQuiet();
    const h = await hunter(), target = await hunter();
    expect((await hunt(h, "flt-a")).status).toBe(200);
    const later = Date.now() + 30 * DAY; // past both corporations' new-player protection
    const raid = declareRaid(h.id, { fleetId: "flt-a", targetCorpId: target.corp().publicId, targetStationId: stationIn(WOLF) }, later);
    expect(raid).toMatchObject({ ok: false, status: 409 });
    expect(raid.error).toMatch(/hunting Rats/);
  });

  it("refuses an unknown belt, another corporation's fleet, a fleet elsewhere or an empty purse, and changes nothing", async () => {
    clearQuiet();
    const h = await hunter(), other = await hunter();
    const cases = [
      [h, "flt-a", "nowhere:belt", 400],
      [h, "flt-does-not-exist", WOLF_BELT, 400],
      [other, "flt-a", "sol:belt", 409] // other's own flt-a is at Wolf 359, not Sol
    ];
    for (const [who, fleetId, belt, status] of cases) {
      const before = who.state();
      const res = await hunt(who, fleetId, belt);
      expect(res.status, `${fleetId} ${belt}: ${JSON.stringify(res.body)}`).toBe(status);
      expect(who.state()).toBe(before);
    }
    // another corporation's fleet, by its id: 400, and neither corporation changes
    mutateAccountState(other.id, (s) => { s.corp.military.fleets[0].id = "flt-theirs"; }, { sanitize: false, settleMining: false });
    const beforeMine = h.state(), beforeTheirs = other.state();
    const cross = await hunt(h, "flt-theirs");
    expect(cross.status).toBe(400);
    expect(h.state()).toBe(beforeMine);
    expect(other.state()).toBe(beforeTheirs);
    // a fleet at Earth cannot hunt Wolf 359, and one with nothing to pay provisions with is refused
    expect((await hunt(h, "flt-b")).status).toBe(409);
    const poor = await hunter(100);
    const before = poor.state();
    expect((await hunt(poor, "flt-a")).status).toBe(400);
    expect(poor.state()).toBe(before);
  });

  it(`allows at most ${HUNT_RATE.max} hunts an hour per corporation`, async () => {
    clearQuiet();
    const h = await hunter();
    const now = Date.now();
    mutateAccountState(h.id, (s) => {
      s.corp.military.hunts = Array.from({ length: HUNT_RATE.max }, (_, i) => ({ id: `hunt-old-${i}`, declaredAt: now - 10 * 60_000 }));
    }, { sanitize: false, settleMining: false });
    const before = h.state();
    const res = await hunt(h, "flt-a");
    expect(res.status).toBe(429);
    expect(h.state()).toBe(before);
  });
});

describe("resolving a hunt (injected time)", () => {
  it("a win pays the bounty from the ISA's tap, applies the losses, makes the belt quiet, and brings the fleet back", async () => {
    clearQuiet();
    const h = await hunter();
    const declared = declareHunt(h.id, { fleetId: "flt-a", beltKey: WOLF_BELT });
    expect(declared.ok).toBe(true);
    const due = declared.hunt.endsAt;
    expect(resolveHunts(h.id, due - 1)).toEqual([]); // not yet
    const creditsBefore = h.corp().finances.credits;
    const expected = huntOutcome(STRONG, ratGroup(31));
    const [report] = resolveHunts(h.id, due);
    expect(report).toMatchObject({ outcome: "attacker", bounty: 10593, lostValue: 8078, ratsDestroyedValue: 26482, lost: expected.lost });
    expect(h.corp().finances.credits).toBe(creditsBefore + 10593);
    const entry = ledgerEntries().find((e) => e.key === `hunt:${report.id}:bounty`);
    expect(entry).toMatchObject({ from: BOUNTY_TAP, to: h.id, credits: 10593, reason: "bounty" });
    const fleet = h.corp().military.fleets.find((f) => f.id === "flt-a");
    expect(fleet.hunt).toBeUndefined();
    for (const [id, n] of Object.entries(expected.lost)) expect(fleet.units[id]).toBe(STRONG[id] - n);
    expect(quietOf(WOLF_BELT, due + 23 * HOUR)).toMatchObject({ until: due + RATS.quietHours * HOUR, huntId: report.id });
    expect(quietOf(WOLF_BELT, due + 25 * HOUR)).toBeNull(); // the group regrows after the quiet period
    expect(h.corp().military.hunts[0].id).toBe(report.id);
    expect(resolveHunts(h.id, due + 1000)).toEqual([]); // once only
  });

  it("while a belt is quiet, expeditions launched there meet Rats at a quarter of the rate, and nobody can hunt it", async () => {
    clearQuiet();
    const h = await hunter();
    const declared = declareHunt(h.id, { fleetId: "flt-a", beltKey: WOLF_BELT });
    resolveHunts(h.id, declared.hunt.endsAt);
    expect(rateFactorFor(WOLF_BELT, Date.now())).toBe(RATS.quietRateFactor);
    mutateAccountState(h.id, (s) => {
      s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), "tt-asteroid-prospecting"])];
      s.corp.asteroidMining = { probeCount: 3, maxDeployments: 3, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [], scoutedBelts: [WOLF_BELT], scoutedGenerations: { [WOLF_BELT]: 1 } };
    }, { sanitize: false, settleMining: false });
    const res = await h.api.post(h.at("/launch-expedition")).send({ beltKey: WOLF_BELT, duration: "standard" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rats = h.corp().asteroidMining.activeExpeditions.at(-1).rats;
    expect(rats.rateFactor).toBe(RATS.quietRateFactor);
    expect(rats.chance).toBeCloseTo(encounterChance(31, rats.hours, 0, RATS.quietRateFactor), 10);
    expect(rats.chance).toBeLessThan(encounterChance(31, rats.hours, 0));
    const again = await hunt(h, "flt-c");
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/cleared/);
  });

  it("a draw or a loss pays nothing and leaves the belt as it was; the losses are real", async () => {
    clearQuiet();
    const h = await hunter();
    const declared = declareHunt(h.id, { fleetId: "flt-c", beltKey: WOLF_BELT });
    const creditsBefore = h.corp().finances.credits;
    const [report] = resolveHunts(h.id, declared.hunt.endsAt);
    expect(report.outcome).not.toBe("attacker");
    expect(report.bounty).toBe(0);
    expect(h.corp().finances.credits).toBe(creditsBefore);
    expect(quietOf(WOLF_BELT)).toBeNull();
    expect(Object.values(report.lost).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(h.corp().military.units.lf).toBe(4 - (report.lost.lf || 0));
  });

  it("the ticker resolves every hunt that is due, and only those", async () => {
    clearQuiet();
    const h = await hunter();
    const declared = declareHunt(h.id, { fleetId: "flt-a", beltKey: WOLF_BELT });
    huntTick(declared.hunt.endsAt - 1);
    expect(h.corp().military.fleets.find((f) => f.id === "flt-a").hunt).toBeDefined();
    huntTick(declared.hunt.endsAt);
    expect(h.corp().military.fleets.find((f) => f.id === "flt-a").hunt).toBeUndefined();
    expect(getState().rats.quiet[WOLF_BELT]).toBeDefined();
  });
});
