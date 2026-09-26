import { describe, it, expect } from "vitest";
import { constructionPanelHtml, constructionRow, buildingCost, slotCounterText } from "../../public/scripts/constructionPanel.js";
import { PLAYER_BUILDING_CATALOGUE } from "../../server/playerBuildings.js";
import { ECONOMY } from "../../server/economy.js";
import { CONSTRUCTIONS } from "../../server/construction.js";
import { RESEARCH_LIBRARY } from "../../server/game/catalog.js";
import { escapeHtml } from "../../public/scripts/html.js";

// ISP-95 (AB#785): the construction panel. One row per catalogue entry, generated from the catalogue; a row either
// offers Build or names the first thing in the way, in the order the server checks (server/construction.js).

const researchName = (id) => RESEARCH_LIBRARY[id]?.name || id;
const economy = { buildings: ECONOMY.buildings };
const ALL_GATES = [...new Set(PLAYER_BUILDING_CATALOGUE.flatMap((b) => b.researchGates))];
const lease = (used = 0, slots = 2, body = "Earth") => ({ id: `lease-${body.toLowerCase()}`, body, buildingSlots: slots, extractorIds: Array.from({ length: used }, (_, i) => `ext-${i}`) });
const corp = (over = {}) => ({ unlockedTech: [], buildings: [], buildingSlots: 4, finances: { credits: 1_000_000 }, miningLeases: [], ...over });
const ctx = { researchName, economy };
const byId = (id) => PLAYER_BUILDING_CATALOGUE.find((b) => b.id === id);

describe("the construction panel (ISP-95)", () => {
  it("draws one row per catalogue entry, a new entry included, with its name, what it does, its cost and its slot use", () => {
    const fake = { id: "ferric-mining-complex", name: "Ferric Mining Complex", effect: "Presses ferric ore into plate.", slot: "corporation", researchGates: [], cap: {}, cost: 120_000, assetValue: 90_000 };
    const html = constructionPanelHtml([...PLAYER_BUILDING_CATALOGUE, fake], corp(), ctx);
    for (const b of [...PLAYER_BUILDING_CATALOGUE, fake]) {
      expect(html).toContain(`data-building-row="${b.id}"`);
      expect(html).toContain(escapeHtml(b.name));
      expect(html).toContain(escapeHtml(b.effect)); // drawn escaped: the yard's says "station's"
    }
    expect(html).toContain("¤120,000");
    expect(html).toMatch(/Uses 1 corporation slot and 1 slot on a mining lease/);
    expect(html.match(/data-building-row=/g)).toHaveLength(PLAYER_BUILDING_CATALOGUE.length + 1);
  });

  it("a fresh corporation sees each gated building locked by the first research it lacks, named", () => {
    expect(constructionRow(byId("refinery"), corp(), ctx).reason).toBe("Requires Material Compression I research.");
    expect(constructionRow(byId("refinery"), corp({ unlockedTech: ["tt-material-compression"] }), ctx).reason).toBe("Requires Nano-Lattice Weaving research.");
    expect(constructionRow(byId("assembly-facility"), corp(), ctx).reason).toBe("Requires Assembly & Fabrication Systems research.");
  });

  it("then the cap, the lease, a corporation slot and the price, each in words", () => {
    const researched = { unlockedTech: [...ALL_GATES] };
    expect(constructionRow(byId("assembly-facility"), corp({ ...researched, buildings: [{ name: "Assembly Facility" }] }), ctx).reason).toBe("Built: your corporation operates the most it may, 1.");
    expect(constructionRow(byId("basic-extractor-yard"), corp(researched), ctx).reason).toBe("Needs a mining lease: file one at the ISA Claims & Leases Division.");
    expect(constructionRow(byId("basic-extractor-yard"), corp({ ...researched, miningLeases: [lease(2, 2)] }), ctx).reason).toBe("Every mining lease's building slots are in use.");
    const full = corp({ ...researched, buildingSlots: 5, buildings: Array.from({ length: 5 }, () => ({ name: "Basic Extractor Yard" })) });
    expect(constructionRow(byId("refinery"), full, ctx).reason).toBe("No free building slot: 5 of 5 in use.");
    const poor = corp({ ...researched, finances: { credits: 10.7 } });
    expect(constructionRow(byId("refinery"), poor, ctx).reason).toBe(`Needs ¤${byId("refinery").cost.toLocaleString("en-US")}; you have ¤10.`);
  });

  it("a buildable row has a Build button naming the price, and a building on a lease offers the leases with room", () => {
    const c = corp({ unlockedTech: [...ALL_GATES], miningLeases: [lease(0, 2, "Earth"), lease(2, 2, "Mars"), lease(1, 2, "Luna")] });
    const row = constructionRow(byId("basic-extractor-yard"), c, ctx);
    expect(row.reason).toBe("");
    expect(row.leases.map((l) => l.id)).toEqual(["lease-earth", "lease-luna"]);
    const html = constructionPanelHtml([byId("basic-extractor-yard")], c, ctx);
    expect(html).toContain('data-build-id="basic-extractor-yard"');
    expect(html).toContain('<option value="lease-earth">');
    expect(html).not.toContain('value="lease-mars"');
    expect(html).toMatch(/Build \(¤[\d,]+\)/);
  });

  it("quotes the price the server charges, the Supply Forecast discount on a yard included", () => {
    for (const unlockedTech of [[], ["tt-supply-forecast"]]) {
      const c = corp({ unlockedTech });
      for (const b of PLAYER_BUILDING_CATALOGUE) {
        const server = CONSTRUCTIONS[b.id].cost ? CONSTRUCTIONS[b.id].cost(b, c) : b.cost;
        expect(buildingCost(b, c, economy), `${b.id} ${unlockedTech}`).toBe(server);
      }
    }
    expect(Number.isNaN(buildingCost(byId("basic-extractor-yard"), corp({ unlockedTech: ["tt-supply-forecast"] }), {}))).toBe(true);
  });

  it("an upgrade takes no slot, needs the building it upgrades, and locks once every one carries it (ISP-97)", () => {
    const ctxWithCatalogue = { ...ctx, catalogue: PLAYER_BUILDING_CATALOGUE };
    const complex = byId("refinery-complex");
    const researched = { unlockedTech: [...ALL_GATES] };
    expect(constructionRow(complex, corp(researched), ctxWithCatalogue).reason).toBe("Needs a Refinery to upgrade: build one first.");
    const full = corp({ ...researched, buildingSlots: 2, buildings: [{ name: "Headquarters" }, { name: "Refinery" }] });
    expect(constructionRow(complex, full, ctxWithCatalogue).reason).toBe(""); // every slot in use, and still buildable
    const upgraded = corp({ ...researched, buildings: [{ name: "Refinery", upgrades: ["Refinery Complex"] }] });
    expect(constructionRow(complex, upgraded, ctxWithCatalogue).reason).toBe("Every Refinery you have is already a Refinery Complex.");
    expect(constructionPanelHtml([byId("refinery"), complex], full, ctx)).toContain("Uses no slot: upgrades a Refinery in place.");
  });

  it("fails closed without a price: the row is locked, never built at a guessed price", () => {
    const row = constructionRow({ ...byId("refinery"), cost: undefined }, corp({ unlockedTech: [...ALL_GATES] }), ctx);
    expect(row.reason).toBe("The price has not loaded; reload the page.");
  });

  it("escapes what it draws", () => {
    const hostile = { id: "x", name: '<img src=x onerror="alert(1)">', effect: "<script>alert(1)</script>", slot: "corporation", researchGates: [], cap: {}, cost: 1, assetValue: 1 };
    const html = constructionPanelHtml([hostile], corp(), ctx);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });

  it("the slot counter says how many corporation building slots are in use", () => {
    expect(slotCounterText(corp({ buildingSlots: 5, buildings: [{}, {}] }))).toBe("Building slots: 2 of 5 in use.");
    expect(slotCounterText({})).toBe("Building slots: 0 of 2 in use.");
  });
});
