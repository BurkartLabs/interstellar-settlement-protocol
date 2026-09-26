import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { nextYardPrice, nextYardPriceFor, yardsOwned } from "../../public/scripts/yardPrice.js";

// ISP-303 (AB#2286): each extractor yard past the starting kit costs more than the last (ECONOMY.md, "Sinks that scale
// with income", sink 3). ISP-309 (AB#2305): the kit's two yards are flat; growth starts at yard 3.
describe("the next extractor yard's price (AB#2286, AB#2305)", () => {
  it("is 50,000 / 50,000 / 63,000 / 78,000 / 98,000 / 122,000 / 153,000 / 191,000 for yards 1 to 8, from data/economy.json", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((owned) => nextYardPrice(owned, ECONOMY.buildings))).toEqual([50_000, 50_000, 63_000, 78_000, 98_000, 122_000, 153_000, 191_000]);
    expect(ECONOMY.buildings.extractorYardPriceGrowth).toBe(1.25);
    expect(ECONOMY.buildings.extractorYardsInStartingKit).toBe(2);
  });

  it("follows the kit size in the data, and a missing one grows from the second yard as before", () => {
    const b = { extractorYardCost: 50_000, extractorYardPriceGrowth: 1.25 };
    expect([0, 1, 2].map((owned) => nextYardPrice(owned, b))).toEqual([50_000, 63_000, 78_000]);
    expect([0, 1, 2, 3].map((owned) => nextYardPrice(owned, { ...b, extractorYardsInStartingKit: 3 }))).toEqual([50_000, 50_000, 50_000, 63_000]);
  });

  it("takes the Supply Forecast discount after the rise", () => {
    expect(nextYardPrice(2, ECONOMY.buildings, true)).toBe(Math.round(63_000 * ECONOMY.buildings.supplyForecastCostMultiplier));
    expect(nextYardPrice(0, ECONOMY.buildings, true)).toBe(47_000);
  });

  it("counts the corporation's yards and its research, and fails closed when the prices have not loaded", () => {
    const yard = { name: "Basic Extractor Yard" };
    const corp = { buildings: [{ name: "Headquarters" }, yard, yard], unlockedTech: ["tt-supply-forecast"] };
    expect(yardsOwned(corp)).toBe(2);
    expect(nextYardPriceFor(corp, ECONOMY.buildings)).toBe(Math.round(63_000 * 0.94));
    expect(nextYardPrice(0, {})).toBeNaN();
  });
});
