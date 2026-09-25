import { describe, it, expect } from "vitest";
import fs from "node:fs";

// AB#1269: the Orbital Executive Suites stand at all eight stations, and their flavour line told a player docked at Mars
// about "an Earth Station Prime office". A building's text may name a station only if that is the one station it is at.
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const { stations } = read("stations.json");
const { buildings } = read("buildings.json");

const strings = (value) =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

describe("building copy names only its own station (AB#1269)", () => {
  it("reads buildings that stand at several stations", () => {
    const suitesAt = stations.filter((s) => s.buildingIds.includes("orbital-executive-suites"));
    expect(suitesAt.length).toBeGreaterThan(1);
  });

  it("no building's text names a station it is not confined to", () => {
    const offenders = [];
    for (const building of buildings) {
      const at = stations.filter((s) => s.buildingIds.includes(building.id)).map((s) => s.id);
      for (const text of strings(building)) {
        for (const station of stations) {
          if (text.includes(station.name) && !(at.length === 1 && at[0] === station.id)) {
            offenders.push(`${building.id} names ${station.name} but stands at ${at.join(", ") || "no station"}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
