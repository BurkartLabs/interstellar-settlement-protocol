import { describe, it, expect, afterEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState, applyMiningOperations } from "../../server/gameState.js";
import { accountsStore } from "../../server/game/store.js";
import { RAID_OUTCOME, raidTick, repairCostFor } from "../../server/raidResolution.js";
import { buildingCostBasis } from "../../server/buildingRemoval.js";
import { declareRaid } from "../../server/raids.js";
import { ledgerEntries, settlementTotals } from "../../server/settlement.js";
import { applyRefineryOperations } from "../../server/game/refining.js";
import { REFINERY_CHAINS } from "../../server/game/catalog.js";
import { conditionOf, outputFactorOf } from "../../server/game/buildingCondition.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// ISP-287 (AB#994; docs/design/v0.10-raids-mercenaries.md, section 3): a raid the attacker wins damages the buildings at
// the station, never below condition 50; a damaged building's output is multiplied by condition / 100 until repaired;
// a repair restores 100 for (100 - condition)% of the cost basis x 25%, through settleTransfer into the fee sink, and
// with too few credits repairs nothing. The damage and its price are AB#873's (server/raidResolution.js).
const EARTH = "earth-station-prime";
const DAY = 86_400_000;
const HOUR = 3_600_000;

async function corporation({ units = {}, garrison = 0, credits = 500_000 } = {}) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const id = reg.account.id;
  mutateAccountState(id, (state) => {
    state.corp.currentStationId = EARTH;
    state.corp.finances.credits = credits;
    state.corp.military = { units: { ...units, dt: garrison }, garrisons: garrison ? { [EARTH]: garrison } : {} };
    state.corp.inventory = { ...(state.corp.inventory || {}), [EARTH]: { Silicates: 10 } };
  }, { sanitize: false, settleMining: false });
  accountsStore.accounts[id].createdAt = Date.now() - 30 * DAY;
  const api = authed(app, reg.accessToken);
  const at = (p) => `/api/accounts/${id}/gameplay${p}`;
  const corp = () => getAccountById(id).state.corp;
  return { id, api, at, corp, publicId: corp().publicId };
}

/** A defender with a Refinery (40,000 paid) and an Orbital Shipyard (60,000, already at 55), raided by 6 siege engines. */
async function raided() {
  const attacker = await corporation({ units: { se: 6, ds: 6 } });
  const defender = await corporation({ garrison: 2 });
  mutateAccountState(defender.id, (s) => {
    s.corp.buildingSlots = 6;
    s.corp.buildings = [...(s.corp.buildings || []), { name: "Refinery", tier: 1, status: "Operational", paid: 40_000 }, { name: "Orbital Shipyard", tier: 1, status: "Operational", paid: 60_000, condition: 55 }];
  }, { sanitize: false, settleMining: false });
  const fleetId = (await attacker.api.post(attacker.at("/fleets/form")).send({ se: 6, ds: 6 })).body.fleet.id;
  const raid = declareRaid(attacker.id, { fleetId, targetCorpId: defender.publicId, targetStationId: EARTH }).raid;
  raidTick(raid.arrivesAt);
  const building = (name) => defender.corp().buildings.find((b) => b.name === name);
  return { attacker, defender, raid, building };
}

afterEach(() => vi.restoreAllMocks());

describe("ISP-287 a raid's damage and its price (AB#994)", () => {
  it("holds at the floor, so the repair price is capped at 50% of the cost basis x 25%, the price the report quoted", async () => {
    const { defender, building } = await raided();
    const yard = building("Orbital Shipyard");
    expect(conditionOf(yard)).toBe(RAID_OUTCOME.conditionFloor); // 55 - 20, held at 50: never destroyed
    const cap = Math.round(0.5 * buildingCostBasis(yard) * (RAID_OUTCOME.repairPctOfCost / 100));
    expect(repairCostFor(yard)).toBe(cap);
    expect(cap).toBe(7_500);
    const report = defender.corp().raidReports[0].buildingsDamaged;
    expect(report.find((b) => b.name === "Orbital Shipyard").repairCost).toBe(repairCostFor(yard));
    const listed = (await defender.api.get(defender.at("/building-repairs"))).body.buildings;
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: yard.id, name: "Orbital Shipyard", condition: 50, outputPct: 50, repairCost: 7_500 }),
      expect.objectContaining({ id: building("Refinery").id, name: "Refinery", condition: 80, outputPct: 80, repairCost: 2_000 })
    ]));
    expect(listed.some((b) => b.name === "Headquarters")).toBe(false);
  });
});

describe("ISP-287 repairing (AB#994)", () => {
  it("debits the server's price through settleTransfer into the fee sink and restores full condition", async () => {
    const { defender, building } = await raided();
    const yard = building("Orbital Shipyard");
    const before = defender.corp().finances.credits;
    const sink = settlementTotals().sinks.fee || 0;
    const res = await defender.api.post(defender.at(`/buildings/${yard.id}/repair`)).send({ cost: 1 }); // a price sent is ignored
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.receipt).toMatchObject({ action: "repair-building", title: "Building Repaired", costCredits: 7_500 });
    expect(res.body.state.corp.buildings.find((b) => b.id === yard.id).condition).toBe(100);
    expect(res.body.passwordHash).toBeUndefined(); // the sanitised account, as every route returns it
    expect(before - defender.corp().finances.credits).toBe(7_500);
    expect(settlementTotals().sinks.fee - sink).toBe(7_500);
    const entry = ledgerEntries().filter((e) => e.from === defender.id && e.reason === "repair").at(-1);
    expect(entry).toMatchObject({ to: "sink:fee", credits: 7_500 });
    expect(defender.corp().finances.expensesByCategory["repair-paid"]).toBe(7_500);
    // repaired: nothing left to repair
    const again = await defender.api.post(defender.at(`/buildings/${yard.id}/repair`)).send({});
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/not damaged/);
    expect(defender.corp().finances.credits).toBe(before - 7_500);
  });

  it("with too few credits repairs nothing and moves nothing", async () => {
    const { defender, building } = await raided();
    const yard = building("Orbital Shipyard");
    mutateAccountState(defender.id, (s) => { s.corp.finances.credits = 7_499; }, { sanitize: false, settleMining: false });
    const entries = ledgerEntries().length;
    const res = await defender.api.post(defender.at(`/buildings/${yard.id}/repair`)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/costs 7,500 credits; you have 7,499 credits\. Nothing was repaired/);
    expect(building("Orbital Shipyard").condition).toBe(50);
    expect(defender.corp().finances.credits).toBe(7_499);
    expect(ledgerEntries().length).toBe(entries);
  });

  it("only the owner repairs: another corporation's building, a made-up id and another account are refused, changing nothing", async () => {
    const { defender, building } = await raided();
    const stranger = await corporation({ credits: 1_000_000 });
    const yard = building("Orbital Shipyard");
    const theirs = await stranger.api.post(stranger.at(`/buildings/${yard.id}/repair`)).send({});
    expect(theirs.status).toBe(400); // not one of the caller's buildings: the same answer as an id that does not exist
    const across = await stranger.api.post(`/api/accounts/${defender.id}/gameplay/buildings/${yard.id}/repair`).send({});
    expect(across.status).toBe(403);
    for (const bad of ["no-such-building", "x".repeat(500), "%00", "..%2F..%2Fadmin"]) {
      const r = await defender.api.post(defender.at(`/buildings/${bad}/repair`)).send({});
      expect(r.status, bad).toBe(400);
    }
    expect(building("Orbital Shipyard").condition).toBe(50);
    expect(stranger.corp().finances.credits).toBe(1_000_000);
    expect(getState().settlement?.sinks).toEqual(settlementTotals().sinks);
  });
});

describe("ISP-287 a damaged building's output (AB#994)", () => {
  it("an extractor yard at 80 condition mines 80%, and the full amount once repaired", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime roll
    const start = 1_700_000_000_000;
    const mined = (condition) => {
      const corp = makeCorp({
        finances: { credits: 10_000_000 },
        miningLeases: [{ id: "lease-1", body: "Earth" }],
        buildings: [{ id: "bld-yard", name: "Basic Extractor Yard", leaseId: "lease-1", status: "Operational", ...(condition == null ? {} : { condition }) }],
        mining: { silicateExtractors: [makeExtractor({ buildingId: "bld-yard", startedAt: start, lastTickAt: start, endsAt: start + 2 * HOUR, throughputPerHour: 600, operationCostPerHour: 0, leaseId: "lease-1" })] }
      });
      applyMiningOperations(corp, start + HOUR);
      return corp.mining.silicateExtractors[0].minedThisCycle;
    };
    const full = mined(null);
    expect(full).toBeGreaterThan(0);
    expect(mined(80)).toBe(Math.floor(full * 0.8));
    expect(mined(100)).toBe(full); // repaired
  });

  it("a Refinery at 80 condition delivers 80% of its run, rounded down, and the full run once repaired", () => {
    const chainId = Object.keys(REFINERY_CHAINS).find((id) => (REFINERY_CHAINS[id].building || "refinery") === "refinery");
    const delivered = (condition) => {
      const corp = makeCorp({
        buildings: [{ id: "bld-ref", name: "Refinery", status: "Operational", ...(condition == null ? {} : { condition }) }],
        refineries: [{ id: "ref-1", name: "Refinery #1", tier: 1, active: true, chainId, stationId: EARTH, cycleScale: 1, outputs: [{ item: "Refined Test", quantity: 125 }], startedAt: 1, lastTickAt: 1, endsAt: 2 }]
      });
      applyRefineryOperations(corp, 3);
      return corp.inventory?.[EARTH]?.["Refined Test"] ?? 0;
    };
    expect(delivered(null)).toBe(125);
    expect(delivered(80)).toBe(100);
    expect(delivered(50)).toBe(62);
    expect(delivered(100)).toBe(125);
    expect(outputFactorOf({ condition: 80 })).toBe(0.8);
  });
});
