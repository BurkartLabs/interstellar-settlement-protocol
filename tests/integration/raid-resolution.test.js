import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, listAccountNotifications, mutateAccountState } from "../../server/gameState.js";
import { accountsStore } from "../../server/game/store.js";
import { RAID_OUTCOME, lootFor, raidTick } from "../../server/raidResolution.js";
import { itemEscrowOf, itemLedgerEntries } from "../../server/itemSettlement.js";
import { declareRaid } from "../../server/raids.js";

// ISP-179 (AB#873): resolving a raid at arrival and bringing the fleet home (docs/design/v0.10-raids-mercenaries.md,
// sections 2, 3 and 5; the Board on AB#705: "buildings can be damaged, units destroyed, resources taken"). The battle is
// the combat design's worked one (docs/design/v0.10-combat.md, section 6). Time is passed to the tick (P-TEST-TIME).
const EARTH = "earth-station-prime";
const DAY = 86_400_000;
const bid = (item) => Math.max(0, ...(getState().market.npcBuyOrders || []).filter((o) => o.item === item).map((o) => Math.floor(Number(o.unitPrice) || 0)));
const ITEM = "Silicates";

async function corporation({ units = {}, garrison = 0, goods = null, credits = 500_000 } = {}) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const id = reg.account.id;
  mutateAccountState(id, (state) => {
    state.corp.currentStationId = EARTH;
    state.corp.finances.credits = credits;
    state.corp.military = { units: { ...units, dt: garrison }, garrisons: garrison ? { [EARTH]: garrison } : {} };
    if (goods) state.corp.inventory = { ...(state.corp.inventory || {}), [EARTH]: goods };
  }, { sanitize: false, settleMining: false });
  accountsStore.accounts[id].createdAt = Date.now() - 30 * DAY;
  const api = authed(app, reg.accessToken);
  const at = (p) => `/api/accounts/${id}/gameplay${p}`;
  const corp = () => getAccountById(id).state.corp;
  return { id, api, at, corp, publicId: corp().publicId };
}
const form = async (c, units) => (await c.api.post(c.at("/fleets/form")).send(units)).body.fleet.id;
const stock = (c, item = ITEM) => Number(c.corp().inventory?.[EARTH]?.[item]) || 0;
const units = (c, id) => Number(c.corp().military.units[id]) || 0;

/** The worked battle: 6 destroyers and 12 attack troops against 14 fighters in a fleet and `dt` troops in the garrison. */
async function workedRaid({ dt = 10, goodsValue = 60_000 } = {}) {
  const attacker = await corporation({ units: { ds: 6, at: 12 } });
  const qty = Math.ceil(goodsValue / bid(ITEM));
  const defender = await corporation({ units: { lf: 14 }, garrison: dt, goods: { [ITEM]: qty } });
  await form(defender, { lf: 14 });
  const fleetId = await form(attacker, { ds: 6, at: 12 });
  const raid = declareRaid(attacker.id, { fleetId, targetCorpId: defender.publicId, targetStationId: EARTH }).raid;
  return { attacker, defender, fleetId, raid, qty };
}
const stored = (id) => getState().market.raids.find((r) => r.id === id);

describe("ISP-179 the worked raid", () => {
  it("the attacker wins with 5 destroyers and 2 attack troops; losses leave both sides; loot within the cap moves through escrow to the attacker at home", async () => {
    const { attacker, defender, fleetId, raid, qty } = await workedRaid();
    const credits = defender.corp().finances.credits;
    raidTick(raid.arrivesAt - 1);
    expect(stored(raid.id).state).toBe("inbound");
    raidTick(raid.arrivesAt);
    raidTick(raid.arrivesAt); // a second tick resolves nothing twice

    const r = stored(raid.id);
    expect(r).toMatchObject({ state: "resolved", result: { winner: "attacker" } });
    // losses: the attacker's fleet keeps 5 destroyers and 2 attack troops; the defender's fighters and troops are gone
    const fleet = attacker.corp().military.fleets.find((f) => f.id === fleetId);
    expect(fleet.units).toMatchObject({ ds: 5, at: 2 });
    expect([units(attacker, "ds"), units(attacker, "at")]).toEqual([5, 2]);
    expect([units(defender, "lf"), units(defender, "dt")]).toEqual([0, 0]);
    expect(defender.corp().military.garrisons[EARTH]).toBeUndefined();

    // loot: 20% of the goods' value above 10,000, every stack in proportion, rounded down; credits never touched
    const value = qty * bid(ITEM);
    const takenQty = qty - stock(defender);
    expect(takenQty * bid(ITEM)).toBeLessThanOrEqual(Math.floor(0.2 * (value - 10_000)));
    expect(r.result.loot).toEqual({ [ITEM]: takenQty });
    expect(itemEscrowOf(`escrow:${raid.id}`)).toEqual({ [ITEM]: takenQty });
    expect(defender.corp().finances.credits).toBe(credits);

    // the private reports; no feed
    for (const [c, side] of [[attacker, "attacker"], [defender, "defender"]]) {
      const res = await c.api.get(c.at(`/raids/${raid.id}/report`));
      expect(res.status).toBe(200);
      expect(res.body.report).toMatchObject({ side, winner: "attacker", station: "Earth Station Prime", loot: { [ITEM]: takenQty } });
      expect(res.body.report.rounds).toHaveLength(6);
      expect(res.body.report.attacker.survivors).toMatchObject({ ds: 5, at: 2 });
      expect(JSON.stringify(res.body.report)).not.toMatch(new RegExp(`${attacker.id}|${defender.id}`));
    }
    const third = await corporation();
    expect((await third.api.get(third.at(`/raids/${raid.id}/report`))).status).toBe(404);
    expect(getState()).not.toHaveProperty("combatReports"); // AB#860: there is no global feed to write to
    expect(listAccountNotifications(defender.id).notifications.some((n) => n.title === "Your holdings were raided")).toBe(true);

    // home: the loot is the attacker's at its origin, exactly what the defender lost; the fleet is stationed
    const before = stock(attacker);
    raidTick(r.returnsAt - 1);
    expect(stored(raid.id).state).toBe("resolved");
    raidTick(r.returnsAt);
    expect(stored(raid.id).state).toBe("completed");
    expect(stock(attacker) - before).toBe(takenQty);
    expect(itemEscrowOf(`escrow:${raid.id}`)).toEqual({});
    expect(attacker.corp().military.fleets.find((f) => f.id === fleetId)).toMatchObject({ stationId: EARTH, transit: null });
    expect(itemLedgerEntries().filter((e) => e.key.startsWith(`raid:${raid.id}:`)).map((e) => e.reason)).toEqual(["raid-loot", "raid-loot-delivery"]);
  });

  it("with 15 defense troops it is a draw: nothing taken, nothing damaged; the cooldown starts anyway", async () => {
    const { attacker, defender, raid, qty } = await workedRaid({ dt: 15 });
    raidTick(raid.arrivesAt);
    expect(stored(raid.id).result).toMatchObject({ winner: "draw", loot: {} });
    expect(stock(defender)).toBe(qty);
    expect(defender.corp().raidCooldownUntil).toBe(raid.arrivesAt + RAID_OUTCOME.cooldownHours * 3_600_000);
    // the cooldown refuses the next raid, and new-player protection is not given back
    const other = await corporation({ units: { lf: 4 } });
    const f = await form(other, { lf: 4 });
    expect(declareRaid(other.id, { fleetId: f, targetCorpId: defender.publicId, targetStationId: EARTH }, raid.arrivesAt + 1).error).toMatch(/raided recently/);
    expect(declareRaid(other.id, { fleetId: f, targetCorpId: defender.publicId, targetStationId: EARTH }, raid.arrivesAt + 24 * 3_600_000).ok).toBe(true);
    expect(attacker.corp().raidReports[0].winner).toBe("draw");
  });
});

describe("ISP-179 loot", () => {
  it("never more than 20% above the floor, never more than the hold, and nothing below the floor", () => {
    const b = bid(ITEM);
    const q = (credits) => Math.ceil(credits / b);
    expect(lootFor({ [ITEM]: q(9_000) }, { ds: 10 }).items).toEqual({}); // under the 10,000 floor
    const big = lootFor({ [ITEM]: q(1_000_000) }, { ds: 10 }); // hold: 10 destroyers x 4 supply x 1,500 = 60,000
    expect(big.lootValue).toBe(60_000);
    expect(big.items[ITEM] * b).toBeLessThanOrEqual(60_000);
    const capped = lootFor({ [ITEM]: q(60_000) }, { ds: 100 });
    expect(capped.lootValue).toBe(Math.floor(0.2 * (capped.value - 10_000)));
    expect(lootFor({ Unbidden: 1_000_000 }, { ds: 10 }).items).toEqual({}); // goods nobody bids for are not taken
  });
});

describe("ISP-179 buildings", () => {
  it("a win with siege engines damages the buildings standing at the station, 4 points an engine up to 20, never below 50", async () => {
    const attacker = await corporation({ units: { se: 6, ds: 6 } });
    const defender = await corporation({ garrison: 2, goods: { [ITEM]: 10 } });
    mutateAccountState(defender.id, (s) => {
      s.corp.buildingSlots = 6;
      s.corp.buildings = [...(s.corp.buildings || []), { name: "Refinery", tier: 1, status: "Operational", paid: 40_000 }, { name: "Orbital Shipyard", tier: 1, status: "Operational", paid: 60_000, condition: 55 }];
    }, { sanitize: false, settleMining: false });
    const fleetId = await form(attacker, { se: 6, ds: 6 });
    const raid = declareRaid(attacker.id, { fleetId, targetCorpId: defender.publicId, targetStationId: EARTH }).raid;
    raidTick(raid.arrivesAt);
    expect(stored(raid.id).result.winner).toBe("attacker");
    const byName = Object.fromEntries(defender.corp().buildings.map((b) => [b.name, b.condition]));
    expect(byName.Refinery).toBe(80); // min(20, 4 x 6) = 20
    expect(byName["Orbital Shipyard"]).toBe(50); // 55 - 20, held at the floor
    expect(byName.Headquarters).toBeUndefined(); // never a target
    expect(defender.corp().raidReports[0].buildingsDamaged).toEqual([{ name: "Refinery", before: 100, after: 80, repairCost: 2_000 }, { name: "Orbital Shipyard", before: 55, after: 50, repairCost: 7_500 }]);
  });
});

describe("ISP-179 turned back, and hired defenders", () => {
  it("a target raided meanwhile turns the raid back at arrival: no battle, the fleet flies home", async () => {
    const { attacker, defender, fleetId, raid } = await workedRaid();
    mutateAccountState(defender.id, (s) => { s.corp.raidCooldownUntil = raid.arrivesAt + 1; }, { sanitize: false, settleMining: false });
    raidTick(raid.arrivesAt);
    const r = stored(raid.id);
    expect(r).toMatchObject({ state: "recalled", turnedBackAt: raid.arrivesAt });
    expect(units(defender, "lf")).toBe(14);
    raidTick(r.returnsAt);
    expect(stored(raid.id).state).toBe("completed");
    expect(attacker.corp().military.fleets.find((f) => f.id === fleetId)).toMatchObject({ stationId: EARTH, units: { ds: 6, at: 12 } });
  });

  it("a fleet the defender hired for defense, standing at the station, fights; its losses go to its contract", async () => {
    const owner = await corporation({ units: { lf: 14 } });
    const mercs = await form(owner, { lf: 14 });
    const offer = (await owner.api.post(owner.at("/mercenaries/offer")).send({ fleetId: mercs, termHours: 72, price: 5_000, collateral: 1, allowedUse: "defense" })).body.offer.id;
    const attacker = await corporation({ units: { ds: 6, at: 12 } });
    const defender = await corporation({ garrison: 10, goods: { [ITEM]: 10 } });
    expect((await defender.api.post(defender.at(`/mercenaries/${offer}/hire`)).send({})).status).toBe(200);
    const fleetId = await form(attacker, { ds: 6, at: 12 });
    const raid = declareRaid(attacker.id, { fleetId, targetCorpId: defender.publicId, targetStationId: EARTH }).raid;
    raidTick(raid.arrivesAt);
    // the same battle as the worked one: the hired fighters stand in for the defender's own
    expect(attacker.corp().military.fleets.find((f) => f.id === fleetId).units).toMatchObject({ ds: 5, at: 2 });
    const o = getState().market.mercenaryOffers.find((x) => x.id === offer);
    expect(o.lost.lf).toBe(14); // recorded on the contract; the owner loses them when the term settles
    expect(owner.corp().military.fleets.find((f) => f.id === mercs).units.lf).toBe(14);
  });
});
