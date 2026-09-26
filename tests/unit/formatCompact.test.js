import { describe, expect, it } from "vitest";
import { formatCompact } from "../../public/scripts/charts.js";

// AB#2089: with an all-zero series Chart.js picks fractional ticks around zero, and formatCompact rounded every value
// under 1,000 to a whole number, so the Net Cash Flow axis read 1, 1, 1, 0, 0, 0. A tick label must say its own value.
describe("formatCompact (AB#2089)", () => {
  it("prints a fraction under 1,000 with up to two decimals instead of rounding it away", () => {
    expect(formatCompact(0.5)).toBe("0.5");
    expect(formatCompact(-0.25)).toBe("-0.25");
    expect(formatCompact(0.2)).toBe("0.2");
    expect(formatCompact(12.345)).toBe("12.35");
  });

  it("the ticks Chart.js puts around a flat zero line all read differently", () => {
    const ticks = [1, 0.8, 0.6, 0.4, 0.2, 0, -0.2, -0.4, -0.6, -0.8, -1];
    const labels = ticks.map(formatCompact);
    expect(new Set(labels).size).toBe(ticks.length);
    expect(labels).toEqual(["1", "0.8", "0.6", "0.4", "0.2", "0", "-0.2", "-0.4", "-0.6", "-0.8", "-1"]);
  });

  it("whole numbers and the K, M and B forms are unchanged", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(250)).toBe("250");
    expect(formatCompact(-999)).toBe("-999");
    expect(formatCompact(1500)).toBe("1.5K");
    expect(formatCompact(2_500_000)).toBe("2.50M");
    expect(formatCompact(3_000_000_000)).toBe("3.00B");
    expect(formatCompact(Number.NaN)).toBe("—");
  });
});
