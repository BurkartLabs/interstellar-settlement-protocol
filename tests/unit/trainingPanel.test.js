import { describe, it, expect } from "vitest";
import { garrisonLines, trainingPanelHtml, troopOptions } from "../../public/scripts/trainingPanel.js";
import { UNITS_DATA } from "../../server/game/units.js";

// ISP-172 (AB#866): the Headquarters training panel on the Station page.
const UNITS = UNITS_DATA.units;

describe("the troop training panel (AB#866)", () => {
  it("offers both troop types from the catalog, with cost and time, and names missing research", () => {
    const options = troopOptions(UNITS, { unlockedTech: [] }, (id) => (id === "tt-fleet-coordination" ? "Fleet Coordination Matrix" : id));
    expect(options.map((o) => o.unit.id)).toEqual(["at", "dt"]);
    expect(options[0].reason).toBe("needs Fleet Coordination Matrix");
    expect(options[1]).toMatchObject({ reason: "", cost: "¤800 and 6 Structural Alloys a squad; 20 min each" });
  });

  it("lists jobs with what cancelling returns, and each station's garrison by name", () => {
    const now = 1_000_000;
    const corp = {
      unlockedTech: ["tt-fleet-coordination"],
      training: { queue: [{ id: "t1", unitId: "dt", quantity: 3, startsAt: now - 1, completesAt: now + 60 * 60_000 }] },
      military: { garrisons: { "earth-station-prime": 10, "luna-gateway": 1 } }
    };
    const names = { "earth-station-prime": "Earth Station Prime", "luna-gateway": "Luna Gateway" };
    expect(garrisonLines(corp, (id) => names[id])).toEqual(["Earth Station Prime: 10 squads", "Luna Gateway: 1 squad"]);
    const html = trainingPanelHtml(UNITS, corp, { now, stationName: (id) => names[id] });
    expect(html).toContain("3 squads of Defense Troops");
    expect(html).toContain("Cancel (returns half)");
    expect(html).toContain("Earth Station Prime: 10 squads of Defense Troops");
  });

  it("says when nobody is training and no station has a garrison", () => {
    const html = trainingPanelHtml(UNITS, { unlockedTech: [] });
    expect(html).toContain("Nobody in training.");
    expect(html).toContain("No station has a garrison yet.");
  });
});
