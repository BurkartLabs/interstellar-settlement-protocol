import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { STATION_BADGE_BASELINE, badgedStationCounts, neutralStationCounts } from "../../public/scripts/stationMarkers.js";

// AB#2349 (the Director's ruling on AB#811): every system has at least one neutral station, so the cluster view badges
// only a count above that baseline of one; the legend says every system has one. The system view's markers are AB#811's.
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const STATIONS = JSON.parse(read("data/stations.json")).stations;
const SYSTEMS = JSON.parse(read("data/systems.json"));

describe("a station badge only above the baseline of one (AB#2349)", () => {
  it("every system has at least one neutral station, the baseline the legend states", () => {
    expect(STATION_BADGE_BASELINE).toBe(1);
    const counts = neutralStationCounts(STATIONS);
    for (const s of SYSTEMS) expect(counts.get(s.id), s.id).toBeGreaterThanOrEqual(STATION_BADGE_BASELINE);
  });

  it("badges today's catalog only in Sol, with its three", () => {
    expect([...badgedStationCounts(STATIONS)]).toEqual([["sol", 3]]);
  });

  it("marks whatever differs from the baseline, whatever the counts become", () => {
    const at = (systemId, n) => Array.from({ length: n }, (_, i) => ({ id: `${systemId}-${i}`, systemId, jurisdiction: "neutral" }));
    const stations = [...at("a", 1), ...at("b", 2), ...at("c", 5), { id: "owned", systemId: "a", jurisdiction: "conglomerate" }];
    expect([...badgedStationCounts(stations)]).toEqual([["b", 2], ["c", 5]]);
    expect([...badgedStationCounts(stations, 2)]).toEqual([["c", 5]]);
  });

  it("the cluster view draws its badges from the rule, and the legend says every system has one", () => {
    const starmap = read("public/scripts/starmap.js");
    expect(starmap).toMatch(/const stationCounts = badgedStationCounts\(state\.stations\);/);
    expect(starmap).not.toMatch(/neutralStationCounts\(/);
    expect(read("public/index.html")).toContain("Every system has at least one neutral station; a number beside a star marks a system with more.");
  });
});
