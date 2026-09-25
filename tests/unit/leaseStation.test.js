import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { leaseStationFor, leaseFilingRefusal } from "../../public/scripts/navigation.js";
import { requirementLink } from "../../public/scripts/levelLinks.js";

// AB#1061: the Level 2 milestone "Purchase a Mining Lease on Mars" sent the player to Earth Station Prime, whose
// claims office offers Earth only, while the server filed a Mars lease from anywhere in Sol. The design
// (NEW_PLAYER_EXPERIENCE.md) is that a station offers leases only on the body it orbits: Mars is filed from Mars
// Orbital Dock. One function says which station files which body; the server's refusal and the milestone card
// both read it.
const STATIONS = JSON.parse(readFileSync(new URL("../../data/stations.json", import.meta.url), "utf8")).stations;
const MILESTONES = JSON.parse(readFileSync(new URL("../../data/milestones.json", import.meta.url), "utf8"));

describe("leaseStationFor (AB#1061)", () => {
  it("names the station that orbits each leasable body in Sol", () => {
    expect(leaseStationFor(STATIONS, "Earth")?.id).toBe("earth-station-prime");
    expect(leaseStationFor(STATIONS, "Mars")?.id).toBe("mars-orbital-dock");
    expect(leaseStationFor(STATIONS, "Luna")?.id).toBe("luna-gateway");
  });

  it("takes the registry as an array or as the server's id-keyed object", () => {
    const byId = Object.fromEntries(STATIONS.map((s) => [s.id, s]));
    expect(leaseStationFor(byId, "Mars")?.id).toBe("mars-orbital-dock");
  });

  it("is null for a body no station orbits", () => {
    expect(leaseStationFor(STATIONS, "Venus")).toBeNull();
  });

  it("every body a milestone asks the player to lease has a station to file it from", () => {
    // "any" (Bug #1753) is a sentinel for "a lease on any body", not a real body name — it deliberately has no
    // station, and requirementLink (below) falls back to a generic destination for it.
    const bodies = MILESTONES.levels.flatMap((l) => l.requirements).map((r) => r.metric).filter((m) => /^miningLease:/.test(m)).map((m) => m.split(":")[1]).filter((b) => b !== "any");
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(leaseStationFor(STATIONS, body), body).not.toBeNull();
  });
});

describe("leaseFilingRefusal (AB#1061)", () => {
  it("allows a lease on the body the docked station orbits", () => {
    expect(leaseFilingRefusal(STATIONS, "earth-station-prime", "Earth")).toBeNull();
    expect(leaseFilingRefusal(STATIONS, "mars-orbital-dock", "Mars")).toBeNull();
  });

  it("refuses Mars from Earth Station Prime and says where Mars is filed", () => {
    const why = leaseFilingRefusal(STATIONS, "earth-station-prime", "Mars");
    expect(why).toMatch(/Mars Orbital Dock/);
    expect(why).toMatch(/Earth Station Prime/);
    expect(why).toMatch(/Starmap/);
  });

  it("refuses a lease filed in transit", () => {
    expect(leaseFilingRefusal(STATIONS, null, "Earth")).toMatch(/in transit/i);
  });
});

describe("requirementLink: where a milestone card sends the player (AB#1061)", () => {
  const mars = { id: "marsLease", metric: "miningLease:Mars", complete: false };

  it("from Earth Station Prime, the Mars lease card leads to the Starmap and says where to travel", () => {
    const link = requirementLink(mars, "earth-station-prime", STATIONS);
    expect(link.tab).toBe("starmap");
    expect(link.label).toBe("Travel to Mars Orbital Dock →");
    expect(link.hint).toMatch(/Mars Orbital Dock/);
  });

  it("docked at Mars Orbital Dock, the same card leads to the Station, where the claims office offers Mars", () => {
    const link = requirementLink(mars, "mars-orbital-dock", STATIONS);
    expect(link.tab).toBe("station");
    expect(link.label).toBe("Go to Station →");
  });

  it("the Luna claim card works the same way", () => {
    expect(requirementLink({ id: "lunaLease", metric: "miningLease:Luna" }, "earth-station-prime", STATIONS).label).toBe("Travel to Luna Gateway →");
  });

  it("leaves every other requirement to its tab", () => {
    expect(requirementLink({ id: "hire5", metric: "stat:employeeCount" }, "earth-station-prime", STATIONS, "station")).toEqual({ tab: "station", label: "Go to Station →" });
    expect(requirementLink({ id: "x", metric: "stat:y" }, "earth-station-prime", STATIONS, undefined)).toBeNull();
  });
});
