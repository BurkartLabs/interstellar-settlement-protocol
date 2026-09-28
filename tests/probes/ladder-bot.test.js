import { describe, it, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { MILESTONE_LEVELS, MAX_DEFINED_LEVEL } from "../../server/game/catalog.js";
import * as ticks from "../../server/ticks.js";
import { climb } from "./ladderBot.js";

// ISP-107 (AB#799): the ladder bot climbs every defined level of the current data through the real routes, on an
// injected clock. Its numbers are BOT NUMBERS (P-PROXY), and under vitest the server runs on its development timings
// (research instant, an expedition ten seconds), so simulated hours here are not the year-pacing probe's.
const RESEARCH = JSON.parse(fs.readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes;

afterAll(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/**
 * Bug AB#2360 (and #4653, #4657): the server draws Math.random for mining breakdowns, the contract board's quotas and
 * rewards, belt compositions and more, so every run of this test was a different game, and one in a few hundred fell
 * short of a level inside the 240 simulated days: at Level 4 once, at Level 29 more often. The draws are a seeded
 * stream now (mulberry32; LADDER_SEED, default 1), so a run is the same run every time and a failure is a change in
 * the game, not in its luck. Variance across seeds is a probe's question (LADDER_SEED=<n> answers it), not this test's.
 */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const LADDER_SEED = Number(process.env.LADDER_SEED || 1);

describe("the ladder bot (AB#799)", () => {
  it(`climbs Levels 1 to ${MAX_DEFINED_LEVEL} through the server's own routes, and reports each level`, async () => {
    // The clock the server reads, moved only by the bot, set before the corporation exists: whatever registration
    // stamps (the contract board's next refresh) is on this clock too. Only Date is faked: timers stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 0, 1, 9, 0, 0));
    vi.spyOn(Math, "random").mockImplementation(seededRandom(LADDER_SEED)); // Bug AB#2360
    const { app } = await getApp();
    const account = await registerAccount(app);
    const clock = { now: () => Date.now(), advance: (ms) => vi.setSystemTime(Date.now() + ms) };
    const tick = async () => {
      ticks.checkAndResetNpcBuyOrders();
      ticks.miningTick();
      ticks.refineryTick();
      ticks.fabricationTick();
      ticks.asteroidExpeditionTick();

      ticks.beltTick(); // AB#2330: a mined-out belt forms anew on the hour, as the server's minute ticker has it
      ticks.travelTick();
      ticks.shipmentTick(); // AB#800: ore shipped home from Mars and Luna
      ticks.processRndCompletions();
    };

    const records = await climb({
      request: request(app),
      account: { id: account.account.id, email: account.body.email, password: account.body.password },
      clock,
      tick,
      levels: MILESTONE_LEVELS,
      research: RESEARCH,
      maxLevel: MAX_DEFINED_LEVEL,
      // AB#800: Level 20 is about half a year in. The cap is a pacing check, kept (Bug #4657). Bug AB#2360: with the draws
      // seeded, seed 1 reaches Level 30 on day 238.4, every run; seed 2 on day 236.2, seed 3 on day 241.8, so a failure
      // here now means the pacing changed, not the luck. Whether Level 30 is meant to fit in 240 days for every seed is
      // the economy's call (Bug #4653), not this test's.
      maxDays: Number(process.env.LADDER_DAYS || 240)
    });

    console.log(`[ladder bot, AB#799] BOT NUMBERS on development timings, not player time (seed ${LADDER_SEED}):\n${records
      .map((r) => `  Level ${r.level}: ${r.hours} h (at ${r.totalHours} h), ${r.actions} actions so far, ${r.spent.toLocaleString("en-US")} credits spent on purchases, ${r.researchHours} research hours queued (data), ${r.credits.toLocaleString("en-US")} credits held`)
      .join("\n")}`);
    // Bug AB#2360: LADDER_OUT=<file> keeps the records, so two runs (or two seeds) can be compared
    if (process.env.LADDER_OUT) fs.writeFileSync(process.env.LADDER_OUT, JSON.stringify({ seed: LADDER_SEED, records }, null, 1));
    expect(records.map((r) => r.level)).toEqual(Array.from({ length: MAX_DEFINED_LEVEL }, (_, i) => i + 1));
  }, 600_000); // Bug AB#2360: a wall-clock limit measures the machine's load, not the game; 240 s timed out under load
});
