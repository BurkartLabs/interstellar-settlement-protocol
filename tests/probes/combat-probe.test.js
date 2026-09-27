import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { RAID_PROFILES, counterMatrix, fleetSizeSweep, formatReport, runRaidWorld, targets } from "./combatProbe.js";

// ISP-183 (AB#877): the combat probe. In the ordinary suite the raid world plays one profile for 5 measured days, which
// proves the harness runs and executed bot days (T-008, P-GREEN-AND-EMPTY); the counter matrix and the fleet-size sweep
// are cheap and run whole. COMBAT_PROBE=1 (npm run probe:combat) plays every profile for 30 days. Targets are printed,
// never asserted (AB#877: misses are reported and filed), except the five-way cycle: a unit that breaks it is a
// catalog change the design says must fail (v0.10-combat.md, the ISP-183 row). BOT NUMBERS (P-PROXY).
const FULL = process.env.COMBAT_PROBE === "1";
const START = Date.UTC(2026, 2, 2, 0, 0, 0);
let app;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  ({ app } = await getApp());
});
afterAll(() => vi.useRealTimers());

describe("the combat probe (AB#877)", () => {
  it(FULL ? "plays the matrix, the sweep and every raid profile for 30 days" : "plays the matrix, the sweep and one raid profile for 5 days", async () => {
    const matrix = counterMatrix();
    const sweep = fleetSizeSweep();
    const world = await runRaidWorld({
      newCorporation: async () => (await registerAccount(app)).account.id,
      setTime: (t) => vi.setSystemTime(t),
      start: START,
      profiles: FULL ? RAID_PROFILES : RAID_PROFILES.slice(0, 1),
      days: FULL ? 30 : 5
    });
    console.log(`\n${formatReport({ matrix, sweep, world })}\n`);
    expect(world.botDays).toBe(world.bots.length * (FULL ? 30 : 5)); // never a green run of nothing
    expect(matrix.matchups.length).toBe(3 * 5 * 4);
    expect(matrix.cycle.filter((c) => !c.holds)).toEqual([]); // the five-way cycle holds
    expect(targets({ matrix, sweep, world })).toHaveLength(5);
  }, FULL ? 1_800_000 : 180_000);
});
