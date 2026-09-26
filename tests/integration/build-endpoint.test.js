import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { PLAYER_BUILDING_CATALOGUE } from "../../server/playerBuildings.js";
import { CONSTRUCTIONS, construct } from "../../server/construction.js";

// ISP-94 (AB#784): one build endpoint, POST /gameplay/build { buildingId, leaseId? }, that every player building uses.
// The old per-building routes are wrappers over it, so each is checked against it here, state for state.

const ALL_GATES = [...new Set(PLAYER_BUILDING_CATALOGUE.flatMap((b) => b.researchGates))];
const earthLease = (used = 0, slots = 2) => ({
  id: "lease-earth",
  body: "Earth",
  leaseType: "Silicate Extraction",
  buildingSlots: slots,
  extractorIds: Array.from({ length: used }, (_, i) => `ext-basic-${i + 1}`)
});

/** A corporation that can build anything in the catalogue once, unless `setup` says otherwise. */
async function corporation(setup = () => {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.finances.credits = 1_000_000;
    corp.unlockedTech = [...ALL_GATES];
    corp.buildingSlots = 6;
    corp.buildings = [];
    corp.miningLeases = [earthLease()];
    setup(corp);
  });
  return { app, id: account.id, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp, state: () => JSON.stringify(getAccountById(account.id).state) };
}

const build = (c, body) => c.api.post(`/api/accounts/${c.id}/gameplay/build`).send(body);

/** A building or extractor without the random id the server gives it after every change (AB#792). */
const withoutIds = ({ id, buildingId, ...rest }) => rest;
/** What a build changes, without the ledger's timestamps or the server-made ids. */
const built = (corp) => ({
  buildings: corp.buildings.map(withoutIds),
  credits: corp.finances.credits,
  assets: corp.finances.assets,
  refineries: corp.refineries ?? [],
  extractors: (corp.mining?.silicateExtractors ?? []).map(withoutIds),
  leases: corp.miningLeases
});

const OLD_ROUTES = {
  "basic-extractor-yard": { path: "lease/lease-earth/build-extractor", body: { buildingId: "basic-extractor-yard", leaseId: "lease-earth" } },
  "assembly-facility": { path: "build-assembly-facility", body: { buildingId: "assembly-facility" } },
  refinery: { path: "build-refinery", body: { buildingId: "refinery" } }
};

describe("POST /gameplay/build (ISP-94)", () => {
  it("has an old route for every building in the catalogue, and the old routes are the only buildings", () => {
    expect(Object.keys(OLD_ROUTES).sort()).toEqual(PLAYER_BUILDING_CATALOGUE.map((b) => b.id).sort());
    expect(Object.keys(CONSTRUCTIONS).sort()).toEqual(PLAYER_BUILDING_CATALOGUE.map((b) => b.id).sort());
  });

  for (const [buildingId, old] of Object.entries(OLD_ROUTES)) {
    it(`building ${buildingId} through it leaves the same state and answer as its old route`, async () => {
      const a = await corporation();
      const b = await corporation();
      const viaOld = await a.api.post(`/api/accounts/${a.id}/gameplay/${old.path}`).send({});
      const viaNew = await build(b, old.body);
      expect(viaOld.status).toBe(200);
      expect(viaNew.status).toBe(200);
      expect(built(b.corp())).toEqual(built(a.corp()));
      expect(viaNew.body.receipt).toEqual(viaOld.body.receipt);
      expect(b.corp().buildings.map((x) => x.name)).toEqual([PLAYER_BUILDING_CATALOGUE.find((x) => x.id === buildingId).name]);
      expect(b.corp().buildings[0].id).toMatch(/^bld-/); // AB#792 gives it one after the build's mutation
      expect(b.corp().finances.credits).toBeLessThan(1_000_000);
    });
  }

  it("the Supply Forecast discount on a yard is the same through both", async () => {
    const withForecast = (corp) => corp.unlockedTech.push("tt-supply-forecast");
    const a = await corporation(withForecast);
    const b = await corporation(withForecast);
    await a.api.post(`/api/accounts/${a.id}/gameplay/lease/lease-earth/build-extractor`).send({});
    await build(b, OLD_ROUTES["basic-extractor-yard"].body);
    expect(b.corp().finances.credits).toBe(a.corp().finances.credits);
  });

  describe("each refusal is a 400 with its own message, and changes nothing", () => {
    const cases = [
      ["an unknown building", () => {}, { buildingId: "orbital-casino" }, /from the game's list/],
      ["missing research", (corp) => { corp.unlockedTech = []; }, { buildingId: "refinery" }, /requires Material Compression I and Nano-Lattice Weaving research/],
      ["the cap reached", (corp) => { corp.buildings = [{ name: "Assembly Facility", tier: 1, status: "Operational" }]; }, { buildingId: "assembly-facility" }, /already operates an Assembly Facility/],
      ["no corporation slot", (corp) => { corp.buildingSlots = 1; corp.buildings = [{ name: "Assembly Facility", tier: 1, status: "Operational" }]; }, { buildingId: "refinery" }, /needs a free building slot/],
      // A full lease as the game keeps one: its two extractors are yards the corporation owns (slot-errors.test.js).
      ["the lease full", (corp) => { corp.miningLeases = [earthLease(2, 2)]; corp.buildings = [{ name: "Basic Extractor Yard" }, { name: "Basic Extractor Yard" }]; }, { buildingId: "basic-extractor-yard", leaseId: "lease-earth" }, /used both of its building slots/],
      ["too few credits", (corp) => { corp.finances.credits = 10; }, { buildingId: "refinery" }, /Refinery construction/],
      ["a yard with no lease named", () => {}, { buildingId: "basic-extractor-yard" }, /Choose one of your mining leases/],
      ["a lease that is not the caller's", () => {}, { buildingId: "basic-extractor-yard", leaseId: "lease-somebody-else" }, /not on your books/],
      ["a lease named for a building that does not stand on one", () => {}, { buildingId: "refinery", leaseId: "lease-earth" }, /not built on a lease/]
    ];
    for (const [what, setup, body, message] of cases) {
      it(what, async () => {
        const c = await corporation(setup);
        const before = c.state();
        const res = await build(c, body);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(message);
        expect(c.state()).toBe(before);
      });
    }
  });

  it("refuses hostile values for either field with a 400 and no change", async () => {
    const c = await corporation();
    const hostile = [5, -1, 0, 2.5, "NaN", "Infinity", 1e308, null, true, [], {}, ["refinery"], { id: "refinery" }, "x".repeat(10_000), " "];
    for (const value of hostile) {
      for (const body of [{ buildingId: value }, { buildingId: "basic-extractor-yard", leaseId: value }]) {
        const before = c.state();
        const res = await build(c, body);
        expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
        expect(c.state()).toBe(before);
      }
    }
    const before = c.state();
    expect((await build(c, {})).status).toBe(400);
    expect((await c.api.post(`/api/accounts/${c.id}/gameplay/build`).set("content-type", "text/plain").send("refinery")).status).toBe(400);
    expect(c.state()).toBe(before);
  });

  it("reads no cost, count or effect from the request", async () => {
    const c = await corporation();
    const res = await build(c, { buildingId: "refinery", cost: 0, credits: 9_999_999, assetValue: 1e9, quantity: 50, tier: 9 });
    expect(res.status).toBe(200);
    const corp = c.corp();
    expect(corp.buildings.map(withoutIds)).toEqual([{ name: "Refinery", tier: 1, status: "Operational" }]);
    expect(corp.finances.credits).toBe(1_000_000 - PLAYER_BUILDING_CATALOGUE.find((b) => b.id === "refinery").cost);
  });

  it("answers 401 without a login and 403 for another account's id", async () => {
    const mine = await corporation();
    const theirs = await corporation();
    const before = theirs.state();
    const res = await mine.api.post(`/api/accounts/${theirs.id}/gameplay/build`).send({ buildingId: "refinery" });
    expect(res.status).toBe(403);
    const { default: request } = await import("supertest");
    expect((await request(mine.app).post(`/api/accounts/${theirs.id}/gameplay/build`).send({ buildingId: "refinery" })).status).toBe(401);
    expect(theirs.state()).toBe(before);
  });

  it("a building it builds is in the snapshot on disk, so it survives a restart", async () => {
    const c = await corporation();
    expect((await build(c, { buildingId: "refinery" })).status).toBe(200);
    const { loadAccountsSnapshotFromDisk } = await import("../../server/game/store.js");
    const onDisk = loadAccountsSnapshotFromDisk();
    const account = Object.values(onDisk.accounts).find((a) => a.id === c.id);
    expect(account.state.corp.buildings.map(withoutIds)).toEqual([{ name: "Refinery", tier: 1, status: "Operational" }]);
    expect(account.state.corp.buildings[0].id).toBe(c.corp().buildings[0].id);
    expect(account.state.corp.refineries.map((r) => r.id)).toEqual(["ref-1"]);
  });
});

describe("construct() fails closed (ISP-94)", () => {
  const corp = () => ({ unlockedTech: [], buildings: [], buildingSlots: 4, finances: { credits: 1_000_000, assets: 0 }, miningLeases: [] });

  it("a catalogue entry with no construction of its own is not built, and nothing changes", () => {
    const c = corp();
    const before = JSON.stringify(c);
    const building = { id: "ferric-mining-complex", name: "Ferric Mining Complex", slot: "corporation", researchGates: [], cap: {}, cost: 10, assetValue: 10 };
    expect(construct(c, building, null)).toMatchObject({ outcome: "not-constructible" });
    expect(JSON.stringify(c)).toBe(before);
  });

  it("no building at all is not built", () => {
    const c = corp();
    const before = JSON.stringify(c);
    expect(construct(c, undefined, null)).toMatchObject({ outcome: "unknown-building" });
    expect(JSON.stringify(c)).toBe(before);
  });
});
