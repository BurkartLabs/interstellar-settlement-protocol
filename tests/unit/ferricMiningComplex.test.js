import { describe, it, expect, afterEach, vi } from "vitest";
import { applyAsteroidExpeditions, BELT_KEYS } from "../../server/gameState.js";
import { expeditionNotificationBody } from "../../server/expeditionText.js";
import { ECONOMY } from "../../server/economy.js";
import { playerBuilding } from "../../server/playerBuildings.js";
import { makeCorp } from "../fixtures/makeCorp.js";

// ISP-96 (AB#786): the Ferric Mining Complex. When an expedition returns, the Nickel and Titanium it deposits are
// multiplied (docs/design/buildings.md, v0.6-01), in whole units rounded down; nothing else it carries is.

const START = 1_700_000_000_000;
const MULTIPLIER = ECONOMY.buildings.ferricMiningComplexMetalMultiplier;

afterEach(() => vi.restoreAllMocks());

/** A corporation whose one expedition completes at START + 60s carrying `yields`, and no more is mined on the way. */
function returning(yields, buildings = []) {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  return makeCorp({
    currentStationId: "earth-station-prime",
    buildings,
    inventory: {},
    asteroidMining: {
      probeCount: 0, maxProbes: 2, completedExpeditions: [],
      activeExpeditions: [{ id: "exp-fmc", status: "active", beltKey: BELT_KEYS[0], systemId: "sol",
        duration: "standard", deployedAt: START, lastTickAt: START + 60_000, completesAt: START + 60_000, yields: { ...yields } }]
    }
  });
}
const COMPLEX = [{ name: "Ferric Mining Complex", tier: 1, status: "Operational" }];

describe("the Ferric Mining Complex (ISP-96)", () => {
  it("is the catalogue's, at the design's price, gate, cap and slot", () => {
    const b = playerBuilding("ferric-mining-complex");
    expect(b).toMatchObject({ name: "Ferric Mining Complex", slot: "corporation", researchGates: ["tt-material-compression"], cap: { perCorporation: 1 }, cost: 90_000, assetValue: 65_000 });
    expect(MULTIPLIER).toBe(1.25);
  });

  it("with it, a returning expedition deposits 1.25 times its Nickel and Titanium, and the rest as it was", () => {
    const corp = returning({ Nickel: 40, Titanium: 20, Silicates: 12 }, COMPLEX);
    applyAsteroidExpeditions(corp, START + 60_001);
    expect(corp.inventory["earth-station-prime"]).toEqual({ Nickel: 50, Titanium: 25, Silicates: 12 });
    const done = corp.asteroidMining.completedExpeditions[0];
    expect(done.yields).toEqual({ Nickel: 50, Titanium: 25, Silicates: 12 });
    expect(done.ferricBonus).toEqual({ Nickel: 10, Titanium: 5 });
  });

  it("without it, the same expedition deposits what it carried", () => {
    const corp = returning({ Nickel: 40, Titanium: 20, Silicates: 12 });
    applyAsteroidExpeditions(corp, START + 60_001);
    expect(corp.inventory["earth-station-prime"]).toEqual({ Nickel: 40, Titanium: 20, Silicates: 12 });
    expect(corp.asteroidMining.completedExpeditions[0].ferricBonus).toBeUndefined();
  });

  it("rounds down to whole units, and names no bonus that rounded to nothing", () => {
    const corp = returning({ Nickel: 3, Titanium: 7 }, COMPLEX);
    applyAsteroidExpeditions(corp, START + 60_001);
    expect(corp.inventory["earth-station-prime"]).toEqual({ Nickel: 3, Titanium: 8 });
    expect(corp.asteroidMining.completedExpeditions[0].ferricBonus).toEqual({ Titanium: 1 });
  });

  it("the Expedition Complete notification says what the complex added", () => {
    expect(expeditionNotificationBody({ yields: { Nickel: 50, Silicates: 12 }, ferricBonus: { Nickel: 10 }, depositStationId: "earth-station-prime" }))
      .toContain("Your Ferric Mining Complex added 10 Nickel.");
    expect(expeditionNotificationBody({ yields: { Nickel: 40 }, depositStationId: "earth-station-prime" })).not.toContain("Ferric");
  });
});
