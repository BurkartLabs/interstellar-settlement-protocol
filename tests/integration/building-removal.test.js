import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, REFINERY_CHAINS } from "../../server/gameState.js";
import { miningTick, refineryTick, fabricationTick } from "../../server/ticks.js";
import { removeBuilding, buildingAssetValue, buildingCostBasis } from "../../server/buildingRemoval.js";
import { leaseSlotsUsed, leaseHasRoom } from "../../public/scripts/leaseSlots.js";

// AB#2569: removing a building cleanly, for default recovery (AB#993). Buildings are built through the real route,
// removed inside a mutation as recovery will, and the game's own ticks run afterwards.
const CHAIN = Object.values(REFINERY_CHAINS).find((ch) => !(ch.requiresTechIds || []).length) || Object.values(REFINERY_CHAINS)[0];
const GATES = ["tt-assembly-fabrication", "tt-material-compression", "tt-nano-lattice", "tt-containment-physics", "tt-fleet-coordination"];

async function corporation() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.level = 12;
    corp.finances.credits = 5_000_000;
    corp.buildingSlots = 12;
    corp.currentStationId = "earth-station-prime";
    corp.unlockedTech = [...new Set([...GATES, ...(CHAIN.requiresTechIds || [])])];
    corp.inventory = { "earth-station-prime": { [CHAIN.inputs[0].item]: CHAIN.inputs[0].quantityPerCycle * 10 } };
    corp.miningLeases = [
      { id: "lease-earth", body: "Earth", issuedAt: 1, cost: 20_000, buildingSlots: 4, extractorIds: [] },
      { id: "lease-luna", body: "Luna", issuedAt: 1, cost: 30_000, buildingSlots: 4, extractorIds: [] }
    ];
  });
  const api = authed(app, accessToken);
  const post = (p, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${p}`).send(body);
  const corp = () => getAccountById(account.id).state.corp;
  const build = async (buildingId, leaseId) => {
    const res = await post("build", { buildingId, ...(leaseId ? { leaseId } : {}) });
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  };
  const remove = (buildingId, now = Date.now()) => {
    let result;
    mutateAccountState(account.id, (s) => { result = removeBuilding(s.corp, buildingId, now); });
    return result;
  };
  return { id: account.id, post, corp, build, remove };
}

describe("removing an extractor yard (AB#2569)", () => {
  it("takes its extractor and lease slot, drops the assets, and the mining model agrees; the next yard gets a new id", async () => {
    const c = await corporation();
    for (let i = 0; i < 3; i++) await c.build("basic-extractor-yard", "lease-earth");
    const yards = c.corp().buildings.filter((b) => b.name === "Basic Extractor Yard");
    const middle = yards[1];
    const itsExtractor = c.corp().mining.silicateExtractors.find((e) => e.buildingId === middle.id);
    mutateAccountState(c.id, (s) => { const e = s.corp.mining.silicateExtractors.find((x) => x.id === itsExtractor.id); e.active = true; e.startedAt = Date.now(); e.endsAt = Date.now() + 3_600_000; });
    const assetsBefore = c.corp().finances.assets;

    const r = c.remove(middle.id);
    expect(r).toMatchObject({ outcome: "ok", name: "Basic Extractor Yard", extractor: itsExtractor.id, stoppedCycle: true, assetValue: 36_000 });
    expect(r.costBasis).toBe(middle.paid); // recorded at construction since AB#2569
    const corp = c.corp();
    expect(corp.buildings.filter((b) => b.name === "Basic Extractor Yard")).toHaveLength(2);
    expect(corp.mining.silicateExtractors).toHaveLength(2); // not padded back by ensureCorpMiningModel
    expect(corp.mining.silicateExtractors.map((e) => e.id)).not.toContain(itsExtractor.id);
    for (const e of corp.mining.silicateExtractors) expect(corp.buildings.some((b) => b.id === e.buildingId)).toBe(true);
    const lease = corp.miningLeases.find((l) => l.id === "lease-earth");
    expect(lease.extractorIds.sort()).toEqual(corp.mining.silicateExtractors.map((e) => e.id).sort());
    expect(leaseSlotsUsed(lease)).toBe(2);
    expect(corp.finances.assets).toBe(assetsBefore - 36_000);

    expect(() => miningTick()).not.toThrow();
    await c.build("basic-extractor-yard", "lease-earth");
    const ids = c.corp().mining.silicateExtractors.map((e) => e.id);
    expect(new Set(ids).size).toBe(3); // positional ids would have given ext-basic-3 twice
    expect(c.corp().mining.silicateExtractors.every((e) => c.corp().buildings.some((b) => b.id === e.buildingId))).toBe(true);
  });
});

describe("removing a refinery (AB#2569)", () => {
  it("delivers a finished run, returns a running run's inputs, and leaves the other refinery paired with its building", async () => {
    const c = await corporation();
    await c.build("refinery");
    await c.build("refinery");
    const [first, second] = c.corp().refineries;
    const station = () => c.corp().inventory["earth-station-prime"] || {};
    const input = CHAIN.inputs[0];
    const before = station()[input.item] || 0;
    const started = await c.post("start-refinery", { refineryId: second.id, chainId: CHAIN.id, inputQuantity: input.quantityPerCycle });
    expect(started.status, JSON.stringify(started.body.error)).toBe(200);
    expect(station()[input.item]).toBe(before - input.quantityPerCycle);

    const secondBuilding = c.corp().buildings.filter((b) => b.name === "Refinery")[1];
    const r = c.remove(secondBuilding.id);
    expect(r).toMatchObject({ outcome: "ok", refinery: second.id, abandonedRun: true });
    expect(r.returned).toEqual([{ item: input.item, quantity: input.quantityPerCycle, stationId: "earth-station-prime" }]);
    expect(station()[input.item]).toBe(before); // the inputs are back
    expect(c.corp().refineries.map((x) => x.id)).toEqual([first.id]);
    expect(() => refineryTick()).not.toThrow();

    // a run that has already finished is delivered before its refinery goes
    const started2 = await c.post("start-refinery", { refineryId: first.id, chainId: CHAIN.id, inputQuantity: input.quantityPerCycle });
    expect(started2.status).toBe(200);
    mutateAccountState(c.id, (s) => { s.corp.refineries[0].endsAt = Date.now() - 1; });
    const out = CHAIN.outputs[0].item;
    const outBefore = station()[out] || 0;
    const firstBuilding = c.corp().buildings.find((b) => b.name === "Refinery");
    expect(c.remove(firstBuilding.id)).toMatchObject({ outcome: "ok", abandonedRun: false, returned: [] });
    expect(station()[out]).toBeGreaterThan(outBefore);
    expect(c.corp().refineries).toEqual([]);
    await c.build("refinery");
    expect(c.corp().refineries).toHaveLength(1);
  });

  it("counts a Refinery Complex upgrade in the assets it drops and in what was paid", async () => {
    const c = await corporation();
    await c.build("refinery");
    await c.build("refinery-complex");
    const refinery = c.corp().buildings.find((b) => b.name === "Refinery");
    expect(refinery.tier).toBe(2);
    expect(buildingAssetValue(refinery)).toBe(55_000 + 70_000);
    expect(refinery.paid).toBe(75_000 + 100_000);
    const assets = c.corp().finances.assets;
    expect(c.remove(refinery.id)).toMatchObject({ outcome: "ok", costBasis: 175_000, assetValue: 125_000 });
    expect(c.corp().finances.assets).toBe(assets - 125_000);
  });
});

describe("removing a lease facility and a standalone building (AB#2569)", () => {
  it("frees a Cryo-vapor Extractor Array's lease slot", async () => {
    const c = await corporation();
    await c.build("cryo-vapor-extractor-array", "lease-luna");
    const array = c.corp().buildings.find((b) => b.name === "Cryo-vapor Extractor Array");
    expect(array.leaseId).toBe("lease-luna");
    const luna = () => c.corp().miningLeases.find((l) => l.id === "lease-luna");
    expect(luna().facilities).toEqual(["Cryo-vapor Extractor Array"]);
    expect(c.remove(array.id)).toMatchObject({ outcome: "ok", lease: "lease-luna" });
    expect(luna().facilities).toEqual([]);
    expect(leaseHasRoom(luna())).toBe(true);
  });

  it("removes an Assembly Facility and lets its paid fabrication queue finish", async () => {
    const c = await corporation();
    await c.build("assembly-facility");
    mutateAccountState(c.id, (s) => {
      if (!s.corp.asteroidMining) s.corp.asteroidMining = {};
      s.corp.asteroidMining.fabricationQueue = [{ id: "fab-test", startedAt: Date.now() - 10, completesAt: Date.now() - 1 }];
    });
    const facility = c.corp().buildings.find((b) => b.name === "Assembly Facility");
    expect(c.remove(facility.id)).toMatchObject({ outcome: "ok", name: "Assembly Facility" });
    expect(c.corp().asteroidMining.fabricationQueue).toHaveLength(1); // untouched by the removal
    expect(() => fabricationTick()).not.toThrow();
  });
});

describe("what removal never touches, and what it refuses (AB#2569)", () => {
  it("leaves the office, research and level as they were", async () => {
    const c = await corporation();
    mutateAccountState(c.id, (s) => { s.corp.offices = [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 7 * 86_400_000 }]; });
    await c.build("refinery");
    await c.build("basic-extractor-yard", "lease-earth");
    const keep = () => JSON.stringify({ offices: c.corp().offices, tech: c.corp().unlockedTech, level: c.corp().level, milestones: c.corp().milestonesCompleted });
    const before = keep();
    const hq = c.corp().buildings.find((b) => b.name === "Headquarters");
    expect(c.remove(hq.id)).toMatchObject({ outcome: "not-removable", name: "Headquarters" });
    for (const b of c.corp().buildings.filter((x) => x.name !== "Headquarters")) expect(c.remove(b.id).outcome).toBe("ok");
    expect(c.corp().buildings.map((b) => b.name)).toEqual(["Headquarters"]);
    expect(keep()).toBe(before);
  });

  it("refuses an unknown building or type and changes nothing", async () => {
    const c = await corporation();
    await c.build("refinery");
    const before = JSON.stringify(c.corp());
    expect(c.remove("bld-not-there").outcome).toBe("unknown-building");
    mutateAccountState(c.id, (s) => { s.corp.buildings.push({ id: "bld-odd", name: "Mystery Hall", tier: 1 }); });
    expect(c.remove("bld-odd").outcome).toBe("unknown-type");
    expect(c.corp().buildings.some((b) => b.id === "bld-odd")).toBe(true);
    mutateAccountState(c.id, (s) => { s.corp.buildings = s.corp.buildings.filter((b) => b.id !== "bld-odd"); });
    expect(JSON.stringify(c.corp())).toBe(before);
  });

  it("uses the catalogue price for a building built before paid was recorded", () => {
    expect(buildingCostBasis({ name: "Refinery", tier: 1 })).toBe(75_000);
    expect(buildingCostBasis({ name: "Refinery", tier: 3 })).toBe(75_000 + 100_000 + 150_000);
    expect(buildingCostBasis({ name: "Basic Extractor Yard", tier: 1 })).toBe(50_000);
    expect(buildingCostBasis({ name: "Refinery", tier: 1, paid: 80_000 })).toBe(80_000);
  });

  it("is reachable from no route: only default recovery will call it", () => {
    const dir = path.resolve("server/routes");
    for (const f of [...fs.readdirSync(dir).map((n) => path.join(dir, n)), path.resolve("server/index.js")]) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/buildingRemoval/);
    }
  });
});
