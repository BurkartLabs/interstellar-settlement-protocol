import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { fabricationTick } from "../../server/ticks.js";
import { getTravelTimeMs } from "../../server/travel.js";
import { FLEET_NAMES, FLEET_UNIT_IDS, deployFleet, disbandFleet, formFleet, mergeFleets, reserveOf, settleFleets, splitFleet } from "../../server/fleets.js";

// ISP-174 (AB#868): fleets on the server. Units are counted once (corp.military.units); fleets hold some of them and
// the rest are the reserve, so no order changes the totals. Deployment keeps the corporation's own travel times and
// research gates, and a fleet in transit takes no orders.

afterEach(() => vi.restoreAllMocks());

const EARTH = "earth-station-prime", MARS = "mars-orbital-dock", CENTAURI = "centauri-prime-station", VERDE = "verde-trade-hub";
const corpWith = (units, extra = {}) => ({ currentStationId: EARTH, currentSystemId: "sol", unlockedTech: [], military: { units: { lf: 0, ds: 0, se: 0, at: 0, dt: 0, ...units } }, ...extra });

describe("unit conservation (AB#868)", () => {
  it("forming, splitting, merging and disbanding never change the totals, across 2,000 random orders", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const corp = corpWith({ lf: 60, ds: 20, se: 10, at: 40, dt: 15 });
    const totals = JSON.stringify(corp.military.units);
    const some = (max) => Object.fromEntries(FLEET_UNIT_IDS.map((id) => [id, Math.floor(rnd() * (max[id] + 1))]));
    let now = 1_000_000;
    for (let i = 0; i < 2000; i += 1) {
      now += 1000;
      const fleets = corp.military.fleets || [];
      const op = pick(["form", "split", "merge", "disband"]);
      if (op === "form") formFleet(corp, { units: some(reserveOf(corp)) }, now);
      else if (fleets.length && op === "split") { const f = pick(fleets); splitFleet(corp, f.id, { units: some(f.units) }, now); }
      else if (fleets.length > 1 && op === "merge") mergeFleets(corp, pick(fleets).id, pick(fleets).id, now);
      else if (fleets.length && op === "disband") disbandFleet(corp, pick(fleets).id, now);
      expect(JSON.stringify(corp.military.units)).toBe(totals);
      const reserve = reserveOf(corp);
      for (const id of FLEET_UNIT_IDS) {
        expect(reserve[id], `${id} after ${op}`).toBeGreaterThanOrEqual(0);
        expect(reserve[id] + (corp.military.fleets || []).reduce((s, f) => s + f.units[id], 0)).toBe(corp.military.units[id]);
      }
      for (const f of corp.military.fleets || []) expect(Object.values(f.units).reduce((a, b) => a + b, 0), f.name).toBeGreaterThan(0);
    }
    expect((corp.military.fleets || []).length).toBeGreaterThan(0);
  });

  it("forms only from the reserve, names from the list, and keeps Defense Troops out of fleets", () => {
    const corp = corpWith({ lf: 10, dt: 5 });
    expect(formFleet(corp, { units: { lf: 11 } })).toMatchObject({ outcome: "not-in-reserve", unitId: "lf", have: 10 });
    expect(formFleet(corp, { units: { dt: 5 } }).outcome).toBe("no-units");
    const a = formFleet(corp, { units: { lf: 6 } });
    expect(a.fleet).toMatchObject({ name: FLEET_NAMES[0], stationId: EARTH, units: { lf: 6, ds: 0, se: 0, at: 0 } });
    expect(formFleet(corp, { units: { lf: 1 }, name: FLEET_NAMES[0] }).outcome).toBe("name-taken");
    expect(formFleet(corp, { units: { lf: 1 }, name: "Death Star" }).outcome).toBe("bad-name");
    expect(formFleet(corp, { units: { lf: 5 } }).outcome).toBe("not-in-reserve");
    expect(formFleet(corp, { units: { lf: 4 }, name: "Talon" }).fleet.name).toBe("Talon");
  });
});

describe("deployment (AB#868)", () => {
  it("takes the corporation's own travel time, takes no orders in transit, and is stationed on arrival", () => {
    const corp = corpWith({ lf: 10, ds: 4 });
    const { fleet } = formFleet(corp, { units: { lf: 6, ds: 2 } }, 0);
    const other = formFleet(corp, { units: { lf: 1 } }, 0).fleet;
    const sent = deployFleet(corp, fleet.id, MARS, 1000);
    expect(sent.outcome).toBe("ok");
    expect(fleet.transit.arrivesAt - fleet.transit.departedAt).toBe(getTravelTimeMs(EARTH, MARS));
    const mid = 1000 + sent.durationMs / 2;
    expect(splitFleet(corp, fleet.id, { units: { lf: 1 } }, mid).outcome).toBe("in-transit");
    expect(mergeFleets(corp, other.id, fleet.id, mid).outcome).toBe("in-transit");
    expect(deployFleet(corp, fleet.id, EARTH, mid).outcome).toBe("in-transit");
    expect(disbandFleet(corp, fleet.id, mid).outcome).toBe("in-transit");
    expect(settleFleets(corp, fleet.transit.arrivesAt)).toHaveLength(1);
    expect(fleet).toMatchObject({ stationId: MARS, transit: null });
    expect(mergeFleets(corp, other.id, fleet.id, fleet.formedAt + sent.durationMs + 2000).outcome).toBe("not-together");
  });

  it("needs the navigation research the corporation's own ship needs: Proxima for Alpha Centauri, Deep-Star for Tau Ceti", () => {
    const corp = corpWith({ lf: 3 });
    const { fleet } = formFleet(corp, { units: { lf: 3 } }, 0);
    expect(deployFleet(corp, fleet.id, CENTAURI, 1).outcome).toBe("missing-research");
    corp.unlockedTech = ["tt-proxima-navigation"];
    expect(deployFleet(corp, fleet.id, VERDE, 1).outcome).toBe("missing-research");
    const sent = deployFleet(corp, fleet.id, CENTAURI, 1);
    expect(sent.outcome).toBe("ok");
    expect(sent.durationMs).toBe(getTravelTimeMs(EARTH, CENTAURI));
  });

  it("disbands only where the corporation is docked, and the units return to the reserve", () => {
    const corp = corpWith({ lf: 5 });
    const { fleet } = formFleet(corp, { units: { lf: 5 } }, 0);
    deployFleet(corp, fleet.id, MARS, 0);
    settleFleets(corp, fleet.transit.arrivesAt);
    expect(disbandFleet(corp, fleet.id, fleet.transit?.arrivesAt ?? 10 ** 12)).toMatchObject({ outcome: "not-here", stationId: MARS });
    corp.currentStationId = MARS;
    expect(disbandFleet(corp, fleet.id, 10 ** 12).outcome).toBe("ok");
    expect(reserveOf(corp).lf).toBe(5);
  });
});

describe("through the routes (AB#868)", () => {
  async function corporation(setup) {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    mutateAccountState(account.id, (state) => {
      state.corp.currentStationId = EARTH;
      state.corp.military = { units: { lf: 12, ds: 3, at: 8 } };
      setup?.(state.corp);
    }, { sanitize: false, settleMining: false });
    const api = authed(app, accessToken);
    const at = (path) => `/api/accounts/${account.id}/gameplay/fleets${path}`;
    return { id: account.id, api, at, corp: () => getAccountById(account.id).state.corp, state: () => JSON.stringify(getAccountById(account.id).state) };
  }

  it("forms, splits, merges, deploys and, once the tick has seen it arrive, stations a fleet", async () => {
    const c = await corporation();
    const formed = await c.api.post(c.at("/form")).send({ lf: 10, at: 4, name: "Aegis" });
    expect(formed.status).toBe(200);
    const id = formed.body.fleet.id;
    const split = await c.api.post(c.at(`/${id}/split`)).send({ lf: 3 });
    expect(split.status).toBe(200);
    expect(split.body.part.name).toBe("Vanguard");
    expect((await c.api.post(c.at(`/${split.body.part.id}/merge`)).send({ intoFleetId: id })).status).toBe(200);
    expect(c.corp().military.fleets.map((f) => [f.name, f.units.lf])).toEqual([["Aegis", 10]]);
    const deployed = await c.api.post(c.at(`/${id}/deploy`)).send({ toStationId: MARS });
    expect(deployed.status).toBe(200);
    const { arrivesAt } = c.corp().military.fleets[0].transit;
    vi.spyOn(Date, "now").mockReturnValue(arrivesAt + 1);
    fabricationTick();
    vi.restoreAllMocks();
    expect(c.corp().military.fleets[0]).toMatchObject({ stationId: MARS, transit: null });
    expect(c.corp().military.units).toMatchObject({ lf: 12, ds: 3, at: 8 });
  });

  it("answers 404, changing nothing, for another corporation's fleet, whatever the order", async () => {
    const owner = await corporation();
    const theirs = (await owner.api.post(owner.at("/form")).send({ lf: 5 })).body.fleet.id;
    const other = await corporation();
    const mine = (await other.api.post(other.at("/form")).send({ lf: 2 })).body.fleet.id;
    const before = owner.state();
    for (const [path, body] of [[`/${theirs}/deploy`, { toStationId: MARS }], [`/${theirs}/split`, { lf: 1 }], [`/${theirs}/merge`, { intoFleetId: mine }],
      [`/${mine}/merge`, { intoFleetId: theirs }], [`/${theirs}/disband`, {}], ["/flt-made-up/deploy", { toStationId: MARS }]]) {
      const res = await other.api.post(other.at(path)).send(body);
      expect(res.status, path).toBe(404);
    }
    expect(owner.state()).toBe(before);
  });

  it("refuses a free-text name, and any count that is not a whole number, before anything changes", async () => {
    const c = await corporation();
    const before = c.state();
    for (const body of [{ lf: 2, name: "<script>" }, { lf: 2, name: "The Fleet Of Doom" }, { lf: -1 }, { lf: 2.5 }, { lf: "many" }]) {
      expect((await c.api.post(c.at("/form")).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(c.state()).toBe(before);
  });
});
