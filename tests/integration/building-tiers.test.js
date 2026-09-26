import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, REFINERY_CHAINS, PROBE_FABRICATION_MS } from "../../server/gameState.js";
import { resolveMetric } from "../../server/game/progression.js";
import { refineryTick } from "../../server/ticks.js";
import { ECONOMY } from "../../server/economy.js";

// ISP-102 (AB#794): the Assembly Facility's and the Refinery's tiers, through the real routes (docs/design/upgrades.md).
// Each upgrade goes through POST /gameplay/buildings/:buildingId/upgrade, AB#793's route, unchanged; the effect is read
// where the game reads it: the fabrication queue for the facility, the server's refinery tick for the Refinery.
const CHAIN = Object.values(REFINERY_CHAINS).find((ch) => !(ch.requiresTechIds || []).length) || Object.values(REFINERY_CHAINS)[0];

async function corporation({ level = 8 } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.level = level;
    corp.finances.credits = 2_000_000;
    corp.buildingSlots = 6;
    corp.currentStationId = "earth-station-prime";
    corp.unlockedTech = [...new Set(["tt-material-compression", "tt-nano-lattice", "tt-assembly-fabrication", "tt-asteroid-prospecting", ...(CHAIN.requiresTechIds || [])])];
    corp.inventory = { "earth-station-prime": { [CHAIN.input]: CHAIN.inputQuantityPerCycle * 10 } };
  });
  const api = authed(app, accessToken);
  const post = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
  const corp = () => getAccountById(account.id).state.corp;
  const idOf = (name) => corp().buildings.find((b) => b.name === name).id;
  const upgrade = (name) => post(`buildings/${idOf(name)}/upgrade`);
  const online = () => mutateAccountState(account.id, (s) => {
    s.corp.refineries.forEach((r) => { r.upgradingUntil = null; });
    s.corp.buildings.forEach((b) => { b.upgradingUntil = null; });
  });
  /** One run of the chain on the first refinery, finished by the server's tick; what it delivered of each output. */
  const run = async () => {
    const before = { ...corp().inventory["earth-station-prime"] };
    const started = await post("start-refinery", { refineryId: corp().refineries[0].id, chainId: CHAIN.id, inputQuantity: CHAIN.inputQuantityPerCycle });
    expect(started.status, JSON.stringify(started.body.error)).toBe(200);
    mutateAccountState(account.id, (s) => { s.corp.refineries[0].endsAt = Date.now() - 1; });
    refineryTick();
    const after = corp().inventory["earth-station-prime"];
    return Object.fromEntries(CHAIN.outputs.map((o) => [o.item, (after[o.item] || 0) - (before[o.item] || 0)]));
  };
  return { id: account.id, post, corp, upgrade, online, run };
}

describe("the Assembly Facility's tier (AB#794)", () => {
  it("tier 2 halves a probe's fabrication time, at the table's price, and the facility is offline 2 hours first", async () => {
    const c = await corporation();
    expect((await c.post("build", { buildingId: "assembly-facility" })).status).toBe(200);
    const credits = c.corp().finances.credits;
    const res = await c.upgrade("Assembly Facility");
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    const row = ECONOMY.buildings.assemblyFacilityUpgrades[0];
    expect(credits - c.corp().finances.credits).toBe(row.upgradeCost);
    expect(c.corp().buildings.find((b) => b.name === "Assembly Facility").tier).toBe(2);

    const offline = await c.post("build-mining-probe");
    expect(offline.status).toBe(400);
    expect(offline.body.error).toMatch(/being upgraded/);
    c.online();
    expect((await c.post("build-mining-probe")).status).toBe(200);
    const [job] = c.corp().asteroidMining.fabricationQueue;
    expect(job.completesAt - job.startedAt).toBe(Math.round((PROBE_FABRICATION_MS * row.fabricationTimePct) / 100));
    expect(row.fabricationTimePct).toBe(50);
  });
});

describe("the Refinery's tiers (AB#794), reconciled with the Refinery Complex (AB#787)", () => {
  it("tier 2 through the upgrade route is the Refinery Complex: its price, x1.5 output, and the ladder counts it", async () => {
    const c = await corporation();
    expect((await c.post("build", { buildingId: "refinery" })).status).toBe(200);
    const base = await c.run();
    const credits = c.corp().finances.credits;
    const res = await c.upgrade("Refinery");
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    expect(credits - c.corp().finances.credits).toBe(ECONOMY.buildings.refineryComplexCost);
    const refinery = c.corp().buildings.find((b) => b.name === "Refinery");
    expect(refinery.tier).toBe(2);
    expect(refinery.upgrades).toEqual(["Refinery Complex"]);
    expect(resolveMetric("building:Refinery Complex", c.corp())).toBe(1);
    expect(c.corp().refineries[0].upgradingUntil).toBeNull(); // no downtime, as the build route has none
    const tier2 = await c.run();
    for (const o of CHAIN.outputs) expect(tier2[o.item], o.item).toBe(Math.floor(base[o.item] * 1.5));
  });

  it("tier 3 doubles the output from the same input, at the table's price, after 8 hours offline", async () => {
    const c = await corporation();
    expect((await c.post("build", { buildingId: "refinery" })).status).toBe(200);
    // Tier 2 the other way: the Refinery Complex built through the build route. Tier 3 then follows from either.
    expect((await c.post("build", { buildingId: "refinery-complex" })).status).toBe(200);
    const credits = c.corp().finances.credits;
    const res = await c.upgrade("Refinery");
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    const row = ECONOMY.buildings.refineryUpgrades.find((u) => u.toTier === 3);
    expect(credits - c.corp().finances.credits).toBe(row.upgradeCost);
    expect(c.corp().refineries[0].tier).toBe(3);
    const offline = await c.post("start-refinery", { refineryId: c.corp().refineries[0].id, chainId: CHAIN.id, inputQuantity: CHAIN.inputQuantityPerCycle });
    expect(offline.status).toBe(400);
    expect(offline.body.error).toMatch(/being upgraded/);
    expect(c.corp().refineries[0].upgradingUntil - Date.now()).toBeGreaterThan(row.offlineHours * 3_600_000 - 60_000);
    c.online();
    const tier3 = await c.run();
    for (const o of CHAIN.outputs) expect(tier3[o.item], o.item).toBe(o.quantityPerCycle * row.outputMultiplier);
    expect(row.outputMultiplier).toBe(2);
    // The Refinery Complex is not bought a second time: the build route refuses it on an upgraded Refinery.
    expect((await c.post("build", { buildingId: "refinery-complex" })).status).toBe(400);
  });

  it("a Refinery upgraded to tier 2 through the route cannot then be sold the Refinery Complex again", async () => {
    const c = await corporation();
    expect((await c.post("build", { buildingId: "refinery" })).status).toBe(200);
    expect((await c.upgrade("Refinery")).status).toBe(200);
    const res = await c.post("build", { buildingId: "refinery-complex" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Every Refinery you have is already a Refinery Complex.");
  });

  it("the level limit applies to every type: Level 1 cannot take any building to tier 2", async () => {
    const c = await corporation({ level: 1 });
    expect((await c.post("build", { buildingId: "refinery" })).status).toBe(200);
    const res = await c.upgrade("Refinery");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allows tier 1/);
  });
});
