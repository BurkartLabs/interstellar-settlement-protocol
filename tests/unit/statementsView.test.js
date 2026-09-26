import { describe, it, expect } from "vitest";
import {
  statementHtml, statementDayOptionsHtml, statementsEmptyHtml, statementsToSeries, statementLabel, statementCredits
} from "../../public/scripts/statements.js";

// AB#714: the Financial Core's daily statements, rendered from what GET /finances/statements returns (AB#713).
const DAY = 86_400_000;
const statement = (day, over = {}) => ({
  day,
  dayStart: Date.parse(`${day}T00:00:00Z`),
  pnl: { income: { exchange: 1_200 }, expenses: { hiring: 8_000, "ceo-insight": 25_000 }, totalIncome: 1_200, totalExpenses: 33_000, net: -31_800 },
  cashFlow: { opening: 250_000, inflows: 1_200, outflows: 33_000, closing: 218_200, unrecorded: 0 },
  balanceSheet: { credits: 218_200, facilities: 30_000, inventory: 4_800, liabilities: 7_200, totalAssets: 253_000, netWorth: 245_800 },
  ...over
});

/** Every figure the page shows, as { "pnl.net": -31800, ... }, read from the data attributes. */
export function figuresIn(html) {
  return Object.fromEntries([...html.matchAll(/data-figure="([^"]+)" data-value="(-?\d+)"/g)].map((m) => [m[1], Number(m[2])]));
}

describe("a day's statements (AB#714)", () => {
  it("shows every figure of the three statements, each exactly as the statement has it", () => {
    const s = statement("2026-09-21");
    const shown = figuresIn(statementHtml(s));
    expect(shown).toEqual({
      "pnl.income.exchange": 1_200, "pnl.expenses.ceo-insight": 25_000, "pnl.expenses.hiring": 8_000,
      "pnl.totalIncome": 1_200, "pnl.totalExpenses": 33_000, "pnl.net": -31_800,
      "cashFlow.opening": 250_000, "cashFlow.inflows": 1_200, "cashFlow.outflows": 33_000, "cashFlow.closing": 218_200,
      "balanceSheet.credits": 218_200, "balanceSheet.facilities": 30_000, "balanceSheet.inventory": 4_800,
      "balanceSheet.totalAssets": 253_000, "balanceSheet.liabilities": 7_200, "balanceSheet.netWorth": 245_800
    });
  });

  it("writes the amounts the way the Financial Core does: grouped, signed, coloured", () => {
    const html = statementHtml(statement("2026-09-21"));
    expect(html).toContain(`data-figure="pnl.net" data-value="-31800">−31,800</td>`);
    expect(html).toContain(`<td data-label="Amount" class="ui-figure ui-figure--negative" data-figure="pnl.expenses.hiring" data-value="8000">−8,000</td>`);
    expect(html).toContain(`<td data-label="Amount" class="ui-figure ui-figure--positive" data-figure="pnl.income.exchange" data-value="1200">+1,200</td>`);
    expect(html).toContain('<td data-label="Line">CEO Insight</td>');
    expect(html).toContain("Profit &amp; Loss");
  });

  it("shows 'Not in the ledger' only when credits moved outside it", () => {
    expect(statementHtml(statement("2026-09-21"))).not.toContain("Not in the ledger");
    const off = statement("2026-09-21", { cashFlow: { opening: 0, inflows: 0, outflows: 0, closing: 777, unrecorded: 777 } });
    expect(figuresIn(statementHtml(off))["cashFlow.unrecorded"]).toBe(777);
  });

  it("a quiet day says None rather than showing empty sections", () => {
    const quiet = statement("2026-09-21", { pnl: { income: {}, expenses: {}, totalIncome: 0, totalExpenses: 0, net: 0 } });
    expect(statementHtml(quiet).match(/<td data-label="Line">None<\/td>/g)).toHaveLength(2);
  });

  it("escapes what it prints: a category name cannot become markup", () => {
    const html = statementHtml(statement("2026-09-21", { pnl: { income: { "<img src=x onerror=alert(1)>": 5 }, expenses: {}, totalIncome: 5, totalExpenses: 0, net: 5 } }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;Img Src=X Onerror=Alert(1)&gt;");
  });
});

describe("the day picker and the first day (AB#714)", () => {
  const now = Date.parse("2026-09-22T10:00:00Z");
  const list = [statement("2026-09-21"), statement("2026-09-20"), statement("2026-09-19")];

  it("lists the days newest first, yesterday chosen and marked", () => {
    const html = statementDayOptionsHtml(list, undefined, now);
    expect([...html.matchAll(/value="([^"]+)"/g)].map((m) => m[1])).toEqual(["2026-09-21", "2026-09-20", "2026-09-19"]);
    expect(html).toContain(`<option value="2026-09-21" selected>Mon 21 Sep 2026 (yesterday)</option>`);
  });

  it("keeps a chosen day selected", () => {
    expect(statementDayOptionsHtml(list, "2026-09-19", now)).toContain(`<option value="2026-09-19" selected>`);
  });

  it("before the first close it says when it comes, with what has moved so far today", () => {
    const html = statementsEmptyHtml({ dayStart: now - 36_000_000, opening: 250_000, income: { exchange: 1_200 }, expenses: { hiring: 8_000 } });
    expect(html).toContain("Your first statement closes at 00:00 UTC.");
    expect(html).toContain("+1,200</span> in");
    expect(html).toContain("−8,000</span> out");
    expect(html).not.toContain("<table");
  });
});

describe("chart points from the statements (AB#714)", () => {
  it("one point per closed day, at its close, oldest first, shaped like a snapshot", () => {
    const points = statementsToSeries([statement("2026-09-21"), statement("2026-09-20")]);
    expect(points.map((p) => [p.t, p.label])).toEqual([
      [Date.parse("2026-09-21T00:00:00Z"), "20 Sep"],
      [Date.parse("2026-09-22T00:00:00Z"), "21 Sep"]
    ]);
    expect(points[1]).toMatchObject({ credits: 218_200, assets: 30_000, inventory: 4_800, liabilities: 7_200, netFlow: -31_800, netWorth: 245_800 });
    expect(points[1].t - points[0].t).toBe(DAY);
  });

  it("labels and formats predictably", () => {
    expect(statementLabel("office-rent")).toBe("Office Rent");
    expect(statementCredits(1234567.6)).toBe("1,234,568");
  });
});
