import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, longLivedAccessToken } from "../helpers/api.js";
import { FLOOD_SHARES, PRICE_FRACTIONS, formatReport, runTariffProbe, targets } from "./tariffProbe.js";

// ISP-234 (AB#929): the tariff and dumping probe. In the ordinary suite it sweeps both worked-example systems' tariffs,
// checks the condominium, and plays four flood weeks (two floods and their twins), which proves the harness runs and
// executed bot trades (T-008, P-GREEN-AND-EMPTY). TARIFF_PROBE=1 (npm run probe:tariffs) plays the whole flood grid.
// Targets are printed, never asserted: AB#929 files a balance bug on a miss. BOT NUMBERS (P-PROXY).
const FULL = process.env.TARIFF_PROBE === "1";
const START = Date.UTC(2026, 3, 6, 0, 0, 0);
let app;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START - 10 * 86_400_000);
  ({ app } = await getApp());
});
afterAll(() => vi.useRealTimers());

describe("the tariff and dumping probe (AB#929)", () => {
  it(FULL ? "sweeps the tariffs and plays the whole flood grid" : "sweeps the tariffs and plays two floods", async () => {
    const report = await runTariffProbe({
      app,
      register: async () => { const { account } = await registerAccount(app); return { id: account.id, token: await longLivedAccessToken(account.id) }; },
      setTime: (t) => vi.setSystemTime(t),
      tokenFor: (id) => longLivedAccessToken(id),
      start: START,
      fractions: FULL ? PRICE_FRACTIONS : [0.85, 0.84],
      shares: FULL ? FLOOD_SHARES : [1]
    });
    console.log(`\n${formatReport(report)}\n`);
    expect(report.sales).toBeGreaterThan(0); // never a green run of nothing
    expect(report.trades).toBe(report.cells.length);
    expect(report.sweeps.every((s) => s.steps.every((x) => x.filedOk && x.charged === x.pct))).toBe(true);
    expect(report.cells.every((c) => Number.isFinite(c.net) && !c.refused.length)).toBe(true);
    expect(targets(report)).toHaveLength(report.sweeps.length + 3);
  }, FULL ? 1_800_000 : 240_000);
});
