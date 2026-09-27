import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { PROFILES, POLICIES, debtDisagreements, formatReport, runMarketsProbe, targets } from "./marketsProbe.js";

// ISP-162 (AB#856): the financial-markets probe. In the ordinary suite it plays one profile for 5 measured days, which
// proves the harness runs and executed bot days (T-008, P-GREEN-AND-EMPTY). MARKETS_PROBE=1 (npm run probe:markets)
// plays every profile for 30 days and prints the table the v0.9 stories cite. Either way the targets are printed, never
// asserted: a FAIL is a finding for the PM to tune, not a red suite (AB#856's acceptance). BOT NUMBERS (P-PROXY).
const FULL = process.env.MARKETS_PROBE === "1";
const START = Date.UTC(2026, 2, 2, 0, 0, 0);
let app;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  ({ app } = await getApp());
});
afterAll(() => vi.useRealTimers());

describe("the financial-markets probe (AB#856)", () => {
  it(FULL ? "plays every profile for 30 days and prints the table" : "plays one profile for 5 days and executes bot days", async () => {
    const report = await runMarketsProbe({
      newCorporation: async () => (await registerAccount(app)).account.id,
      setTime: (t) => vi.setSystemTime(t),
      start: START,
      profiles: FULL ? PROFILES : PROFILES.slice(-1),
      days: FULL ? 30 : 5
    });
    console.log(`\n${formatReport(report)}\n`);
    expect(report.botDays).toBe((FULL ? PROFILES.length : 1) * POLICIES.length * (FULL ? 30 : 5)); // never a green run of nothing
    for (const b of report.bots) expect(Number.isFinite(b.nw30.founder)).toBe(true);
    expect(targets(report)).toHaveLength(3);
    // Bug #4647's regression: the statement counts the debt the probe counts, and there is debt to count
    expect(report.bots.some((b) => b.nw30.probeDebt > 0)).toBe(true);
    expect(debtDisagreements(report).map((b) => `${b.policy}: ${b.nw30.debtLine} vs ${b.nw30.probeDebt}`)).toEqual([]);
  }, FULL ? 1_800_000 : 180_000);
});
