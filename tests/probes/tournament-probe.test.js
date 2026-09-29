import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { MODIFIER_SETS, BUDGETS, INVESTMENT_RUNGS, formatReport, ladderSvg, raidLadder, splits, targets, tournament } from "./tournamentProbe.js";
import { UNIT_IDS } from "../../server/game/units.js";

// ISP-270 (AB#966): the fleet composition tournament and the raid ladder, through the real resolver: no server, no clock.
// Targets are printed, never asserted: misses are reported and filed as balance bugs (AB#877's rule). What is asserted is
// that the harness fought every condition it says it did (P-GREEN-AND-EMPTY). BOT NUMBERS (P-PROXY).
// The ordinary suite fights one budget with two modifier sets (seconds); TOURNAMENT_PROBE=1 (npm run probe:tournament)
// fights all three budgets and all four sets (about a minute). TOURNAMENT_OUT=<dir> also writes the report, the raw
// numbers and the raid ladder's chart there.
const FULL = process.env.TOURNAMENT_PROBE === "1";
const budgets = FULL ? BUDGETS : [BUDGETS[1]];
const modifierSets = FULL ? MODIFIER_SETS : { neutral: MODIFIER_SETS.neutral, tired: MODIFIER_SETS.tired };

describe("the fleet composition tournament (AB#966)", () => {
  it(FULL ? "fights the whole grid at every budget and modifier pair, and every raid rung" : "fights the grid at one budget, and every raid rung", () => {
    const result = tournament({ budgets, modifierSets });
    const ladder = raidLadder({ budgets, modifierSets });
    const report = formatReport({ result, ladder });
    console.log(`\n${report}\n`);

    const grid = splits(UNIT_IDS).length;
    const sets = Object.keys(modifierSets).length;
    expect(grid).toBe(70); // 4 quarters over 5 units
    expect(result.fights).toBe(budgets.length * grid * (grid - 1) * sets * sets);
    expect(ladder.lines).toHaveLength(budgets.length);
    for (const l of ladder.lines) expect(l.points.map((p) => p.rung)).toEqual(INVESTMENT_RUNGS);
    expect(ladder.lines.every((l) => l.points[0].success === 1)).toBe(true); // an undefended station always falls
    expect(targets({ result, ladder })).toHaveLength(4);

    if (process.env.TOURNAMENT_OUT) {
      const dir = path.resolve(process.env.TOURNAMENT_OUT);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "tournament-report.txt"), `${report}\n`);
      fs.writeFileSync(path.join(dir, "raid-ladder.svg"), `${ladderSvg(ladder)}\n`);
      fs.writeFileSync(path.join(dir, "tournament-raw.json"), `${JSON.stringify({ result, ladder }, null, 1)}\n`);
    }
  }, 180_000);
});
