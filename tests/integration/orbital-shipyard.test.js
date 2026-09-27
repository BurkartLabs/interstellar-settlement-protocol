import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { ECONOMY } from "../../server/economy.js";
import { playerBuilding } from "../../server/playerBuildings.js";

// ISP-170 (AB#864): the Orbital Shipyard, one entry in data/player-buildings.json built through POST /gameplay/build.
// Each of the four gates refuses on its own, with nothing debited and nothing built, and then it builds.
const COST = ECONOMY.buildings.orbitalShipyardCost;

async function corporation(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.level = 10;
    corp.buildingSlots = 4;
    corp.unlockedTech = ["tt-fleet-coordination"];
    corp.finances.credits = COST + 1000;
    setup?.(corp);
  });
  const corp = () => getAccountById(account.id).state.corp;
  const state = () => JSON.stringify(getAccountById(account.id).state);
  return { id: account.id, api: authed(app, accessToken), path: `/api/accounts/${account.id}/gameplay/build`, corp, state };
}

/** Posts the build and says what changed: the reply, and the credits, buildings and assets before and after. */
async function build(c) {
  const before = { credits: c.corp().finances.credits, buildings: c.corp().buildings.length, assets: c.corp().finances.assets || 0 };
  const whole = c.state();
  const res = await c.api.post(c.path).send({ buildingId: "orbital-shipyard" });
  const after = { credits: c.corp().finances.credits, buildings: c.corp().buildings.length, assets: c.corp().finances.assets || 0 };
  return { res, before, after, unchanged: c.state() === whole };
}

describe("the Orbital Shipyard (AB#864)", () => {
  it("is a catalogue entry with its price, slot, level and research", () => {
    const b = playerBuilding("orbital-shipyard");
    expect(b).toMatchObject({ name: "Orbital Shipyard", slot: "corporation", minLevel: 10, researchGates: ["tt-fleet-coordination"], cap: { perCorporation: 1 }, cost: COST });
  });

  it("refuses below its level, with nothing debited", async () => {
    const c = await corporation((corp) => { corp.level = 9; });
    const { res, before, after, unchanged } = await build(c);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Orbital Shipyard construction requires Corporation Level 10 (you are level 9).");
    expect(after).toEqual(before);
    expect(unchanged, "nothing in the account changed").toBe(true);
  });

  it("refuses without Fleet Coordination Matrix, with nothing debited", async () => {
    const c = await corporation((corp) => { corp.unlockedTech = []; });
    const { res, before, after, unchanged } = await build(c);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Orbital Shipyard construction requires Fleet Coordination Matrix research.");
    expect(after).toEqual(before);
    expect(unchanged, "nothing in the account changed").toBe(true);
  });

  it("refuses with no free building slot, with nothing debited", async () => {
    const c = await corporation();
    // the level's own unlocks set the slots after every change, so fill whatever that leaves
    mutateAccountState(c.id, (state) => {
      while (state.corp.buildings.length < state.corp.buildingSlots) state.corp.buildings.push({ name: "Storage Annex", tier: 1, status: "Operational" });
    });
    expect(c.corp().buildings.length).toBe(c.corp().buildingSlots);
    const { res, before, after, unchanged } = await build(c);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^The Orbital Shipyard needs a free building slot\./);
    expect(after).toEqual(before);
    expect(unchanged, "nothing in the account changed").toBe(true);
  });

  it("refuses short of its price, with nothing debited", async () => {
    const c = await corporation((corp) => { corp.finances.credits = COST - 1; });
    const { res, before, after, unchanged } = await build(c);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Orbital Shipyard construction/);
    expect(after).toEqual(before);
    expect(unchanged, "nothing in the account changed").toBe(true);
  });

  it("builds with every gate met: takes a slot, the price and the asset, says what it makes possible, and only one", async () => {
    const c = await corporation();
    const { res, before, after } = await build(c);
    expect(res.status).toBe(200);
    expect(after.credits).toBe(before.credits - COST);
    expect(after.buildings).toBe(before.buildings + 1);
    expect(after.assets).toBe(before.assets + ECONOMY.buildings.orbitalShipyardAssetValue);
    expect(c.corp().buildings.at(-1)).toMatchObject({ name: "Orbital Shipyard", status: "Operational" });
    expect(res.body.receipt.grants).toContainEqual({ label: "Now possible", value: "Queue ships in the Orbital Shipyard section of the Station page" });
    const again = await build(c);
    expect(again.res.status).toBe(400);
    expect(again.res.body.error).toBe("You already operate the maximum of 1 of the Orbital Shipyard.");
    expect(again.after).toEqual(again.before);
  });

  it("will not be built by another account's token", async () => {
    const owner = await corporation();
    const { app } = await getApp();
    const { accessToken } = await registerAccount(app);
    const res = await authed(app, accessToken).post(owner.path).send({ buildingId: "orbital-shipyard" });
    expect([401, 403, 404]).toContain(res.status);
    expect(owner.corp().buildings.some((b) => b.name === "Orbital Shipyard")).toBe(false);
  });
});
