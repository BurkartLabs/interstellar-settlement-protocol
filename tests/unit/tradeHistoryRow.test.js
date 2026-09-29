import { describe, it, expect } from "vitest";
import { TRADE_TYPES, saleDeductions, tradeTypeBadge, tradeTotalCell } from "../../public/scripts/tradeHistory.js";
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
    expect(tradeTotalCell({ type: "bought", total: 50 })).toBe("¤50");
  });

  // Bug #4853: AB#940's playthrough sold 500 Nickel at 26 at a 3% tariff: 13,000 less 1,040 tax and 390 tariff. The row
  // read "11,570 (1,040 tax)", and the 390 went unexplained.
  it("names every deduction the sale took, not only the tax (Bug #4853)", () => {
    const sale = { type: "sold", total: 13_000, taxAmount: 1_040, proceeds: 11_960 };
    expect(tradeTotalCell(sale)).toBe(`¤11,960 <span class="exchange__tax">(¤1,040 tax)</span>`);
    expect(tradeTotalCell({ ...sale, tariffAmount: 390, proceeds: 11_570 })).toBe(`¤11,570 <span class="exchange__tax">(¤1,040 tax, ¤390 tariff)</span>`);
    const all = { ...sale, tariffAmount: 390, dutyWithheld: 1_157, councilWithheld: 50, royaltyWithheld: 25, proceeds: 10_338 };
    expect(tradeTotalCell(all)).toContain("(¤1,040 tax, ¤390 tariff, ¤1,157 withheld for ITC duty, ¤50 withheld toward an Arbitration Council award, ¤25 withheld toward patent royalties owed)");
    // a tariff with no tax (a tax-free sale) still shows the proceeds and the tariff, not the gross
    expect(tradeTotalCell({ type: "sold-npc", total: 13_000, taxAmount: 0, tariffAmount: 390, proceeds: 12_610 })).toBe(`¤12,610 <span class="exchange__tax">(¤390 tariff)</span>`);
  });

  it("saleDeductions reads what the NPC route returns too, and nothing when nothing was taken", () => {
    expect(saleDeductions({ taxAmount: 0, tariffPct: 0, tariffAmount: 0, dutyWithheld: 0, proceeds: 100 })).toEqual([]);
    expect(saleDeductions({ taxAmount: 8, tariffAmount: 3 })).toEqual(["¤8 tax", "¤3 tariff"]);
    expect(saleDeductions(undefined)).toEqual([]);
  });

  it("escapes a type it does not know rather than injecting it", () => {
    expect(tradeTypeBadge({ type: "<img src=x>" })).not.toContain("<img");
  });
});
