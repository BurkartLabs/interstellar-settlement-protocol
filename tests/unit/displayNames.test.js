import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { beltPlace, stationName, systemName } from "../../public/scripts/displayNames.js";

// AB#1336: text a player reads was built from ids: "deployed to belt", "(Mars, SOL)", "the Barnards Star system"
// (title-casing an id loses the apostrophe). One set of lookups, shared by server and client, reads the catalogs.
const read = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const systems = read("systems.json");
const stations = read("stations.json").stations;

describe("display names come from the catalogs (AB#1336)", () => {
  it("every system is named as the catalog names it", () => {
    for (const s of systems) expect(systemName(systems, s.id)).toBe(s.name);
    expect(systemName(systems, "barnards-star")).toBe("Barnard's Star");
  });

  it("every station is named as the catalog names it, from a list or a registry", () => {
    const registry = Object.fromEntries(stations.map((s) => [s.id, s]));
    for (const s of stations) {
      expect(stationName(stations, s.id)).toBe(s.name);
      expect(stationName(registry, s.id)).toBe(s.name);
    }
  });

  it("every belt is named with its system", () => {
    for (const s of systems) {
      for (const b of (s.bodies || []).filter((x) => x.type === "Field")) {
        expect(beltPlace(systems, `${s.id}:${b.id}`)).toEqual({ belt: b.name, system: s.name });
      }
    }
  });

  it("an unknown id is null, never the id itself", () => {
    expect(systemName(systems, "nowhere")).toBeNull();
    expect(stationName(stations, "gone-station")).toBeNull();
    expect(beltPlace(systems, "sol:nope")).toEqual({ belt: null, system: "Sol" });
    expect(systemName(undefined, "sol")).toBeNull();
  });
});

// The messages the item names, as built today, for Sol and Barnard's Star. Each must carry no id.
describe("no player-facing message in the server interpolates an id or key (AB#1336)", () => {
  const files = ["server/routes/asteroids.js", "server/routes/logistics.js", "server/routes/refining.js", "server/routes/mining.js", "server/ticks.js"];
  // An interpolation that starts with an id or key (`${beltKey.split(...)}`, `${station.systemId.toUpperCase()}`), not
  // one that merely uses an id to look something else up (`${Number(inventory(corp.currentStationId)...)}`).
  const IDISH = /\$\{\s*[\w.?]*(Id|Key)\b/;
  it.each(files)("%s builds its notification bodies and errors without ${...Id} or ${...Key}", (file) => {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").split(/\r?\n/);
    const offenders = src
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /(body:|error:|[Bb]ody = `|"[a-z-]+": `)/.test(line) && IDISH.test(line))
      .map(({ n, line }) => `${file}:${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
