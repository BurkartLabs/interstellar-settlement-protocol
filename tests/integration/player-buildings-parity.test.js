import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { PLAYER_BUILDING_CATALOGUE } from "../../server/playerBuildings.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { corpSlotsFull, fundingRequirementMessage, unleasedFor } from "../../server/routes/helpers.js";
import { leaseSlotsFullMessage } from "../../public/scripts/slotAdvice.js";

// AB#783 (ISP-93): the three player buildings moved into data/player-buildings.json with behaviour unchanged. Every
// figure here is pinned to what the build routes did before the move (ISP main 4931a66): what each costs, what it
// adds to assets, the slot it takes, and every refusal, word for word. It was run against that code first and
// passed there, so a difference now is the move changing something.

async function corporation(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 500_000;
    setup?.(state.corp);
  });
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  return { corp, post: (path) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send({}) };
}

const LEASE = { id: "lease-parity", body: "Luna", buildingSlots: 2, extractorIds: [] };

describe("building each player building through its route, as before the catalogue (AB#783)", () => {
  it("Basic Extractor Yard: 50,000 (47,000 with Supply Forecast), 36,000 of assets, a corporation slot and a lease slot", async () => {
    const p = await corporation((c) => { c.miningLeases = [{ ...LEASE, extractorIds: [] }]; });
    const before = p.corp();
    const res = await p.post(`lease/${LEASE.id}/build-extractor`);
    expect(res.status).toBe(200);
    const after = p.corp();
    expect(before.finances.credits - after.finances.credits).toBe(50_000);
    expect(after.finances.assets - before.finances.assets).toBe(36_000);
    expect(after.buildings.length - before.buildings.length).toBe(1);
    expect(after.buildings.at(-1).name).toBe("Basic Extractor Yard");
    expect(after.miningLeases[0].extractorIds).toHaveLength(1);
    expect(res.body.receipt).toBeTruthy();

    const discounted = await corporation((c) => { c.unlockedTech = ["tt-supply-forecast"]; c.miningLeases = [{ ...LEASE, extractorIds: [] }]; });
    const b2 = discounted.corp().finances.credits;
    expect((await discounted.post(`lease/${LEASE.id}/build-extractor`)).status).toBe(200);
    expect(b2 - discounted.corp().finances.credits).toBe(47_000);
  });

  it("Basic Extractor Yard refusals, word for word", async () => {
    // A lease that is not the corporation's is refused by the input check (server/gameplayInput.js) before the route.
    const noLease = await corporation();
    const nl = await noLease.post("lease/nope/build-extractor");
    expect(nl.status).toBe(400);
    expect(nl.body.error).toMatch(/^Choose one of your mining leases/);

    // A one-slot lease filled by a real build: the state's own normalising drops ids that name no extractor.
    const leaseFull = await corporation((c) => { c.miningLeases = [{ ...LEASE, buildingSlots: 1, extractorIds: [] }]; c.buildingSlots = 5; });
    expect((await leaseFull.post(`lease/${LEASE.id}/build-extractor`)).status).toBe(200);
    const lf = await leaseFull.post(`lease/${LEASE.id}/build-extractor`);
    expect(lf.status).toBe(400);
    const lc = leaseFull.corp();
    expect(lf.body.error).toBe(leaseSlotsFullMessage(lc, lc.miningLeases[0], unleasedFor(lc)));

    const corpFull = await corporation((c) => { c.miningLeases = [{ ...LEASE, extractorIds: [] }]; c.buildingSlots = 1; });
    const cf = await corpFull.post(`lease/${LEASE.id}/build-extractor`);
    expect(cf.body.error).toBe(corpSlotsFull(corpFull.corp()));

    // With Supply Forecast the charge is 47,000, but the refusal still quotes the list price of 50,000.
    const poor = await corporation((c) => { c.unlockedTech = ["tt-supply-forecast"]; c.miningLeases = [{ ...LEASE, extractorIds: [] }]; c.finances.credits = 10_000; });
    const pr = await poor.post(`lease/${LEASE.id}/build-extractor`);
    // AB#2286: the refusal quotes what the build would charge, the Supply Forecast price (47,000), not the catalogue's 50,000.
    expect(pr.body.error).toBe(fundingRequirementMessage("Basic Extractor Yard construction", poor.corp(), 47_000));
  });

  it("Assembly Facility: 60,000, 40,000 of assets, a corporation slot, one per corporation", async () => {
    const p = await corporation((c) => { c.unlockedTech = ["tt-assembly-fabrication"]; });
    const before = p.corp();
    expect((await p.post("build-assembly-facility")).status).toBe(200);
    const after = p.corp();
    expect(before.finances.credits - after.finances.credits).toBe(60_000);
    expect(after.finances.assets - before.finances.assets).toBe(40_000);
    expect(after.buildings.length - before.buildings.length).toBe(1);
    expect(after.buildings.at(-1).name).toBe("Assembly Facility");
  });

  it("Assembly Facility refusals, word for word", async () => {
    const unresearched = await corporation();
    expect((await unresearched.post("build-assembly-facility")).body.error)
      .toBe("Assembly & Fabrication Systems research is required before constructing an Assembly Facility.");

    const twice = await corporation((c) => { c.unlockedTech = ["tt-assembly-fabrication"]; c.buildingSlots = 5; });
    await twice.post("build-assembly-facility");
    expect((await twice.post("build-assembly-facility")).body.error).toBe("Your corporation already operates an Assembly Facility.");

    const full = await corporation((c) => { c.unlockedTech = ["tt-assembly-fabrication"]; c.buildingSlots = 1; });
    expect((await full.post("build-assembly-facility")).body.error)
      .toBe(`An Assembly Facility needs a free building slot. ${corpSlotsFull(full.corp())}`);

    const poor = await corporation((c) => { c.unlockedTech = ["tt-assembly-fabrication"]; c.finances.credits = 10_000; });
    expect((await poor.post("build-assembly-facility")).body.error)
      .toBe(fundingRequirementMessage("Assembly Facility construction", poor.corp(), 60_000));
  });

  it("Refinery: 75,000, 55,000 of assets, a corporation slot, at most 2", async () => {
    const p = await corporation((c) => { c.unlockedTech = ["tt-material-compression", "tt-nano-lattice"]; c.buildingSlots = 5; });
    const before = p.corp();
    expect((await p.post("build-refinery")).status).toBe(200);
    const after = p.corp();
    expect(before.finances.credits - after.finances.credits).toBe(75_000);
    expect(after.finances.assets - before.finances.assets).toBe(55_000);
    expect(after.buildings.length - before.buildings.length).toBe(1);
    expect(after.buildings.at(-1).name).toBe("Refinery");
    expect(after.refineries).toHaveLength(1);
    expect((await p.post("build-refinery")).status).toBe(200);
    expect((await p.post("build-refinery")).body.error).toBe("You already operate the maximum of 2 refineries.");
  });

  it("Refinery refusals, word for word", async () => {
    for (const tech of [[], ["tt-material-compression"], ["tt-nano-lattice"]]) {
      const p = await corporation((c) => { c.unlockedTech = tech; });
      expect((await p.post("build-refinery")).body.error, tech.join(",") || "none")
        .toBe("Refinery construction requires Material Compression I and Nano-Lattice Weaving research.");
    }
    const full = await corporation((c) => { c.unlockedTech = ["tt-material-compression", "tt-nano-lattice"]; c.buildingSlots = 1; });
    expect((await full.post("build-refinery")).body.error).toBe(`A refinery needs a free building slot. ${corpSlotsFull(full.corp())}`);

    const poor = await corporation((c) => { c.unlockedTech = ["tt-material-compression", "tt-nano-lattice"]; c.finances.credits = 10_000; });
    expect((await poor.post("build-refinery")).body.error).toBe(fundingRequirementMessage("Refinery construction", poor.corp(), 75_000));
  });
});

describe("the catalogue is served read-only to the page (AB#783)", () => {
  it("GET /api/bootstrap carries every player building, signed out, and nothing of any player's", async () => {
    const { app } = await getApp();
    const player = await registerAccount(app); // a player exists; none of their data may appear
    const res = await request(app).get("/api/bootstrap");
    expect(res.status).toBe(200);
    expect(res.body.playerBuildings).toEqual(JSON.parse(JSON.stringify(PLAYER_BUILDING_CATALOGUE)));
    const allowed = ["assetValue", "cap", "cost", "effect", "id", "name", "price", "researchGates", "since", "slot", "tiers", "upgrades"]; // upgrades: ISP-97; tiers: ISP-102 (AB#794)
    for (const b of res.body.playerBuildings) expect(Object.keys(b).filter((k) => !allowed.includes(k)), b.id).toEqual([]);
    const served = JSON.stringify(res.body.playerBuildings);
    for (const own of [player.account.id, player.body.email, player.body.corpName]) expect(served).not.toContain(own);
  });
});
