import { describe, it, expect } from "vitest";
import { getEffectiveExchangeTaxRate } from "../../server/gameState.js";

function makeStateWithInsights(insightIds = []) {
  return { corp: { completedInsights: insightIds } };
}

describe("getEffectiveExchangeTaxRate", () => {
  it("returns the base rate of 8% with no insights", () => {
    expect(getEffectiveExchangeTaxRate(makeStateWithInsights([]))).toBe(8);
  });

  it("returns 8% if completedInsights is missing entirely", () => {
    expect(getEffectiveExchangeTaxRate({ corp: {} })).toBe(8);
  });

  it("subtracts 2% per ceo-negotiation-fundamentals completion", () => {
    expect(
      getEffectiveExchangeTaxRate(
        makeStateWithInsights(["ceo-negotiation-fundamentals"])
      )
    ).toBe(6);
    expect(
      getEffectiveExchangeTaxRate(
        makeStateWithInsights([
          "ceo-negotiation-fundamentals",
          "ceo-negotiation-fundamentals"
        ])
      )
    ).toBe(4);
    expect(
      getEffectiveExchangeTaxRate(
        makeStateWithInsights([
          "ceo-negotiation-fundamentals",
          "ceo-negotiation-fundamentals",
          "ceo-negotiation-fundamentals"
        ])
      )
    ).toBe(2);
  });

  it("caps at the program's maxLevels (does not go negative)", () => {
    const tenLevels = Array(10).fill("ceo-negotiation-fundamentals");
    const result = getEffectiveExchangeTaxRate(makeStateWithInsights(tenLevels));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(8);
  });

  it("ignores other insight ids that aren't negotiation fundamentals", () => {
    expect(
      getEffectiveExchangeTaxRate(
        makeStateWithInsights(["ceo-leadership-101", "ceo-charisma-x"])
      )
    ).toBe(8);
  });
});
