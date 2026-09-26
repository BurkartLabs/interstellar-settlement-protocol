import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { nextYardPrice, nextYardPriceFor, yardsOwned } from "../../public/scripts/yardPrice.js";

// ISP-303 (AB#2286): each extractor yard costs more than the last (ECONOMY.md, "Sinks that scale with income", sink 3).
describe("the next extractor yard's price (AB#2286)", () => {
  it("is 50,000 / 63,000 / 78,000 / 98,000 / 122,000 / 153,000 for yards 1 to 6, from data/economy.json", () => {
    expect([0, 1, 2, 3, 4, 5].map((owned) => nextYardPrice(owned, ECONOMY.buildings))).toEqual([50_000, 63_000, 78_000, 98_000, 122_000, 153_000]);
    expect(ECONOMY.buildings.extractorYardPriceGrowth).toBe(1.25);
  });

  it("takes the Supply Forecast discount after the rise", () => {
    expect(nextYardPrice(2, ECONOMY.buildings, true)).toBe(Math.round(78_000 * ECONOMY.buildings.supplyForecastCostMultiplier));
    expect(nextYardPrice(0, ECONOMY.buildings, true)).toBe(47_000);
  });

  it("counts the corporation's yards and its research, and fails closed when the prices have not loaded", () => {
    const yard = { name: "Basic Extractor Yard" };
    const corp = { buildings: [{ name: "Headquarters" }, yard, yard], unlockedTech: ["tt-supply-forecast"] };
    expect(yardsOwned(corp)).toBe(2);
    expect(nextYardPriceFor(corp, ECONOMY.buildings)).toBe(Math.round(78_000 * 0.94));
    expect(nextYardPrice(0, {})).toBeNaN();
  });
});
