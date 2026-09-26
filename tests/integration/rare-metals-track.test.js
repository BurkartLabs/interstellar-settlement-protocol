import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { applyMiningOperations, applyRefineryOperations, bidQuotaFor, getAccountById, mutateAccountState } from "../../server/gameState.js";
import { REFINERY_CHAINS } from "../../server/game/catalog.js";
import { refineMinimum } from "../../public/scripts/refineQuantity.js";
import { ECONOMY, npcBidFor } from "../../server/economy.js";

// ISP-138 (AB#832): the Rare Metals track, from a lease to a sale, through the server's routes (docs/design/
// tier3-resources.md and tier3-recipes.md). BL Ceti I (a lava planet in a rare system) yields Thorium; Kestrel (a
// crater planet in an exotic one) yields Cobalt. Rare Earths comes from belts only (tier3-resources.md section 2), so it
// is stocked as an expedition delivers it; expedition yields have their own tests (expedition-yield.test.js).
// What the fixture sets is what a corporation would already have: credits, research, where it is docked, an office
// there and staff. Everything the track does is a request.
const RESEARCH = ["tt-basic-extraction", "tt-industrial-safety", "tt-energy-routing", "tt-supply-forecast", "tt-material-compression",
  "tt-nano-lattice", "tt-containment-physics", "tt-exotic-energy-routing", "tt-fleet-coordination", "tt-proxima-navigation",
  "tt-deep-star-navigation", "tt-rare-metal-separation"];
const HOUR = 3_600_000;

async function corporation({ station, system, research = RESEARCH, stock = {} }) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    const corp = s.corp;
    corp.finances.credits = 5_000_000;
    corp.unlockedTech = [...research];
    corp.currentStationId = station;
    corp.currentSystemId = system;
    corp.offices = [{ stationId: station, rentedAt: Date.now(), rentedUntil: Date.now() + 30 * 24 * HOUR, durationDays: 30 }];
    corp.employeeCount = 60;
    corp.employeeCap = 200;
    corp.buildingSlots = 20;
    corp.inventory = { [station]: { ...stock } };
  }, { sanitize: false, settleMining: false });
  const api = authed(app, accessToken);
  const play = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
  const corp = () => getAccountById(account.id).state.corp;
  const held = (item) => Number(corp().inventory?.[station]?.[item] || 0);
  const credits = () => Number(corp().finances.credits);
  const sell = (item, quantity) => api.post(`/api/market/npc-orders/npc-buy-${item.toLowerCase().replace(/\s+/g, "-")}-daily/sell`).send({ quantity });
  /** The server's own tick, `hours` on (a day unless said): whatever was started has run. */
  const aDayLater = (tick, hours = 25) => mutateAccountState(account.id, (s) => tick(s.corp, Date.now() + hours * HOUR));
  return { id: account.id, play, corp, held, credits, sell, aDayLater };
}

async function mineADay(c, body) {
  const lease = await c.play("purchase-lease", { body });
  expect(lease.status, JSON.stringify(lease.body.error)).toBe(200);
  const leaseId = c.corp().miningLeases.find((l) => l.body === body).id;
  expect((await c.play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
  const extractorId = c.corp().mining.silicateExtractors.find((e) => e.leaseId === leaseId).id;
  const start = await c.play(`lease/${leaseId}/start-mining`, { amount: 146, hours: 24, extractorId });
  expect(start.status, JSON.stringify(start.body.error)).toBe(200);
  c.aDayLater(applyMiningOperations);
}

async function refine(c, chainId, body) {
  const built = c.corp().refineries?.length ? null : await c.play("build", { buildingId: "refinery" });
  if (built) expect(built.status, JSON.stringify(built.body.error)).toBe(200);
  const res = await c.play("start-refinery", { refineryId: c.corp().refineries[0].id, chainId, ...body });
  expect(res.status, `${chainId}: ${JSON.stringify(res.body.error)}`).toBe(200);
  c.aDayLater(applyRefineryOperations, 7 * 24); // a run of several batches lasts batches x the chain's hours
}

/** Sell `quantity` of `item` to its standing bid: 200, and the balance moves by what the bid paid less the tax. */
async function sellsToItsBid(c, item, quantity) {
  const before = c.credits();
  const held = c.held(item);
  const res = await c.sell(item, quantity);
  expect(res.status, `${item}: ${JSON.stringify(res.body.error)}`).toBe(200);
  expect(c.held(item)).toBe(held - quantity);
  expect(c.credits()).toBeGreaterThan(before);
  return c.credits() - before;
}

describe("the Rare Metals track, lease to sale (AB#832)", () => {
  it("BL Ceti I: lease, a day's mining yields Thorium, Thorium Fuel Rods refined and sold to their bid", async () => {
    const c = await corporation({ station: "twin-flare-outpost", system: "luyten-726-8" });
    await mineADay(c, "BL Ceti I");
    const thorium = c.held("Thorium");
    expect(thorium, "Thorium mined").toBeGreaterThanOrEqual(refineMinimum(30));
    const qty = Math.floor(thorium / 30) * 30;
    await refine(c, "thorium-fuel-chain", { inputQuantity: qty });
    expect(c.held("Thorium Fuel Rods")).toBe((qty / 30) * 10);
    // AB#2365: the rods' bid takes a Refinery's day of them (its own quota), so a larger batch sells over days
    const paid = await sellsToItsBid(c, "Thorium Fuel Rods", Math.min(c.held("Thorium Fuel Rods"), bidQuotaFor("Thorium Fuel Rods")));
    expect(paid).toBeGreaterThan(0);
  }, 60_000);

  it("Kestrel: lease, a day's mining yields Cobalt; Rare Earths refined to Sensor Arrays and Catalyst Substrates, and with Cobalt to Rare-Earth Magnets, each sold to its bid", async () => {
    const c = await corporation({ station: "kestrel-platform", system: "epsilon-eridani", stock: { "Rare Earths": 160 } });
    await mineADay(c, "Kestrel");
    const cobalt = c.held("Cobalt");
    expect(cobalt, "Cobalt mined").toBeGreaterThanOrEqual(40);

    await refine(c, "rare-earths-chain", { inputQuantity: 120 });
    expect([c.held("Sensor Arrays"), c.held("Catalyst Substrates")]).toEqual([3 * 18, 3 * 12]);
    await sellsToItsBid(c, "Sensor Arrays", 54);
    await sellsToItsBid(c, "Catalyst Substrates", 36);

    const batches = Math.min(Math.floor(c.held("Rare Earths") / 20), Math.floor(cobalt / 40));
    expect(batches).toBeGreaterThanOrEqual(1);
    await refine(c, "magnet-chain", { batches });
    expect(c.held("Rare-Earth Magnets")).toBe(batches * 30);
    await sellsToItsBid(c, "Rare-Earth Magnets", batches * 30);
  }, 60_000);
});

describe("each new chain is gated by the research the design names (AB#832)", () => {
  const without = (...ids) => RESEARCH.filter((r) => !ids.includes(r));
  const cases = [
    ["magnet-chain", ["tt-rare-metal-separation"], { batches: 1 }],
    ["thorium-fuel-chain", ["tt-rare-metal-separation"], { inputQuantity: 120 }],
    ["thorium-fuel-chain", ["tt-containment-physics"], { inputQuantity: 120 }]
  ];
  it.each(cases)("%s without %s: 400, and nothing debited", async (chainId, missing, body) => {
    expect(REFINERY_CHAINS[chainId].requiresTechIds).toEqual(expect.arrayContaining(missing));
    const c = await corporation({ station: "earth-station-prime", system: "sol", research: without(...missing), stock: { "Rare Earths": 200, Cobalt: 200, Thorium: 200 } });
    const built = await c.play("build", { buildingId: "refinery" });
    expect(built.status, JSON.stringify(built.body.error)).toBe(200);
    const before = JSON.stringify(c.corp().inventory);
    const res = await c.play("start-refinery", { refineryId: c.corp().refineries[0].id, chainId, ...body });
    expect(res.status).toBe(400);
    expect(JSON.stringify(c.corp().inventory)).toBe(before);
  });
});

describe("the track's bids are the design's, with floors from npcBidFor (AB#832)", () => {
  it("prices Thorium, Cobalt and the four products at section 4's base and floor", async () => {
    const table = { Thorium: [160, 88], Cobalt: [110, 61], "Sensor Arrays": [215, 118], "Catalyst Substrates": [215, 118], "Rare-Earth Magnets": [276, 152], "Thorium Fuel Rods": [552, 304] };
    for (const [item, [base, floor]] of Object.entries(table)) {
      const bid = ECONOMY.npcBuyers.find((b) => b.item === item);
      expect(bid?.unitPrice, item).toBe(base);
      expect(npcBidFor(base, Number.MAX_SAFE_INTEGER), item).toBe(floor);
    }
  });
});
