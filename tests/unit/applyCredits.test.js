import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applyCredits, CREDIT_CATEGORIES, UNCATEGORISED } from "../../server/finances.js";

// AB#712: every change to finances.credits goes through applyCredits, which books the same amount in the ledger.
const corp = (credits = 1000) => ({ finances: { credits } });

describe("applyCredits (AB#712)", () => {
  const env = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = env; });

  it("a cost moves credits down and books the same amount as an expense", () => {
    const c = corp();
    expect(applyCredits(c, -250, "hiring", 5)).toBe(-250);
    expect(c.finances.credits).toBe(750);
    expect(c.finances.expensesByCategory).toEqual({ hiring: 250 });
    expect(c.finances.lifetimeCosts).toBe(250);
    expect(c.finances.expenseLog).toEqual([{ t: 5, amount: 250 }]);
  });

  it("income moves credits up and books the same amount as income", () => {
    const c = corp();
    applyCredits(c, 400, "missions");
    expect(c.finances.credits).toBe(1400);
    expect(c.finances.incomeBySource).toEqual({ missions: 400 });
    expect(c.finances.lifetimeRevenue).toBe(400);
  });

  it("rounds to whole credits, so the balance and the ledger agree exactly", () => {
    const c = corp(0);
    applyCredits(c, -10.4, "construction");
    applyCredits(c, 20.6, "exchange");
    expect(c.finances.credits).toBe(-10 + 21);
    expect(c.finances.lifetimeRevenue - c.finances.lifetimeCosts).toBe(c.finances.credits);
  });

  it("zero moves and books nothing, under either side's name", () => {
    const c = corp();
    expect(applyCredits(c, 0, "exchange-tax")).toBe(0);
    expect(applyCredits(c, 0, "exchange")).toBe(0);
    expect(c.finances.credits).toBe(1000);
    expect(c.finances.expensesByCategory).toEqual({});
    expect(c.finances.incomeBySource).toEqual({});
  });

  for (const bad of [NaN, Infinity, -Infinity, "100", null, undefined, {}, 10n]) {
    it(`a delta of ${typeof bad === "bigint" ? "10n" : JSON.stringify(bad) ?? String(bad)} throws before anything changes`, () => {
      const c = corp();
      const before = JSON.stringify(c);
      expect(() => applyCredits(c, bad, "hiring")).toThrow(TypeError);
      expect(JSON.stringify(c)).toBe(before);
    });
  }

  it("an unknown category throws under test, before anything changes", () => {
    const c = corp();
    expect(() => applyCredits(c, -5, "bribes")).toThrow(/not a expense category/);
    expect(() => applyCredits(c, 5, "hiring")).toThrow(/not a income category/); // an expense name used for income
    expect(c.finances.credits).toBe(1000);
  });

  it("outside tests an unknown category is booked as uncategorised, and the player's action still happens", () => {
    process.env.NODE_ENV = "production";
    const c = corp();
    applyCredits(c, -5, "bribes");
    applyCredits(c, 7, "found-money");
    expect(c.finances.credits).toBe(1002);
    expect(c.finances.expensesByCategory).toEqual({ [UNCATEGORISED]: 5 });
    expect(c.finances.incomeBySource).toEqual({ [UNCATEGORISED]: 7 });
  });

  it("the category list is fixed: frozen, and no name is on both sides", () => {
    expect(Object.isFrozen(CREDIT_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(CREDIT_CATEGORIES.income)).toBe(true);
    expect(Object.isFrozen(CREDIT_CATEGORIES.expense)).toBe(true);
    expect(CREDIT_CATEGORIES.income.filter((n) => CREDIT_CATEGORIES.expense.includes(n))).toEqual([]);
  });

  it("a corporation with no finances yet gets them", () => {
    const c = {};
    applyCredits(c, 10, "missions");
    expect(c.finances.credits).toBe(10);
  });
});

describe("no credit changes outside applyCredits (AB#712)", () => {
  it("nothing in server/ assigns to credits except the helper", () => {
    const dir = path.resolve(__dirname, "../../server");
    const offenders = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const lines = fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        // An assignment (=, +=, -=, *=, /=, ++, --) to anything ending in .credits or ["credits"].
        if (/(\.credits|\[["']credits["']\])\s*([-+*/]?=(?!=)|\+\+|--)/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders.filter((o) => !o.startsWith("finances.js:"))).toEqual([]);
    // The one inside the helper: a starting balance in a new corporation's literal is an opening balance, not a move.
    expect(offenders.map((o) => o.replace(/^finances\.js:\d+: /, ""))).toEqual(["corp.finances.credits = Math.round(Number(corp.finances.credits) || 0) + amount;"]);
  });
});
