import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { MISSION_TEMPLATES, materializeOffer, refreshContractOfferings } from "../../server/game/corporation.js";
import { unknownItemReferences, dataItemSources, ITEMS } from "../../server/game/items.js";
import { ECONOMY } from "../../server/economy.js";

// ISP-192 (AB#886; docs/design/v0.11-tier4.md, section 6): every Tier 4 product has a use besides the NPC bid, and each
// consuming action debits it: the Refinery's tier 4 takes Superconducting Coils, the Assembly Facility's tier 3 Catalyst
// Beds, three Bureau requisitions Field Emitters, Breeder Reactor Cores and Antimatter Drives, and antimatter-drive-chain
// Antimatter. A requisition is offered only to a corporation with the research that makes its product.
const ESP = "earth-station-prime";
const TIER4_TECH = ["tt-material-compression", "tt-nano-lattice", "tt-assembly-fabrication", "tt-integrated-manufacturing", "tt-high-energy-synthesis",
  "tt-exotic-containment", "tt-antimatter-confinement", "tt-actinide-handling", "tt-deep-core-extraction", "tt-deep-atmosphere-extraction"];

async function corporation(stock = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const raw = accountsStore.accounts[account.id];
  Object.assign(raw.state.corp, { unlockedTech: [...TIER4_TECH], buildingSlots: 8, currentStationId: ESP, unlocks: { ...(raw.state.corp.unlocks || {}), maxUpgradeTier: 5 } });
  raw.state.corp.finances.credits = 5_000_000;
  raw.state.corp.inventory = { ...(raw.state.corp.inventory || {}), [ESP]: { ...stock } };
  const api = authed(app, accessToken);
  const base = `/api/accounts/${account.id}/gameplay`;
  return {
    id: account.id, raw, corp: () => raw.state.corp, stock: () => raw.state.corp.inventory[ESP] || {},
    build: (buildingId) => api.post(`${base}/build`).send({ buildingId }),
    upgrade: (buildingId) => api.post(`${base}/buildings/${encodeURIComponent(buildingId)}/upgrade`),
    accept: (missionId) => api.post(`${base}/accept-mission`).send({ missionId }),
    complete: (missionId) => api.post(`${base}/complete-mission`).send({ missionId }),
    start: (body) => api.post(`${base}/start-refinery`).send(body)
  };
}

/** A built building of `name`, raised to `tier` (its record too), as earlier upgrades would have left it. */
function atTier(c, name, tier) {
  const building = c.corp().buildings.find((b) => b.name === name);
  building.tier = tier;
  if (name === "Refinery") c.corp().refineries[0].tier = tier;
  return building;
}

describe("the upgrades that take Tier 4 goods (AB#886)", () => {
  it("Superconducting Coils: the Refinery's tier 4 takes 10 beside its credits, and refuses with nothing taken when short", async () => {
    const c = await corporation({ "Superconducting Coils": 9 });
    expect((await c.build("refinery")).status).toBe(200);
    const refinery = atTier(c, "Refinery", 3);
    const credits = c.corp().finances.credits;
    const short = await c.upgrade(refinery.id);
    expect(short.status).toBe(400);
    expect(short.body.error).toBe("The upgrade also takes 10 Superconducting Coils from your stock at this station; you hold 9 here.");
    expect(c.corp().finances.credits).toBe(credits);
    expect(c.stock()["Superconducting Coils"]).toBe(9);
    c.stock()["Superconducting Coils"] = 12;
    const ok = await c.upgrade(refinery.id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(c.stock()["Superconducting Coils"]).toBe(2);
    expect(c.corp().finances.credits).toBe(credits - 250_000);
    expect(c.corp().refineries[0].tier).toBe(4);
    expect(ok.body.receipt.grants).toEqual(expect.arrayContaining([{ label: "Goods used", value: "10 Superconducting Coils" }]));
  });

  it("Catalyst Beds: the Assembly Facility's tier 3 takes 20, and the line goes when it is used up", async () => {
    const c = await corporation({ "Catalyst Beds": 20 });
    expect((await c.build("assembly-facility")).status).toBe(200);
    const facility = atTier(c, "Assembly Facility", 2);
    const ok = await c.upgrade(facility.id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(c.stock()).not.toHaveProperty("Catalyst Beds");
    expect(c.corp().buildings.find((b) => b.id === facility.id).tier).toBe(3);
  });
});

describe("the Bureau requisitions for Tier 4 products (AB#886)", () => {
  it.each([
    ["ms-log-011", "Field Emitters"],
    ["ms-log-012", "Breeder Reactor Cores"],
    ["ms-log-013", "Antimatter Drives"]
  ])("%s: completing it takes its quota of %s", async (missionId, resource) => {
    const template = MISSION_TEMPLATES.find((t) => t.id === missionId);
    expect(template).toMatchObject({ resource, agentId: "elara-voss" });
    const c = await corporation({ [resource]: template.quotaMax + 3 });
    c.corp().contractOfferings = { missions: [materializeOffer(template)], nextRefreshAt: Date.now() + 3_600_000 };
    const accepted = await c.accept(missionId);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const quota = c.corp().activeMissions.find((m) => m.id === missionId).quota.amount;
    expect(quota).toBeGreaterThanOrEqual(template.quotaMin);
    const credits = c.corp().finances.credits;
    const done = await c.complete(missionId);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(c.stock()[resource]).toBe(template.quotaMax + 3 - quota);
    expect(c.corp().finances.credits).toBeGreaterThan(credits);
  });

  it("offers them only to a corporation with the research that makes each product", () => {
    const gated = MISSION_TEMPLATES.filter((t) => t.requiresTechIds?.length).map((t) => t.id).sort();
    expect(gated).toEqual(["ms-log-011", "ms-log-012", "ms-log-013"]);
    const without = { unlockedTech: [], completedMissions: [], activeMissions: [] };
    const seen = new Set();
    for (let i = 0; i < 60; i += 1) {
      without.contractOfferings = { missions: [], nextRefreshAt: 0 };
      for (const m of refreshContractOfferings(without).missions) seen.add(m.id);
    }
    for (const id of gated) expect(seen.has(id), id).toBe(false);
    const withTech = { unlockedTech: [...TIER4_TECH], completedMissions: [], activeMissions: [] };
    const offered = new Set();
    for (let i = 0; i < 200 && offered.size < gated.length; i += 1) {
      withTech.contractOfferings = { missions: [], nextRefreshAt: 0 };
      for (const m of refreshContractOfferings(withTech).missions) if (gated.includes(m.id)) offered.add(m.id);
    }
    expect([...offered].sort()).toEqual(gated);
  });
});

describe("Antimatter feeds the Antimatter Drives (AB#886)", () => {
  it("starting antimatter-drive-chain in the Synthesis Array takes its Antimatter", async () => {
    const c = await corporation({ "Ion Thrusters": 4, "Lightweight Spaceframes": 6, Antimatter: 3 });
    expect((await c.build("synthesis-array")).status).toBe(200);
    const res = await c.start({ chainId: "antimatter-drive-chain", batches: 1, refineryId: "syn-1" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(c.stock().Antimatter).toBe(2);
  });
});

describe("the new references resolve in the item catalogue (T-019, AB#886)", () => {
  it("names every item the upgrade goods and the requisitions name, and catches one that is not", () => {
    expect(unknownItemReferences(dataItemSources(), ITEMS)).toEqual([]);
    const broken = { ...dataItemSources(), economy: { ...ECONOMY, buildings: { ...ECONOMY.buildings, refineryUpgrades: [{ toTier: 4, goods: [{ item: "Superconducting Coil", quantity: 10 }] }] } } };
    expect(unknownItemReferences(broken, ITEMS)).toEqual(['economy.json buildings.refineryUpgrades tier 4: "Superconducting Coil"']);
    expect(ITEMS.filter((i) => i.tier === 4 && i.category === "refined").map((i) => i.name).sort())
      .toEqual(["Antimatter", "Antimatter Drives", "Breeder Reactor Cores", "Catalyst Beds", "Field Emitters", "Superconducting Coils"]);
  });
});
