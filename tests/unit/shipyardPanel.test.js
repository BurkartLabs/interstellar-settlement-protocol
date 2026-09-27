import { describe, it, expect } from "vitest";
import { durationText, shipOptions, shipyardPanelHtml } from "../../public/scripts/shipyardPanel.js";
import { UNITS_DATA } from "../../server/game/units.js";

// ISP-171 (AB#865): the shipyard's panel on the Station page. Shown only with a shipyard; each ship says what it costs
// and, when it cannot be queued, the research it needs; each job says what cancelling it returns.
const UNITS = UNITS_DATA.units;
const withYard = (over = {}) => ({ buildings: [{ name: "Headquarters" }, { name: "Orbital Shipyard" }], unlockedTech: ["tt-fleet-coordination"], ...over });

describe("the Orbital Shipyard's panel (AB#865)", () => {
  it("is empty without a shipyard, so the section stays hidden", () => {
    expect(shipyardPanelHtml(UNITS, { buildings: [{ name: "Headquarters" }] })).toBe("");
  });

  it("offers the three ships from the catalog, each with its cost and time, and names missing research", () => {
    const options = shipOptions(UNITS, withYard(), (id) => ({ "tt-capital-hulls": "Capital Hull Engineering", "tt-siege-ordnance": "Siege Ordnance" }[id] || id));
    expect(options.map((o) => o.unit.id)).toEqual(["lf", "ds", "se"]);
    expect(options[0]).toMatchObject({ reason: "", cost: "¤1,150 and 10 Carbon Fibre Sheets each", time: "30 min" });
    expect(options[1].reason).toBe("needs Capital Hull Engineering");
    expect(options[2]).toMatchObject({ reason: "needs Siege Ordnance", time: "3 h" });
    const html = shipyardPanelHtml(UNITS, withYard());
    expect(html).toContain('<option value="ds" data-cost=');
    expect(html).toMatch(/<option value="ds"[^>]*disabled>Destroyer \(needs tt-capital-hulls\)/);
  });

  it("lists each job with what cancelling returns: all before it starts, half once it has", () => {
    const now = 1_000_000;
    const queue = [
      { id: "a", unitId: "lf", quantity: 2, startsAt: now - 1, completesAt: now + 3_600_000 },
      { id: "b", unitId: "ds", quantity: 1, startsAt: now + 3_600_000, completesAt: now + 12_600_000 }
    ];
    const html = shipyardPanelHtml(UNITS, withYard({ shipyard: { queue } }), { now, fleet: { vessels: 5, cap: 14 } });
    expect(html).toContain("2 Light Fighters");
    expect(html).toContain("ready in 1 h");
    expect(html).toContain("Cancel (returns half)");
    expect(html).toContain("starts in 1 h, then 2 h 30 min");
    expect(html).toContain("Cancel (returns all)");
    expect(html).toContain("Fleet: 5 of 14 vessels");
  });

  it("writes a duration in hours and minutes", () => {
    expect(durationText(30 * 60_000)).toBe("30 min");
    expect(durationText(150 * 60_000)).toBe("2 h 30 min");
    expect(durationText(180 * 60_000)).toBe("3 h");
  });
});
