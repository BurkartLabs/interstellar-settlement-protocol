import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileStatements, readStatements, statementsDir } from "../../server/game/store.js";
import { DAY_MS } from "../../server/finances.js";

// Bug #1480: statements are filed per corporation, idempotently by day, and never kept on the account.
const day = (d, closing) => ({ day: `2026-09-0${d}`, dayStart: Date.UTC(2026, 8, d), pnl: {}, cashFlow: { closing }, balanceSheet: {} });

describe("the statements file (Bug #1480)", () => {
  it("files the days just closed and takes them off the account", () => {
    const account = { id: `acc-file-${Date.now()}`, state: { statements: [day(1, 10), day(2, 20)] } };
    expect(fileStatements(account)).toBe(2);
    expect(account.state).not.toHaveProperty("statements");
    expect(readStatements(account.id).map((s) => s.cashFlow.closing)).toEqual([10, 20]);
    expect(fs.existsSync(statementsDir)).toBe(true);
  });

  it("a day closed again replaces the one filed, so a restart before the snapshot is saved cannot duplicate it", () => {
    const account = { id: `acc-again-${Date.now()}`, state: { statements: [day(1, 10), day(2, 20)] } };
    fileStatements(account);
    account.state.statements = [day(2, 25), day(3, 30)];
    fileStatements(account);
    expect(readStatements(account.id).map((s) => [s.day, s.cashFlow.closing])).toEqual([["2026-09-01", 10], ["2026-09-02", 25], ["2026-09-03", 30]]);
  });

  it("keeps the newest 90 days", () => {
    const account = { id: `acc-ninety-${Date.now()}`, state: { statements: [] } };
    account.state.statements = Array.from({ length: 95 }, (_, i) => ({ day: `d${i}`, dayStart: Date.UTC(2026, 0, 1) + i * DAY_MS, cashFlow: { closing: i } }));
    fileStatements(account);
    const kept = readStatements(account.id);
    expect(kept).toHaveLength(90);
    expect(kept[0].cashFlow.closing).toBe(5);
  });

  it("an account with nothing to file writes nothing, and one with none has an empty list", () => {
    const account = { id: `acc-none-${Date.now()}`, state: {} };
    expect(fileStatements(account)).toBe(0);
    expect(readStatements(account.id)).toEqual([]);
  });
});
