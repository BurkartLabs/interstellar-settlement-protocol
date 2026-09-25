import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { expeditionPlaces, expeditionNotificationBody } from "../../server/expeditionText.js";

// AB#1295: the Expedition Complete notification said "returned from belt" and "deposited at earth-station-prime":
// the belt key's suffix and the station's id. The inbox report beside it title-cased ids ("Ac Belt", "Barnards Star").
const systems = JSON.parse(readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8"));
const list = Array.isArray(systems) ? systems : systems.systems || Object.values(systems);
const belts = list.flatMap((s) => (s.bodies || []).filter((b) => b.type === "Field").map((b) => ({ system: s, belt: b })));

describe("an expedition's return names places, not ids (AB#1295)", () => {
  it("the catalog has belts to check", () => {
    expect(belts.length).toBeGreaterThan(3);
  });

  it.each(belts.map(({ system, belt }) => [`${system.id}:${belt.id}`, system, belt]))(
    "%s is named from the catalog, with its system",
    (beltKey, system, belt) => {
      const places = expeditionPlaces({ beltKey, systemId: system.id, depositStationId: "earth-station-prime" });
      expect(places).toEqual({ belt: belt.name, system: system.name, station: "Earth Station Prime" });
      const body = expeditionNotificationBody({ beltKey, systemId: system.id, depositStationId: "earth-station-prime", yields: { Silicates: 31 } });
      expect(body).toBe(`Mining probe has returned from the ${belt.name} (${system.name}). Yields: 31 Silicates. Resources deposited at Earth Station Prime.`);
      expect(body).not.toContain(belt.id);
      expect(body).not.toContain("earth-station-prime");
    }
  );

  it("an expedition from before systemId was stored takes the system from its belt key", () => {
    expect(expeditionPlaces({ beltKey: "alpha-centauri:ac-belt" }).system).toBe("Alpha Centauri");
  });

  it("an unknown belt or station reads as a plain description, never an id", () => {
    const body = expeditionNotificationBody({ beltKey: "nowhere:x-9", depositStationId: "gone-station", yields: {} });
    expect(body).toBe("Mining probe has returned from an asteroid belt. Yields: no resources. Resources deposited at your nearest station.");
  });
});
