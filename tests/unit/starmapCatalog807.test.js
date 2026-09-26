import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";

// ISP-115 (AB#807): the second half of docs/design/starmap-20.md. tests/unit/starmapCatalog806.test.js checks every
// system in the data against the design's tables field by field (traits, gate, position, owner, bodies, belt, lanes,
// hops), so this checks that the data now holds the whole design, and what the second half adds: its two gates and a
// station in each system.
const DESIGN = fs.readFileSync(new URL("../../docs/design/starmap-20.md", import.meta.url), "utf8");
const RESEARCH = JSON.parse(fs.readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes;
const STATIONS = JSON.parse(fs.readFileSync(new URL("../../data/stations.json", import.meta.url), "utf8")).stations;
const byId = Object.fromEntries(SYSTEMS_DATA.map((s) => [s.id, s]));
const LONG_BASELINE = ["procyon", "ross-128", "61-cygni", "kapteyns-star", "epsilon-indi"];
const FRONTIER = ["kruger-60", "wolf-1061", "altair", "70-ophiuchi", "van-maanens-star"];
const designIds = [...DESIGN.split("## The systems")[1].split("\n### ")[0].matchAll(/^\| [^|]+ \| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);

describe("the catalog holds the whole 20+ system map (AB#807)", () => {
  it("at least 20 systems: every one the design names, and no other", () => {
    expect(SYSTEMS_DATA.length).toBeGreaterThanOrEqual(20);
    expect(designIds).toHaveLength(22);
    expect(SYSTEMS_DATA.map((s) => s.id).sort()).toEqual([...designIds].sort());
  });

  it("the Long-Baseline systems open with Long-Baseline Jump Plotting at Level 28, the Frontier ones with Frontier Cartography at 34", () => {
    const node = (id) => RESEARCH.find((n) => n.id === id);
    expect(node("tt-long-baseline-navigation")).toMatchObject({ requiresCorpLevel: 28, prereqs: ["tt-deep-star-navigation"] });
    expect(node("tt-frontier-cartography")).toMatchObject({ requiresCorpLevel: 34, prereqs: ["tt-long-baseline-navigation"] });
    for (const id of LONG_BASELINE) expect(byId[id].accessResearch, id).toBe("tt-long-baseline-navigation");
    for (const id of FRONTIER) expect(byId[id].accessResearch, id).toBe("tt-frontier-cartography");
    // The gates' text names what they open, now that it is charted.
    expect(node("tt-long-baseline-navigation").effect).toBe("Enables travel to Procyon, Ross 128, 61 Cygni, Kapteyn's Star and Epsilon Indi");
    expect(node("tt-frontier-cartography").effect).toBe("Enables travel to Kruger 60, Wolf 1061, Altair, 70 Ophiuchi and van Maanen's Star");
  });

  it("each new system has one neutral tier-3 station on one of its own planets or moons, with the three buildings", () => {
    for (const id of [...LONG_BASELINE, ...FRONTIER]) {
      const here = STATIONS.filter((s) => s.systemId === id);
      expect(here, id).toHaveLength(1);
      const [station] = here;
      expect(byId[id].bodies.filter((b) => b.type !== "Field").map((b) => b.name), id).toContain(station.body);
      expect(station, id).toMatchObject({ tier: 3, jurisdiction: "neutral", buildingIds: ["orbital-executive-suites", "isa-claims-leases", "galactic-exchange-hub"] });
    }
  });
});
