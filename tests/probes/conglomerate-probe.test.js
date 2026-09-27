import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, longLivedAccessToken } from "../helpers/api.js";
import { SIZES, formatReport, runConglomerateProbe, targets } from "./conglomerateProbe.js";

// ISP-219 (AB#914): the conglomerate probe. In the ordinary suite it plays a 5-member conglomerate and its solo twins for
// 3 days, which proves the harness runs and executed bot days (T-008, P-GREEN-AND-EMPTY). CONGLOMERATE_PROBE=1
// (npm run probe:conglomerate) plays 5, 20, 50 and 100 members for 7 days. Targets are printed, never asserted:
// AB#914 files a balance bug on a miss. BOT NUMBERS (P-PROXY).
const FULL = process.env.CONGLOMERATE_PROBE === "1";
const START = Date.UTC(2026, 2, 16, 0, 0, 0);
let app;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START - 10 * 86_400_000);
  ({ app } = await getApp());
});
afterAll(() => vi.useRealTimers());

describe("the conglomerate probe (AB#914)", () => {
  it(FULL ? "plays 5, 20, 50 and 100 members against their solo twins for 7 days" : "plays 5 members against their solo twins for 3 days", async () => {
    const report = await runConglomerateProbe({
      app,
      register: async () => { const { account } = await registerAccount(app); return { id: account.id, token: await longLivedAccessToken(account.id) }; },
      setTime: (t) => vi.setSystemTime(t),
      start: START,
      sizes: process.env.CONGLOMERATE_PROBE_SIZES ? process.env.CONGLOMERATE_PROBE_SIZES.split(",").map(Number) : FULL ? SIZES : [5], // e.g. "100" to look at one size
      days: FULL ? 7 : 3
    });
    console.log(`\n${formatReport(report)}\n`);
    expect(report.botDays).toBe(report.accounts * (FULL ? 7 : 3)); // never a green run of nothing
    expect(report.rows.every((r) => Number.isFinite(r.member) && Number.isFinite(r.solo))).toBe(true);
    expect(targets(report)).toHaveLength(2);
  }, FULL || process.env.CONGLOMERATE_PROBE_SIZES ? 1_800_000 : 240_000);
});
