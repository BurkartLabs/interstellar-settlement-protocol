import { describe, it, expect, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { allStations } from "../../server/game/stations.js";
import { applyAsteroidExpeditions, settleRats } from "../../server/game/asteroids.js";
import { RATS, encounterChance, encounterRate, fightEncounter, forcePower, gatheredGroup, planEncounters, ratGroup, ratsTableProblems, seedFor } from "../../server/game/rats.js";
import { combatModifiersFor } from "../../server/game/combat.js";

// AB#820 (docs/design/rats.md): Rat encounters on the server. The roll is seeded and made on the server; an escort
// fights each encounter through the combat resolver; its losses are real; the outcome is applied once.
const HOUR = 60 * 60 * 1000;
const WOLF = "wolf-359", WOLF_BELT = "wolf-359:wf-shards", DENSITY = 31;
const wolfStation = () => allStations().find((s) => s.systemId === WOLF).id;
const STRONG = { ds: 6, at: 6 }, WEAK = { lf: 4 };

afterEach(() => { delete process.env.ISP_RAT_SEED_SECRET; });

/** An expedition id whose seeded plan meets Rats at least `k` times with this escort. */
function idWithEncounters(escort, k = 1, hours = 2) {
  for (let i = 0; i < 5000; i += 1) {
    const id = `exp-fixture-${i}`;
    if (planEncounters(seedFor(id), DENSITY, hours, forcePower(escort)).length >= k) return id;
  }
  throw new Error("no fixture id");
}
/** A corporation holding one fleet, and an expedition of `id` in flight with it as escort (or none), stamped at `now`. */
function fixture(id, escort, now = Date.now()) {
  const units = escort ? { ...escort } : {};
  const corp = {
    unlockedTech: [],
    military: { units: { lf: 0, ds: 0, se: 0, at: 0, dt: 0, ...units }, readiness: 100, fleets: escort ? [{ id: "flt-escort", name: "Aegis", units: { ...units }, stationId: wolfStation(), transit: null, escort: { expeditionId: id, since: now } }] : [] }
  };
  const exp = {
    id, beltKey: WOLF_BELT, systemId: WOLF, duration: "extended", deployedAt: now - 2 * HOUR, completesAt: now, lastTickAt: now,
    yields: { Titanium: 1000, "Rare Earths": 800 },
    rats: { density: DENSITY, hours: 2, escortFleetId: escort ? "flt-escort" : null, escortUnits: escort ?? null, escortPower: escort ? forcePower(escort) : 0, encounters: [] }
  };
  return { corp, exp };
}

describe("the encounter roll (AB#820)", () => {
  it("is deterministic for a fixed seed, and the same expedition resolves the same way twice", () => {
    const id = idWithEncounters(WEAK, 2);
    expect(planEncounters(seedFor(id), DENSITY, 2, forcePower(WEAK))).toEqual(planEncounters(seedFor(id), DENSITY, 2, forcePower(WEAK)));
    // Bug AB#4782: one clock for both, or the escort's `since` differs by a millisecond whenever the two set-ups straddle one
    const now = Date.now();
    const a = fixture(id, WEAK, now), b = fixture(id, WEAK, now);
    settleRats(a.corp, a.exp, a.exp.completesAt);
    settleRats(b.corp, b.exp, b.exp.completesAt);
    expect(a.exp.rats.encounters.map(({ at, ...r }) => r)).toEqual(b.exp.rats.encounters.map(({ at, ...r }) => r));
    expect(a.exp.yields).toEqual(b.exp.yields);
    expect(a.corp.military).toEqual(b.corp.military);
  });

  it("across 10,000 seeded rolls meets Rats within 1 percentage point of the formula", () => {
    for (const [density, hours, escort] of [[DENSITY, 2, {}], [11, 1, {}], [DENSITY, 2, STRONG]]) {
      let met = 0;
      for (let i = 0; i < 10_000; i += 1) if (planEncounters(seedFor(`exp-roll-${density}-${hours}-${i}`), density, hours, forcePower(escort)).length > 0) met += 1;
      const formula = encounterChance(density, hours, forcePower(escort));
      expect(Math.abs(met / 10_000 - formula), `${density}/${hours}/${JSON.stringify(escort)}`).toBeLessThan(0.01);
    }
  });

  it("spreads encounters later in an expedition, and a seed nobody outside the server can make", () => {
    let early = 0, late = 0;
    for (let i = 0; i < 4000; i += 1) for (const e of planEncounters(seedFor(`exp-t-${i}`), DENSITY, 2)) (e.share < 0.5 ? (early += 1) : (late += 1));
    expect(late).toBeGreaterThan(early); // the rate rises through the stay (design section 1)
    expect(seedFor("x", "secret-one-0123456789")).not.toBe(seedFor("x", "secret-two-0123456789"));
    expect(() => seedFor("x", "short")).toThrow(/server secret/);
  });

  it("refuses a table it cannot use, so the server does not start with one", () => {
    expect(ratsTableProblems(RATS)).toEqual([]);
    expect(ratsTableProblems({ ...RATS, unescorted: [{ id: "harried", chance: 0.5, haulLost: 0.1 }] })).toContain("the unescorted chances must add to 1");
    expect(ratsTableProblems({ ...RATS, hazardPerDensityHour: -1 }).join(" ")).toMatch(/hazardPerDensityHour/);
  });
});

describe("an escorted encounter (AB#820)", () => {
  it("a stronger escort wins: the full haul arrives, and the escort loses what the resolver says, as real units", () => {
    const id = idWithEncounters(STRONG, 1);
    const { corp, exp } = fixture(id, STRONG);
    const expected = fightEncounter({ ...STRONG }, gatheredGroup(ratGroup(DENSITY), 0), combatModifiersFor(corp));
    settleRats(corp, exp, exp.completesAt);
    const first = exp.rats.encounters[0];
    expect(first.escort).toMatchObject({ held: true, lost: expected.lost });
    expect(first.haulLost).toEqual({});
    expect(first.escort.rounds.length).toBeGreaterThan(0); // the battle log is kept on the expedition
    if (exp.rats.encounters.every((e) => e.escort?.held)) expect(exp.yields).toEqual({ Titanium: 1000, "Rare Earths": 800 });
    const lostTotal = (id2) => exp.rats.encounters.reduce((s, e) => s + (e.escort?.lost?.[id2] || 0), 0);
    for (const u of ["ds", "at"]) {
      expect(corp.military.fleets[0].units[u]).toBe(STRONG[u] - lostTotal(u));
      expect(corp.military.units[u]).toBe(STRONG[u] - lostTotal(u));
    }
  });

  it("a weaker escort loses units per the resolver, and the haul takes the unescorted outcome", () => {
    const id = idWithEncounters(WEAK, 1);
    const { corp, exp } = fixture(id, WEAK);
    settleRats(corp, exp, exp.completesAt);
    const first = exp.rats.encounters[0];
    expect(first.escort.held).toBe(false);
    expect(exp.rats.escortBeaten).toBe(true);
    expect(corp.military.fleets[0].units.lf).toBeLessThan(4);
    const row = RATS.unescorted.find((r) => r.id === first.roll);
    expect(first.haulLost.Titanium).toBe(Math.floor(1000 * row.haulLost));
    expect(exp.yields.Titanium).toBeLessThan(1000);
    // later encounters meet it beaten: no second fight
    for (const e of exp.rats.encounters.slice(1)) expect(e.escort).toBeNull();
  });

  it("ticking the same expedition twice applies the outcome once", () => {
    const id = idWithEncounters(WEAK, 2);
    const { corp, exp } = fixture(id, WEAK);
    settleRats(corp, exp, exp.completesAt);
    const after = JSON.stringify({ exp, corp });
    settleRats(corp, exp, exp.completesAt);
    settleRats(corp, exp, exp.completesAt + HOUR);
    expect(JSON.stringify({ exp, corp })).toBe(after);
  });
});

/** A corporation in Wolf 359 that can launch there, with three fleets at the system's station. */
async function miner(credits = 1_000_000) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const station = wolfStation();
  mutateAccountState(reg.account.id, (s) => {
    s.corp.finances.credits = credits;
    s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), "tt-asteroid-prospecting"])];
    s.corp.currentSystemId = WOLF;
    s.corp.currentStationId = station;
    s.corp.asteroidMining = { probeCount: 3, maxDeployments: 3, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [], scoutedBelts: [WOLF_BELT], scoutedGenerations: { [WOLF_BELT]: 1 } };
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
  return { id: reg.account.id, api, at, corp: () => getAccountById(reg.account.id).state.corp, state: () => JSON.stringify(getAccountById(reg.account.id).state) };
}
const launch = (m, body) => m.api.post(m.at("/launch-expedition")).send({ beltKey: WOLF_BELT, duration: "extended", ...body });

describe("launching with an escort (AB#820)", () => {
  it("charges the escort's provisions, states the risk, and commits the fleet until the expedition ends", async () => {
    const m = await miner();
    const before = m.corp().finances.credits;
    const res = await launch(m, { escortFleetId: "flt-a" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const provisions = RATS.escortCostPerSupplyHour * (6 * 4 + 6 * 1) * 2; // DS supply 4, AT supply 1, 2 hours
    expect(before - m.corp().finances.credits).toBe(3000 + provisions);
    const exp = m.corp().asteroidMining.activeExpeditions[0];
    expect(exp.rats).toMatchObject({ density: DENSITY, hours: 2, escortFleetId: "flt-a", provisions, encounters: [] });
    expect(exp.rats.chance).toBeCloseTo(encounterChance(DENSITY, 2, forcePower(STRONG)), 10);
    expect(exp.rats.chance).toBeLessThan(exp.rats.chanceUnescorted);
    expect(JSON.stringify(exp)).not.toMatch(/"share"|"roll"/); // nothing about an encounter is stored before it happens
    const grants = Object.fromEntries(res.body.receipt.grants.map((g) => [g.label, g.value]));
    expect(grants["Chance of meeting Rats"]).toMatch(/^\d+% with the escort \(\d+% without\)$/);
    expect(m.corp().military.fleets.find((f) => f.id === "flt-a").escort).toMatchObject({ expeditionId: exp.id });
    // committed: no deployment, no split, no raid, no offer, no second escort
    for (const [path, body] of [["/fleets/flt-a/deploy", { toStationId: "earth-station-prime" }], ["/fleets/flt-a/split", { ds: 1 }], ["/fleets/flt-a/disband", {}]]) {
      const r = await m.api.post(m.at(path)).send(body);
      expect(r.status, path).toBe(400);
      expect(r.body.error, path).toMatch(/escorting an expedition/);
    }
    const again = await launch(m, { escortFleetId: "flt-a" });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already escorting/);
    const offer = await m.api.post(m.at("/mercenaries/offer")).send({ fleetId: "flt-a", termHours: 24, price: 5000, collateral: 1000, allowedUse: "defense" });
    expect(offer.status).toBe(409);
    expect(offer.body.error).toMatch(/escorting/);
    // it comes home: the fleet is released, and every encounter was applied
    mutateAccountState(m.id, (s) => {
      const e = s.corp.asteroidMining.activeExpeditions[0];
      e.completesAt = Date.now() - 1; e.deployedAt = e.completesAt - 2 * HOUR; e.lastTickAt = e.completesAt - 1000;
    }, { sanitize: false, settleMining: false });
    mutateAccountState(m.id, (s) => { applyAsteroidExpeditions(s.corp, Date.now()); }, { sanitize: false, settleMining: false });
    const done = m.corp().asteroidMining.completedExpeditions[0];
    expect(done.rats.encounters.length).toBe(planEncounters(seedFor(done.id), DENSITY, 2, forcePower(STRONG)).length);
    expect(m.corp().military.fleets.find((f) => f.id === "flt-a").escort).toBeUndefined();
  });

  it("refuses another corporation's fleet, a fleet elsewhere, a travelling one and every hostile value, changing nothing", async () => {
    const m = await miner();
    const other = await miner();
    const before = m.state();
    const cases = [
      [{ escortFleetId: "flt-a-not-mine" }, /your own fleets/],
      [{ escortFleetId: "flt-b" }, /stationed in the belt's system/]
    ];
    for (const [body, why] of cases) {
      const r = await launch(m, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toMatch(why);
    }
    // the other corporation's fleet ids are the same strings as ours: looked up only among the caller's own
    const theirs = await launch(other, { escortFleetId: "flt-zzz" });
    expect(theirs.status).toBe(400);
    for (const bad of [-1, 2.5, "", { id: "flt-a" }, ["flt-a"], "x".repeat(10_000), null, Number.NaN]) {
      const r = await launch(m, { escortFleetId: bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    // everything refused above changed nothing
    mutateAccountState(m.id, (s) => { s.corp.military.fleets.find((f) => f.id === "flt-a").transit = { toStationId: "x", arrivesAt: Date.now() + HOUR }; }, { sanitize: false, settleMining: false });
    const travelling = await launch(m, { escortFleetId: "flt-a" });
    expect(travelling.status).toBe(400);
    expect(travelling.body.error).toMatch(/travelling/);
    mutateAccountState(m.id, (s) => { delete s.corp.military.fleets.find((f) => f.id === "flt-a").transit; }, { sanitize: false, settleMining: false });
    // nothing launched and nothing charged
    expect(m.corp().asteroidMining.activeExpeditions).toEqual([]);
    expect(m.corp().finances.credits).toBe(JSON.parse(before).corp.finances.credits);
    expect(m.corp().asteroidMining.probeCount).toBe(3);
  });

  it("fails closed: without a seed it can make, the server launches nothing and charges nothing", async () => {
    const m = await miner();
    const before = m.state();
    process.env.ISP_RAT_SEED_SECRET = "short";
    const r = await launch(m, { escortFleetId: "flt-a" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing was launched or charged/);
    expect(m.state()).toBe(before);
  });
});

describe("the formula's numbers (AB#820)", () => {
  it("match the design: Wolf 359's group, and its chances by length", () => {
    expect(ratGroup(DENSITY)).toEqual({ lf: 10, ds: 3 });
    expect(Math.round(encounterChance(DENSITY, 2) * 100)).toBe(71);
    expect(Math.round(encounterChance(11, 2) * 100)).toBe(36);
    expect(encounterRate(DENSITY, 2)).toBeCloseTo(0.31 * 4, 10);
  });
});

describe("what the expedition's report says (AB#820)", () => {
  it("names the encounters, the escort's losses by unit and the haul taken, and says nothing for an expedition from before Rats", async () => {
    const { expeditionRatsText, expeditionNotificationBody } = await import("../../server/expeditionText.js");
    expect(expeditionRatsText({ yields: {} })).toBe("");
    expect(expeditionRatsText({ rats: { encounters: [], escortFleetId: null } })).toBe("No Rats were met.");
    const held = { rats: { escortFleetId: "f", escortBeaten: false, encounters: [{ escort: { lost: { ds: 1, at: 2 } }, haulLost: {} }] } };
    expect(expeditionRatsText(held)).toBe("Met Rats once. The escort held the fight, losing 1 Destroyer, 2 squads of Attack Troops. The haul is intact.");
    const beaten = { rats: { escortFleetId: "f", escortBeaten: true, encounters: [{ escort: { lost: { lf: 4 } }, haulLost: { Titanium: 250 } }, { escort: null, haulLost: { Titanium: 75 } }] } };
    expect(expeditionRatsText(beaten)).toBe("Met Rats twice. The escort was beaten, losing 4 Light Fighters. Rats took 325 units of the haul.");
    expect(expeditionNotificationBody({ beltKey: WOLF_BELT, systemId: WOLF, yields: { Titanium: 675 }, ...beaten })).toContain("Rats took 325 units of the haul.");
  });
});
