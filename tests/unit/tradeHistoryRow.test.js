import { describe, it, expect } from "vitest";
import { TRADE_TYPES, tradeTypeBadge, tradeTotalCell } from "../../public/scripts/tradeHistory.js";
import { serverCode } from "../helpers/serverSource.js";

// AB#1168: a cancelled listing showed as bare "cancelled" text with no badge, and a Total as if money had moved.
// The types come from the server's own tradeHistory writes, so a type added there without a label fails here.
const serverTypes = () => {
  const types = new Set();
  for (const m of serverCode().matchAll(/tradeHistory\.unshift\(\{[\s\S]*?type:\s*"([^"]+)"/g)) types.add(m[1]);
  return [...types].sort();
};

describe("Trade History rows (AB#1168)", () => {
  it("finds every type the server writes, cancelled included", () => {
    const types = serverTypes();
    expect(types.length).toBeGreaterThanOrEqual(5);
    expect(types).toContain("cancelled");
  });

  it("gives every type the server writes a label and a badge class", () => {
    for (const type of serverTypes()) {
      expect(TRADE_TYPES[type], type).toBeDefined();
      const html = tradeTypeBadge({ type });
      // ISP-80 (AB#769): a design-system badge, its tone the type's, found by data-trade-type.
      expect(html, type).toContain(`class="ui-badge${TRADE_TYPES[type].tone ? ` ui-badge--${TRADE_TYPES[type].tone}` : ""}" data-trade-type="${type}"`);
      expect(html, type).toContain(`>${TRADE_TYPES[type].label}<`);
    }
    expect(tradeTypeBadge({ type: "cancelled" })).toContain(">Cancelled<");
  });

  it("shows no total for rows that moved no money", () => {
    for (const type of ["listed", "cancelled"]) expect(tradeTotalCell({ type, total: 50 }), type).toBe("-");
    expect(tradeTotalCell({ type: "bought", total: 50 })).toBe("$50");
  });

  it("escapes a type it does not know rather than injecting it", () => {
    expect(tradeTypeBadge({ type: "<img src=x>" })).not.toContain("<img");
  });
});
