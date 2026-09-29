import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { concessionCurve, formatReport, lobbyingCurve, patentCurve, runWarfareWorld, targets } from "./warfareProbe.js";

// ISP-271 (AB#967): the warfare economy together. The ordinary suite plays the world for 30 days (the target's day) and
// the lever sweeps whole, which proves the harness runs, factions act and concessions are granted (P-GREEN-AND-EMPTY).
// WARFARE_PROBE=1 (npm run probe:warfare) plays 60 days, to see where the holdings settle after the first terms.
// Targets are printed, never asserted: AB#967 files a balance bug on a miss. BOT NUMBERS (P-PROXY).
// WARFARE_OUT=<dir> also writes the report and the raw numbers there.
const FULL = process.env.WARFARE_PROBE === "1";
const START = Date.UTC(2026, 4, 4, 0, 0, 0);
let app;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  ({ app } = await getApp());
});
afterAll(() => vi.useRealTimers());

describe("the warfare economy together (AB#967)", () => {
  it(FULL ? "plays the faction world for 60 days and sweeps the levers" : "plays the faction world for 30 days and sweeps the levers", async () => {
    const register = async () => ({ id: (await registerAccount(app)).account.id });
    const setTime = (t) => vi.setSystemTime(t);
    const world = await runWarfareWorld({ register, setTime, start: START, days: FULL ? 60 : 30 });
    const rich = await runWarfareWorld({ register, setTime, start: START + 200 * 86_400_000, days: FULL ? 60 : 30, tradeScale: 10 });
    const concession = concessionCurve();
    const richCurve = concessionCurve(8, "alpha-centauri", 10);
    const later = START + 400 * 86_400_000;
    const patents = await patentCurve({ register, setTime, t: later });
    const lobbying = await lobbyingCurve({ register, setTime, t: later + 10 * 86_400_000 });
    const report = formatReport({ world, concession, patents, lobbying, rich, richCurve });
    console.log(`\n${report}\n`);

    expect(world.days).toHaveLength(FULL ? 60 : 30);
    expect(world.factions.some((f) => f.heldDays > 0)).toBe(true); // concessions were granted: never a green run of nothing
    expect(patents.rows.length).toBeGreaterThan(0);
    expect(targets({ world, concession, patents, lobbying })).toHaveLength(5);

    if (process.env.WARFARE_OUT) {
      const dir = path.resolve(process.env.WARFARE_OUT);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "warfare-report.txt"), `${report}\n`);
      fs.writeFileSync(path.join(dir, "warfare-raw.json"), `${JSON.stringify({ world, rich, concession, richCurve, patents, lobbying }, null, 1)}\n`);
    }
  }, FULL ? 1_800_000 : 600_000);
});
