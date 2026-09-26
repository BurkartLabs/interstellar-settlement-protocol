import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { ECONOMY, operationCostPerHourFor, yardUpgradeTo } from "../../server/economy.js";

// ISP-101 (AB#793): POST /gameplay/buildings/:buildingId/upgrade and the Basic Extractor Yard's tiers,
// docs/design/upgrades.md (AB#791). Every number the route charges or sets comes from data/economy.json.
const EARTH = "lease-793";

/** A corporation at `level` with one tier-1 yard (bld-793a / ext-793a) on Earth, plus an Assembly Facility. */
async function corporation({ level = 8, credits = 1_000_000 } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.level = level;
    corp.finances.credits = credits;
    const now = Date.now();
    corp.offices = [{ stationId: "earth-station-prime", rentedAt: now, rentedUntil: now + 7 * 86_400_000, durationDays: 7 }];
    corp.employeeCount = 5;
    corp.miningLeases = [{ id: EARTH, body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: ["ext-793a"] }];
    corp.buildings = [...corp.buildings, { id: "bld-793a", name: "Basic Extractor Yard", tier: 1, status: "Operational" }, { id: "bld-793f", name: "Assembly Facility", tier: 1, status: "Operational" }];
    corp.mining.silicateExtractors = [{ id: "ext-793a", name: "Basic Extractor Yard #1", tier: 1, active: false, leaseId: EARTH, body: "Earth", buildingId: "bld-793a", totalMined: 0, totalSpent: 0 }];
  });
  const api = authed(app, accessToken);
  const upgrade = (buildingId, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/buildings/${encodeURIComponent(buildingId)}/upgrade`).send(body);
  const start = (amount) => api.post(`/api/accounts/${account.id}/gameplay/lease/${EARTH}/start-mining`).send({ hours: 1, amount, extractorId: "ext-793a" });
  const corp = () => getAccountById(account.id).state.corp;
  const backOnline = () => mutateAccountState(account.id, (s) => { s.corp.mining.silicateExtractors[0].upgradingUntil = null; });
  const idle = () => mutateAccountState(account.id, (s) => { Object.assign(s.corp.mining.silicateExtractors[0], { active: false, endsAt: null, startedAt: null }); });
  /** What an upgrade may change, to check a refusal changed none of it. */
  const snapshot = () => JSON.stringify({ c: corp().finances.credits, a: corp().finances.assets, b: corp().buildings, x: corp().mining.silicateExtractors.map(({ id, tier, upgradingUntil, active }) => ({ id, tier, upgradingUntil, active })) });
  return { app, id: account.id, upgrade, start, corp, backOnline, idle, snapshot };
}

describe("upgrading an extractor yard (AB#793)", () => {
  it("each upgrade from tier 1 to 5 charges the table's price, raises the tier by one, and sets the table's cap and cost curve", async () => {
    const c = await corporation();
    // Tier 1 first: the yard as built.
    expect((await c.start(610)).status).toBe(200);
    expect(c.corp().mining.silicateExtractors[0].throughputPerHour).toBe(250);
    c.idle();
    for (const to of [2, 3, 4, 5]) {
      const row = yardUpgradeTo(to);
      const before = c.corp();
      const res = await c.upgrade("bld-793a");
      expect(res.status, JSON.stringify(res.body.error)).toBe(200);
      const after = c.corp();
      expect(before.finances.credits - after.finances.credits).toBe(row.upgradeCost);
      expect(after.finances.assets - before.finances.assets).toBe(row.assetValue);
      expect(after.buildings.find((b) => b.id === "bld-793a").tier).toBe(to);
      expect(after.mining.silicateExtractors[0].tier).toBe(to);
      expect(res.body.receipt).toMatchObject({ action: "upgrade-building", costCredits: row.upgradeCost });
      // Offline for the table's hours: no cycle starts.
      expect(after.mining.silicateExtractors[0].upgradingUntil - Date.now()).toBeGreaterThan(row.offlineHours * 3_600_000 - 60_000);
      const offline = await c.start(40);
      expect(offline.status).toBe(400);
      expect(offline.body.error).toMatch(/offline until/);
      c.backOnline();
      // Back online, the cap is the tier's and the running cost follows the tier's curve.
      expect((await c.start(9999 % 611)).status).toBe(200);
      const ex = c.corp().mining.silicateExtractors[0];
      expect(ex.throughputPerHour).toBe(Math.min(row.throughputCap, 9999 % 611));
      expect(ex.operationCostPerHour).toBe(operationCostPerHourFor(ex.throughputPerHour, undefined, { tier: to }));
      c.idle();
    }
  });

  it("the design's running costs at each tier's best setting: 2,618, 3,262 and 4,176 an hour for tiers 1 to 3", () => {
    expect(operationCostPerHourFor(146, undefined, { tier: 1 })).toBe(2618);
    expect(operationCostPerHourFor(182, undefined, { tier: 2 })).toBe(3262);
    expect(operationCostPerHourFor(232, undefined, { tier: 3 })).toBe(4176);
  });

  it("past the last tier: 400 with the reason, and nothing changes", async () => {
    const c = await corporation();
    mutateAccountState(c.id, (s) => { s.corp.buildings.find((b) => b.id === "bld-793a").tier = 5; s.corp.mining.silicateExtractors[0].tier = 5; });
    const before = c.snapshot();
    const res = await c.upgrade("bld-793a");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tier 5, its last/);
    expect(c.snapshot()).toBe(before);
  });

  it("past the level's maxUpgradeTier: 400 with the reason, and nothing changes", async () => {
    const c = await corporation({ level: 1 });
    expect(c.corp().unlocks.maxUpgradeTier).toBe(1);
    const before = c.snapshot();
    const res = await c.upgrade("bld-793a");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allows tier 1; tier 2 needs a higher Corporation Level/);
    expect(c.snapshot()).toBe(before);
  });

  it("each level's maxUpgradeTier is the design's: 1, 2, 2, 3, 3, 4, 4, 5, 5, 5", async () => {
    const tiers = [];
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) tiers.push((await corporation({ level })).corp().unlocks.maxUpgradeTier);
    expect(tiers).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 5]);
  });

  it("refuses a running yard, one short of credit, and a building with no tiers yet, changing nothing", async () => {
    const c = await corporation({ credits: 45_000 });
    expect((await c.start(40)).status).toBe(200);
    let before = c.snapshot();
    let res = await c.upgrade("bld-793a");
    expect([res.status, res.body.error]).toEqual([400, expect.stringMatching(/running a mining cycle/)]);
    expect(c.snapshot()).toBe(before);

    c.idle();
    mutateAccountState(c.id, (s) => { s.corp.finances.credits = 39_999; });
    before = c.snapshot();
    res = await c.upgrade("bld-793a");
    expect([res.status, res.body.error]).toEqual([400, expect.stringMatching(/costs/)]);
    expect(c.snapshot()).toBe(before);

    before = c.snapshot();
    res = await c.upgrade("bld-793f");
    expect([res.status, res.body.error]).toEqual([400, "The Assembly Facility has no upgrades yet."]);
    expect(c.snapshot()).toBe(before);
  });

  it("takes nothing from the request but the id: a tier, a cost or a level in the body changes nothing it charges or sets", async () => {
    const c = await corporation();
    const before = c.corp().finances.credits;
    const res = await c.upgrade("bld-793a", { tier: 5, toTier: 5, upgradeCost: 1, cost: 1, level: 10, credits: 1e9 });
    expect(res.status).toBe(200);
    expect(before - c.corp().finances.credits).toBe(yardUpgradeTo(2).upgradeCost);
    expect(c.corp().mining.silicateExtractors[0].tier).toBe(2);
  });
});

describe("the upgrade route's ids are checked, not trusted (AB#793, DOCTRINE constraint 1)", () => {
  it("another corporation's building gets exactly what an unknown id gets, and nothing changes on either side", async () => {
    const mine = await corporation();
    const theirs = await corporation();
    mutateAccountState(theirs.id, (s) => {
      s.corp.buildings.find((b) => b.id === "bld-793a").id = "bld-793-theirs";
      s.corp.mining.silicateExtractors[0].buildingId = "bld-793-theirs";
    });
    const [mineBefore, theirsBefore] = [mine.snapshot(), theirs.snapshot()];
    const unknown = await mine.upgrade("bld-000000-nothing");
    const cross = await mine.upgrade("bld-793-theirs");
    expect(unknown.status).toBe(400);
    expect([cross.status, cross.body.error]).toEqual([unknown.status, unknown.body.error]);
    expect(mine.snapshot()).toBe(mineBefore);
    expect(theirs.snapshot()).toBe(theirsBefore);
  });

  it.each([
    ["a negative", "-1"], ["NaN", "NaN"], ["a float", "2.5"], ["an oversized number", "9".repeat(80)], ["Infinity", "Infinity"], ["a long string", "b".repeat(10_000)]
  ])("%s as the building id: 400, and nothing changes", async (_label, id) => {
    const c = await corporation();
    const before = c.snapshot();
    const res = await c.upgrade(id);
    expect(res.status).toBe(400);
    expect(c.snapshot()).toBe(before);
  });

  it("needs a signed-in owner: no token is 401, another account's token is 403", async () => {
    const c = await corporation();
    const other = await corporation();
    expect((await request(c.app).post(`/api/accounts/${c.id}/gameplay/buildings/bld-793a/upgrade`)).status).toBe(401);
    const { accessToken } = await registerAccount(c.app);
    expect((await authed(c.app, accessToken).post(`/api/accounts/${c.id}/gameplay/buildings/bld-793a/upgrade`)).status).toBe(403);
    expect(other.corp().mining.silicateExtractors[0].tier).toBe(1);
  });
});
