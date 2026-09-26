import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { PLAYER_BUILDING_CATALOGUE, catalogueRefusal, loadPlayerBuildings, playerBuildingProblems } from "../../server/playerBuildings.js";
import { PLAYER_BUILDINGS } from "../../server/gameState.js";

// AB#783 (ISP-93): data/player-buildings.json, the shape in docs/design/buildings.md (AB#782). T-019: a catalogue
// that names something no other file has fails here, not in play, so the ladder cannot again name a building nobody
// can build (AB#424).

const root = path.resolve(import.meta.dirname, "..", "..");
const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const FILE = json("data/player-buildings.json");
const RESEARCH = json("data/research.json").nodes;
const MILESTONES = json("data/milestones.json");

/** Everything the catalogue names that the other files lack, and every building a milestone names that it lacks. */
function crossCatalogueProblems(buildings, research, milestones) {
  const researchIds = new Set(research.map((t) => t.id));
  const names = new Set(buildings.map((b) => b.name));
  const problems = [];
  for (const b of buildings) {
    for (const id of b.researchGates) if (!researchIds.has(id)) problems.push(`${b.id} needs research "${id}", which data/research.json does not have.`);
  }
  for (const level of milestones.levels) {
    for (const r of level.requirements) {
      const [kind, arg] = String(r.metric).split(/:(.*)/s);
      if ((kind === "building" || kind === "building-count") && !names.has(arg)) {
        problems.push(`level ${level.level} ${r.id} names building "${arg}", which data/player-buildings.json does not have.`);
      }
    }
  }
  return problems;
}

describe("data/player-buildings.json (AB#783)", () => {
  it("holds the four buildings the game has (ISP-96 added the Ferric Mining Complex), in the design's shape, each with its price from data/economy.json", () => {
    expect(playerBuildingProblems(FILE)).toEqual([]);
    expect(PLAYER_BUILDING_CATALOGUE.map((b) => b.id)).toEqual(["basic-extractor-yard", "assembly-facility", "refinery", "ferric-mining-complex"]);
    for (const b of PLAYER_BUILDING_CATALOGUE) {
      expect(Object.keys(b).sort(), b.id).toEqual(["assetValue", "cap", "cost", "effect", "id", "name", "price", "researchGates", "since", "slot"]);
      expect(b.cost, b.id).toBe(ECONOMY.buildings[`${b.price}Cost`]);
      expect(b.assetValue, b.id).toBe(ECONOMY.buildings[`${b.price}AssetValue`]);
    }
    expect(Object.isFrozen(PLAYER_BUILDING_CATALOGUE[0].cap)).toBe(true);
    expect([...PLAYER_BUILDINGS]).toEqual(PLAYER_BUILDING_CATALOGUE.map((b) => b.name)); // the ladder's list is the catalogue's
  });

  it("names only research that exists, and every building a milestone names is in it (T-019)", () => {
    expect(crossCatalogueProblems(PLAYER_BUILDING_CATALOGUE, RESEARCH, MILESTONES)).toEqual([]);
  });

  it("the cross-catalogue check fails on a missing research id and on a milestone naming a building the catalogue lacks", () => {
    const madeUp = [{ ...PLAYER_BUILDING_CATALOGUE[1], researchGates: ["tt-does-not-exist"] }];
    expect(crossCatalogueProblems(madeUp, RESEARCH, { levels: [] })).toEqual([`assembly-facility needs research "tt-does-not-exist", which data/research.json does not have.`]);
    const ladder = { levels: [{ level: 6, requirements: [{ id: "rc", metric: "building:Refinery Complex" }, { id: "ext", metric: "building-count:Basic Extractor Yard" }] }] };
    expect(crossCatalogueProblems(PLAYER_BUILDING_CATALOGUE, RESEARCH, ladder)).toEqual([`level 6 rc names building "Refinery Complex", which data/player-buildings.json does not have.`]);
  });

  it("a catalogue that is unusable stops the server at startup", () => {
    const good = FILE.buildings[1];
    const bad = [
      [[{ ...good, price: "shipyard" }], /price names no buildings.shipyardCost/],
      [[{ ...good, slot: "orbit" }], /slot must be one of/],
      [[good, { ...good }], /appears twice/],
      [[{ ...good, cap: { perCorporation: 0 } }], /cap must be/],
      [[{ ...good, researchGates: "tt-assembly-fabrication" }], /researchGates must be a list/],
      [[], /must list its buildings/]
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-buildings-"));
    try {
      for (const [buildings, message] of bad) {
        const file = path.join(dir, "player-buildings.json");
        fs.writeFileSync(file, JSON.stringify({ buildings }));
        expect(() => loadPlayerBuildings(file)).toThrow(message);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the build path reads the catalogue: no cost literal and no ECONOMY.buildings price in it", () => {
    // ISP-94 (AB#784): one build path for every building, server/construction.js and buildHandler in server/routes/helpers.js.
    for (const file of ["server/construction.js", "server/routes/helpers.js"]) {
      const code = fs.readFileSync(path.join(root, file), "utf8");
      expect(code, file).not.toMatch(/\b(50|60|75)_?000\b/);
      expect(code, file).not.toMatch(/ECONOMY\.buildings\.\w+(Cost|AssetValue)/);
    }
    expect(fs.readFileSync(path.join(root, "server/routes/helpers.js"), "utf8")).toMatch(/PLAYER_BUILDING_CATALOGUE\.find\(/);
    // Each old route is that handler with its building fixed, and nothing of its own.
    const handlers = [
      ["server/routes/mining.js", "/lease/:leaseId/build-extractor", "basic-extractor-yard"],
      ["server/routes/asteroids.js", "/build-assembly-facility", "assembly-facility"],
      ["server/routes/refining.js", "/build-refinery", "refinery"]
    ];
    for (const [file, route, id] of handlers) {
      const code = fs.readFileSync(path.join(root, file), "utf8");
      const start = code.indexOf(`gameplay${route}"`);
      expect(start, `${file} registers ${route}`).toBeGreaterThan(0);
      const line = code.slice(start, code.indexOf("\n", start));
      expect(line, file).toContain("buildHandler(");
      expect(line, file).toContain(`buildingId: "${id}"`);
    }
  });
});

describe("what the catalogue refuses before slots and money (AB#783)", () => {
  const gated = { name: "Test Works", researchGates: ["tt-a", "tt-b"], cap: { perCorporation: 1 } };
  it("missing research, then the cap; nothing when both allow it", () => {
    expect(catalogueRefusal(gated, { unlockedTech: ["tt-a"], buildings: [] })).toBe("missing-research");
    expect(catalogueRefusal(gated, { unlockedTech: ["tt-a", "tt-b"], buildings: [{ name: "Test Works" }] })).toBe("at-cap");
    expect(catalogueRefusal(gated, { unlockedTech: ["tt-a", "tt-b"], buildings: [{ name: "Other" }] })).toBe(null);
    expect(catalogueRefusal({ name: "Open", researchGates: [], cap: {} }, { buildings: new Array(9).fill({ name: "Open" }) })).toBe(null);
  });
});
