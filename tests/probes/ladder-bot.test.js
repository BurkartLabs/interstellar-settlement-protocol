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

afterAll(() => vi.useRealTimers());

describe("the ladder bot (AB#799)", () => {
  it(`climbs Levels 1 to ${MAX_DEFINED_LEVEL} through the server's own routes, and reports each level`, async () => {
    // The clock the server reads, moved only by the bot, set before the corporation exists: whatever registration
    // stamps (the contract board's next refresh) is on this clock too. Only Date is faked: timers stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 0, 1, 9, 0, 0));
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
      maxDays: Number(process.env.LADDER_DAYS || 240) // AB#800: Level 20 is about half a year in
    });

    console.log(`[ladder bot, AB#799] BOT NUMBERS on development timings, not player time:\n${records
      .map((r) => `  Level ${r.level}: ${r.hours} h (at ${r.totalHours} h), ${r.actions} actions so far, ${r.spent.toLocaleString("en-US")} credits spent on purchases, ${r.researchHours} research hours queued (data), ${r.credits.toLocaleString("en-US")} credits held`)
      .join("\n")}`);
    expect(records.map((r) => r.level)).toEqual(Array.from({ length: MAX_DEFINED_LEVEL }, (_, i) => i + 1));
  }, 240_000);
});
