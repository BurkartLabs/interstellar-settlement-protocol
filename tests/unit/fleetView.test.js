import { describe, it, expect } from "vitest";
import { destinationsHtml, fleetCardHtml, fleetTotals, forcesSummaryHtml, formFleetHtml, locationText, unitsTableHtml, unitsText, FLEET_NAMES as PAGE_NAMES } from "../../public/scripts/fleetView.js";
import { UNITS, UNITS_DATA } from "../../server/game/units.js";
import { dailyUpkeep } from "../../server/upkeep.js";
import { FLEET_NAMES } from "../../server/fleets.js";

// ISP-175 (AB#869): the Fleet tab's markup. Text first: every figure the tab shows is text in a table or a sentence.
const CATALOG = UNITS_DATA.units;
const names = { "earth-station-prime": "Earth Station Prime", "mars-orbital-dock": "Mars Orbital Dock" };
const stationName = (id) => names[id];
const corp = {
  currentStationId: "earth-station-prime",
  buildings: [{ name: "Headquarters" }, { name: "Orbital Shipyard", tier: 1 }],
  fleet: { vessels: 30, cap: 152 },
  military: {
    units: { lf: 20, ds: 4, se: 0, at: 10, dt: 6 }, readiness: 85, upkeep: { short: true }, garrisons: { "earth-station-prime": 6 },
    fleets: [
      { id: "f1", name: "Aegis", units: { lf: 8, ds: 2, se: 0, at: 4 }, stationId: "earth-station-prime", transit: null },
      { id: "f2", name: "Talon", units: { lf: 6, ds: 0, se: 0, at: 0 }, stationId: null, transit: { toStationId: "mars-orbital-dock", arrivesAt: 1_000_000 + 45 * 60_000 } }
    ]
  }
};

describe("the Fleet tab (AB#869)", () => {
  it("shows the same upkeep the server charges, per type and in total", () => {
    const html = unitsTableHtml(corp, CATALOG);
    const total = Math.round(dailyUpkeep(corp)).toLocaleString("en-US");
    expect(html).toContain(`data-upkeep-total>¤${total}<`);
    for (const u of CATALOG) {
      const row = html.slice(html.indexOf(`data-unit-row="${u.id}"`)).split("</tr>")[0];
      for (const [label, stat] of [["Attack", u.attack], ["Defense", u.hp], ["Accuracy", u.accuracy], ["Evasion", u.evasion]]) expect(row, u.id).toContain(`data-label="${label}">${stat}</td>`);
    }
    expect(html).toContain("14 in fleets, 6 in reserve"); // Light Fighters: Aegis 8, Talon 6
    expect(html).toContain("2 in fleets, 2 in reserve");
    expect(html).toContain("6 in garrisons");
  });

  it("states readiness, why it is falling, the upkeep's basis and the Fleet Cap in words", () => {
    const html = forcesSummaryHtml(corp, CATALOG);
    expect(html).toContain("85%");
    expect(html).toContain("Upkeep is unpaid: readiness falls 10 points a day");
    expect(html).toMatch(/supply \d+ against a capacity of 40/);
    expect(html).toContain("30 of 152");
  });

  it("gives each fleet its units, place, arrival and readiness, and no orders while in transit", () => {
    const now = 1_000_000;
    const stationed = fleetCardHtml(corp.military.fleets[0], corp, CATALOG, { stationName, now });
    expect(stationed).toContain("8 Light Fighters, 2 Destroyers, 4 squads of Attack Troops");
    expect(stationed).toContain("Stationed at Earth Station Prime");
    expect(stationed).toContain("Readiness 85%");
    expect(stationed).toContain('data-fleet-deploy="f1"');
    expect(stationed).toContain('data-fleet-disband="f1"');
    const moving = fleetCardHtml(corp.military.fleets[1], corp, CATALOG, { stationName, now });
    expect(locationText(corp.military.fleets[1], stationName, now)).toBe("In transit to Mars Orbital Dock, arrives in 45 min (01:01 UTC)");
    expect(moving).toContain("it takes no orders until it arrives");
    expect(moving).not.toContain("data-fleet-deploy");
  });

  it("forms from the reserve only, with the server's list of names", () => {
    expect(PAGE_NAMES).toEqual([...FLEET_NAMES]);
    expect(fleetTotals(corp).reserve).toEqual({ lf: 6, ds: 2, se: 0, at: 6 });
    const html = formFleetHtml(corp, CATALOG, stationName);
    expect(html).toContain('max="6" step="1" value="0" data-form-count="lf"');
    expect(html).not.toContain("<option>Aegis</option>");
    expect(html).toContain("<option>Vanguard</option>");
    expect(formFleetHtml({ ...corp, military: { ...corp.military, units: { lf: 14, ds: 2, at: 4 } } }, CATALOG, stationName)).toContain("Nothing in reserve");
  });

  it("lists destinations with their trip lengths, the ones out of reach disabled with the reason", () => {
    const html = destinationsHtml("f1", [
      { stationId: "mars-orbital-dock", name: "Mars Orbital Dock", systemName: "Sol", travelMs: 25 * 60_000, reachable: true },
      { stationId: "centauri-prime-station", name: "Centauri Prime Station", systemName: "Alpha Centauri", travelMs: 3_600_000, reachable: false, why: "Requires Near-Star Navigation Array." }
    ]);
    expect(html).toContain("Sol · 25 min");
    expect(html).toContain("Alpha Centauri · 1 h");
    expect(html).toMatch(/data-deploy-to="centauri-prime-station"[^>]*disabled/);
    expect(html).toContain("Requires Near-Star Navigation Array.");
    expect(unitsText({ lf: 1 }, CATALOG)).toBe("1 Light Fighter");
    expect(UNITS.lf.name).toBe("Light Fighter");
  });
});
