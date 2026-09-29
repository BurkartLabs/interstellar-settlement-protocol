import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { createAccount, getAccountById, getState, mutateAccountState } from "../../server/gameState.js";
import { accountsStore } from "../../server/game/store.js";
import { resolveBattle } from "../../server/game/combat.js";
import { getTravelTimeMs } from "../../server/travel.js";
import { settleFleets } from "../../server/fleets.js";
import { POSTURES, moveTroops, settleGarrisonMoves } from "../../server/garrison.js";
import { raidTick } from "../../server/raidResolution.js";
import { declareRaid } from "../../server/raids.js";

// ISP-180 (AB#874): defending (docs/design/v0.10-raids-mercenaries.md, section 2a): a garrison's posture, troops and
// hired fleets sent to reinforce during the warning window, and an offline defender defended all the same. The raid is
// the combat design's worked one. Time is passed in (P-TEST-TIME).
const EARTH = "earth-station-prime", LUNA = "luna-gateway";
const DAY = 86_400_000, MIN = 60_000;

async function corporation({ units = {}, garrisons = {}, goods = null, where = EARTH } = {}) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const id = reg.account.id;
  mutateAccountState(id, (state) => {
    state.corp.currentStationId = EARTH;
    state.corp.finances.credits = 500_000;
    const dt = Object.values(garrisons).reduce((a, b) => a + b, 0);
    state.corp.military = { units: { ...units, dt }, garrisons };
    if (goods) state.corp.inventory = { ...(state.corp.inventory || {}), [where]: goods };
  }, { sanitize: false, settleMining: false });
  accountsStore.accounts[id].createdAt = Date.now() - 30 * DAY;
  const api = authed(app, reg.accessToken);
  const at = (p) => `/api/accounts/${id}/gameplay${p}`;
  const corp = () => getAccountById(id).state.corp;
  return { id, api, at, corp, publicId: corp().publicId };
}
const form = async (c, units) => (await c.api.post(c.at("/fleets/form")).send(units)).body.fleet.id;
const stored = (id) => getState().market.raids.find((r) => r.id === id);
const GOODS = { Silicates: 5_000 };

/** The worked raid: 6 destroyers and 12 attack troops against 14 fighters and `dt` troops at Earth. */
async function worked({ dt = 12, luna = 0 } = {}) {
  const attacker = await corporation({ units: { ds: 6, at: 12 } });
  const defender = await corporation({ units: { lf: 14 }, garrisons: { [EARTH]: dt, ...(luna ? { [LUNA]: luna } : {}) }, goods: GOODS });
  await form(defender, { lf: 14 });
  const fleetId = await form(attacker, { ds: 6, at: 12 });
  const raid = declareRaid(attacker.id, { fleetId, targetCorpId: defender.publicId, targetStationId: EARTH }).raid;
  return { attacker, defender, raid };
}

describe("ISP-180 posture", () => {
  it("the same raid against two postures: fortified holds the station, aggressive loses it but kills more raiders", async () => {
    const results = {};
    for (const posture of ["fortified", "aggressive"]) {
      const { attacker, defender, raid } = await worked({ dt: 12 });
      const set = await defender.api.post(defender.at(`/garrisons/${EARTH}/posture`)).send({ posture });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(defender.corp().garrisonPostures[EARTH]).toBe(posture); // persisted
      raidTick(raid.arrivesAt);
      const report = defender.corp().raidReports[0];
      results[posture] = { winner: stored(raid.id).result.winner, raidersLeft: report.attacker.survivors.at, looted: Object.keys(stored(raid.id).result.loot).length > 0, posture: report.posture };
      expect(attacker.corp().raidReports[0].posture).toBe(posture);
    }
    expect(results.fortified).toMatchObject({ winner: "draw", looted: false, posture: "fortified" });
    expect(results.aggressive).toMatchObject({ winner: "attacker", looted: true, posture: "aggressive" });
    expect(results.aggressive.raidersLeft).toBeLessThan(results.fortified.raidersLeft);
    // and they are the design's multipliers, applied to the resolver
    expect(resolveBattle({ ds: 6, at: 12 }, { lf: 14, dt: 12 }, { defender: { attack: 0.8, accuracy: 1, evasion: 1.2 } }).winner).toBe("draw");
    expect(POSTURES).toEqual({ balanced: { attack: 1, evasion: 1 }, fortified: { attack: 0.8, evasion: 1.2 }, aggressive: { attack: 1.2, evasion: 0.8 } });
  });

  it("the postures are the design's table (P-TWO-SOURCES)", async () => {
    const fs = await import("node:fs");
    const doc = fs.readFileSync(new URL("../../docs/design/v0.10-raids-mercenaries.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const rows = [...doc.matchAll(/^\| (balanced|fortified|aggressive) \| ([\d.]+) \| ([\d.]+) \|$/gm)];
    expect(Object.fromEntries(rows.map(([, id, attack, evasion]) => [id, { attack: Number(attack), evasion: Number(evasion) }]))).toEqual(POSTURES);
  });

  it("is set only where the corporation holds something, and only to a posture on the list", async () => {
    const c = await corporation({ garrisons: { [EARTH]: 3 } });
    expect((await c.api.post(c.at(`/garrisons/${LUNA}/posture`)).send({ posture: "fortified" })).body.error).toMatch(/hold nothing/);
    expect((await c.api.post(c.at(`/garrisons/${EARTH}/posture`)).send({ posture: "reckless" })).status).toBe(400);
  });
});

describe("Bug #4822: a troop move over the garrison says what to send instead", () => {
  it("names the most that can go, or says to choose a station that has troops", async () => {
    const c = await corporation({ garrisons: { [LUNA]: 4 } });
    expect(moveTroops(c.id, { fromStationId: LUNA, toStationId: EARTH, quantity: 5 })).toMatchObject({ status: 409, error: "Only 4 defense troops stand at that station. Send 4 or fewer." });
    expect(moveTroops(c.id, { fromStationId: EARTH, toStationId: LUNA, quantity: 1 }).error).toBe("No defense troops stand at that station. Choose a station that has troops.");
  });
});

describe("ISP-180 reinforcing in the warning window", () => {
  it("troops that arrive before the raid join the defense; troops that arrive after do not", async () => {
    const hop = getTravelTimeMs(LUNA, EARTH);
    // in time: 3 troops from Luna turn 12 into 15, and the worked raid is a draw
    const early = await worked({ dt: 12, luna: 3 });
    expect(moveTroops(early.defender.id, { fromStationId: LUNA, toStationId: EARTH, quantity: 3 }, early.raid.arrivesAt - hop).ok).toBe(true);
    raidTick(early.raid.arrivesAt);
    expect(stored(early.raid.id).result.winner).toBe("draw");
    expect(early.defender.corp().raidReports[0].defender.before.dt).toBe(15);

    // too late: they land one minute after the raid, which then fights 12 and is won
    const late = await worked({ dt: 10, luna: 5 });
    expect(moveTroops(late.defender.id, { fromStationId: LUNA, toStationId: EARTH, quantity: 5 }, late.raid.arrivesAt - hop + MIN).ok).toBe(true);
    // the troops land (and something settles them, as the defender's next troop order would), then the tick runs
    // 5 minutes late: they still do not count
    mutateAccountState(late.defender.id, (st) => { settleGarrisonMoves(st.corp, late.raid.arrivesAt + 2 * MIN); }, { sanitize: false });
    raidTick(late.raid.arrivesAt + 5 * MIN);
    expect(stored(late.raid.id).result.winner).toBe("attacker");
    expect(late.defender.corp().raidReports[0].defender.before.dt).toBe(10);
    expect(late.defender.corp().military.garrisons[EARTH]).toBe(5); // they arrived, and stand in the garrison afterwards
  });

  it("a fleet that lands after the raid does not fight, even if it was settled before the tick ran", async () => {
    const { attacker, defender, raid } = await worked({ dt: 12 });
    mutateAccountState(defender.id, (s) => { s.corp.military.units.lf = 22; }, { sanitize: false, settleMining: false }); // 8 more fighters, in reserve
    const reserve = await form(defender, { lf: 8 });
    await defender.api.post(defender.at(`/fleets/${reserve}/deploy`)).send({ toStationId: LUNA });
    mutateAccountState(defender.id, (s) => { settleFleets(s.corp, Date.now() + DAY); }, { sanitize: false }); // at Luna
    const hop = getTravelTimeMs(LUNA, EARTH);
    mutateAccountState(defender.id, (s) => {
      const f = s.corp.military.fleets.find((x) => x.id === reserve);
      f.stationId = null;
      f.transit = { fromStationId: LUNA, toStationId: EARTH, toSystemId: "sol", departedAt: raid.arrivesAt - hop + MIN, arrivesAt: raid.arrivesAt + MIN };
      settleFleets(s.corp, raid.arrivesAt + 2 * MIN); // someone read the account: it is stationed at Earth now
    }, { sanitize: false });
    raidTick(raid.arrivesAt + 3 * MIN);
    expect(defender.corp().raidReports[0].defender.before.lf).toBe(14); // the late 8 fighters did not fight
    expect(attacker.corp().raidReports[0].winner).toBe("draw");
  });

  it("troop moves are checked: never more than stand there, never to the same station", async () => {
    const c = await corporation({ garrisons: { [EARTH]: 3 } });
    expect((await c.api.post(c.at("/garrisons/move")).send({ fromStationId: EARTH, toStationId: LUNA, quantity: 4 })).body.error).toMatch(/Only 3/);
    expect((await c.api.post(c.at("/garrisons/move")).send({ fromStationId: EARTH, toStationId: EARTH, quantity: 1 })).status).toBe(400);
    const ok = await c.api.post(c.at("/garrisons/move")).send({ fromStationId: EARTH, toStationId: LUNA, quantity: 2 });
    expect(ok.status).toBe(200);
    expect(c.corp().military.garrisons[EARTH]).toBe(1);
  });

  it("a hired fleet can be sent to the renter's own station, and defends there", async () => {
    const owner = await corporation({ units: { lf: 14 } });
    const mercs = await form(owner, { lf: 14 });
    const offer = (await owner.api.post(owner.at("/mercenaries/offer")).send({ fleetId: mercs, termHours: 168, price: 5_000, collateral: 1, allowedUse: "defense" })).body.offer.id;
    const renter = await corporation({ garrisons: { [LUNA]: 12 }, goods: GOODS, where: LUNA });
    expect((await renter.api.post(renter.at(`/mercenaries/${offer}/hire`)).send({})).status).toBe(200);
    expect((await renter.api.post(renter.at(`/mercenaries/${offer}/deploy`)).send({ toStationId: "mars-orbital-dock" })).body.error).toMatch(/where you hold something/);
    const sent = await renter.api.post(renter.at(`/mercenaries/${offer}/deploy`)).send({ toStationId: LUNA });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    // the owner cannot move it, and it arrives at Luna
    expect((await owner.api.post(owner.at(`/fleets/${mercs}/deploy`)).send({ toStationId: EARTH })).status).not.toBe(200);
    const attacker = await corporation({ units: { ds: 6, at: 12 } });
    const fleetId = await form(attacker, { ds: 6, at: 12 });
    const raid = declareRaid(attacker.id, { fleetId, targetCorpId: renter.publicId, targetStationId: LUNA }).raid;
    raidTick(raid.arrivesAt);
    const report = renter.corp().raidReports[0];
    expect(report.defender.before).toMatchObject({ lf: 14, dt: 12 });
    expect(report.winner).toBe("draw"); // the worked battle, fought at Luna with hired fighters
    expect(getState().market.mercenaryOffers.find((o) => o.id === offer).lost.lf).toBeGreaterThan(0);
  });
});

describe("ISP-180 nobody needs to be online", () => {
  it("a defender that never signs in or acts is defended by its garrison, at the default posture", async () => {
    const attacker = await corporation({ units: { ds: 6, at: 12 } });
    const { account } = await createAccount({ email: `absent-${Date.now()}@example.test`, password: "never here 12345", ceoName: "Absent", corpName: `Absent Hold ${Date.now() % 100_000}` });
    mutateAccountState(account.id, (s) => {
      s.corp.military = { units: { dt: 20 }, garrisons: { [EARTH]: 20 } };
      s.corp.inventory = { [EARTH]: GOODS };
    }, { sanitize: false, settleMining: false });
    accountsStore.accounts[account.id].createdAt = Date.now() - 30 * DAY;
    const fleetId = await form(attacker, { ds: 6, at: 12 });
    const raid = declareRaid(attacker.id, { fleetId, targetCorpId: getAccountById(account.id).state.corp.publicId, targetStationId: EARTH }).raid;
    raidTick(raid.arrivesAt);
    const want = resolveBattle({ ds: 6, at: 12 }, { dt: 20 });
    const report = getAccountById(account.id).state.corp.raidReports[0];
    expect(report).toMatchObject({ winner: want.winner, posture: "balanced", defender: { before: { dt: 20 }, survivors: want.survivors.defender } });
  });
});
