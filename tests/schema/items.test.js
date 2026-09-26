import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState } from "../../server/gameState.js";
import { ITEMS, ITEM_NAMES, dataItemSources, itemSchemaProblems, unknownItemReferences } from "../../server/game/items.js";
import { PRICE_HISTORY_ITEMS } from "../../server/priceHistory.js";

// ISP-130 (AB#824): data/items.json is every item the game names, and every data file names only those (T-019).
const DESIGN = fs.readFileSync(new URL("../../docs/design/tier3-resources.md", import.meta.url), "utf8");

describe("data/items.json (AB#824)", () => {
  it("each item has a kebab-case id, a name, a tier of 1 to 3 and a category, with tier 3 the refined", () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(28);
    expect(itemSchemaProblems(ITEMS)).toEqual([]);
    for (const item of ITEMS) expect(Object.keys(item).sort().filter((k) => k !== "note"), item.id).toEqual(["category", "id", "name", "tier"]);
  });

  it("a bad entry is caught, naming what is wrong", () => {
    const problems = itemSchemaProblems([
      { id: "Helium 3", name: "Helium-3", tier: 1, category: "raw" },
      { id: "aerogel", name: "Aerogel", tier: 2, category: "refined" },
      { id: "aerogel", name: "Aerogel", tier: 3, category: "refined" },
      { id: "x", name: "", tier: 4, category: "gas" }
    ]);
    expect(problems.join("\n")).toMatch(/Helium 3.*kebab-case/);
    expect(problems.join("\n")).toMatch(/aerogel.*tier 3 is refined/);
    expect(problems.join("\n")).toMatch(/id repeats/);
    expect(problems.join("\n")).toMatch(/name repeats/);
    expect(problems.join("\n")).toMatch(/x.*no name/);
    expect(problems.join("\n")).toMatch(/x.*tier must be/);
    expect(problems.join("\n")).toMatch(/x.*category must be/);
  });

  it("holds the design's items at the design's tiers: AB#822's new raws and every item already in the build", () => {
    const tierOf = Object.fromEntries(ITEMS.map((i) => [i.name, i.tier]));
    for (const [name, tier] of [["Deuterium", 1], ["Iron Ore", 1], ["Bauxite", 1], ["Helium-3", 1], ["Titanium", 2], ["Exotic Matter", 2]]) {
      expect(tierOf[name], name).toBe(tier);
    }
    // Section 6's table of items already in the build: every row, at its tier.
    const section = DESIGN.split("## 6. Items already in the build")[1].split("\n## ")[0];
    const rows = [...section.matchAll(/^\| ([A-Z][^|]+?) \| ([123]) \|/gm)].map((m) => [m[1].trim(), Number(m[2])]);
    expect(rows.length).toBe(16); // thirteen, Deuterium (AB#830), Bauxite (AB#833) and Iron Ore (AB#831)
    for (const [name, tier] of rows) expect(tierOf[name], name).toBe(tier);
  });
});

describe("every item named anywhere is in the catalog (AB#824)", () => {
  it("the refinery chains, belts, NPC orders, NPC corporations, contracts and milestones all resolve", () => {
    expect(unknownItemReferences(dataItemSources(), ITEMS)).toEqual([]);
  });

  it("a misspelt item in any of them is caught, by source", () => {
    const sources = dataItemSources();
    const fixture = {
      ...sources,
      refineryChains: { ...sources.refineryChains, chains: [{ id: "typo-chain", inputs: [{ item: "Silicate", quantityPerCycle: 100 }], outputs: [{ item: "Aerogels" }] }] },
      systems: [{ id: "fixture", bodies: [{ id: "belt", composition: { "Helium 3": 50, Nickel: 50 } }] }],
      economy: { ...sources.economy, npcBuyers: [{ item: "Titanum" }], npcAsks: { dailyQty: [{ item: "Rare Earth" }] } },
      npcCorporations: { corporations: [{ id: "fixture-corp", trades: ["Carbon Fibre"] }] },
      missions: { templates: [{ id: "ms-fixture", resource: "Water-Ice" }] },
      milestones: { levels: [{ level: 99, requirements: [{ id: "mineSilicon", metric: "totalMined:silicon" }, { id: "mineOk", metric: "totalMined:silicate" }] }] }
    };
    expect(unknownItemReferences(fixture, ITEMS)).toEqual([
      'refinery-chains.json typo-chain input: "Silicate"',
      'refinery-chains.json typo-chain output: "Aerogels"',
      'systems.json fixture:belt: "Helium 3"',
      'economy.json npcBuyers: "Titanum"',
      'economy.json npcAsks: "Rare Earth"',
      'npc-corporations.json fixture-corp: "Carbon Fibre"',
      'missions.json ms-fixture: "Water-Ice"',
      'milestones.json level 99 mineSilicon: "silicon"'
    ]);
  });

  it("what the exchange lists, buys and charts is only ever catalog items", () => {
    for (const item of PRICE_HISTORY_ITEMS) expect(ITEM_NAMES.has(item), item).toBe(true);
  });
});

describe("the exchange refuses an item not in the catalog (AB#824)", () => {
  for (const type of ["sell", "buy"]) {
    it(`a ${type} order for "Helium 3" is a 400 and changes nothing`, async () => {
      const { app } = await getApp();
      const { account, accessToken } = await registerAccount(app);
      mutateAccountState(account.id, (s) => { s.corp.inventory = { "earth-station-prime": { "Helium-3": 500 } }; s.corp.finances.credits = 100_000; });
      const before = JSON.stringify({ corp: getAccountById(account.id).state.corp.inventory, credits: getAccountById(account.id).state.corp.finances.credits, market: (getState().market?.orderBook || []).length, buys: (getState().market?.buyOrders || []).length });
      const res = await authed(app, accessToken).post("/api/market/orders").send({ type, item: "Helium 3", quantity: 10, unitPrice: 90 });
      expect(res.status).toBe(400);
      const after = JSON.stringify({ corp: getAccountById(account.id).state.corp.inventory, credits: getAccountById(account.id).state.corp.finances.credits, market: (getState().market?.orderBook || []).length, buys: (getState().market?.buyOrders || []).length });
      expect(after).toBe(before);
    });
  }
});
