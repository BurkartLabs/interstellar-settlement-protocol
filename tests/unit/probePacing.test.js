import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { targetDays, judge, lowerBoundLate } from "../../scripts/probe-pacing.mjs";

// ISP-283 (AB#990): the year-pacing probe reads its targets from the design, and judges the check-in profile by them.
const DOC = fs.readFileSync(new URL("../../docs/design/ladder-11-40.md", import.meta.url), "utf8");
const at = (level, day) => ({ level, totalHours: day * 24 });

describe("the year-pacing probe's targets and verdict (AB#990)", () => {
  it("takes Level 10's day from the design's text and 11 to 40 from its table", () => {
    const days = targetDays(DOC);
    expect(days[10]).toBe(30);
    expect(days[11]).toBe(41);
    expect(days[40]).toBe(365);
    expect(Object.keys(days).map(Number)).toEqual(Array.from({ length: 31 }, (_, i) => i + 10));
  });

  it("passes a level within 15% of its day and fails one outside it", () => {
    expect(judge([at(10, 34)], { 10: 30 }, 10)).toEqual([]);
    expect(judge([at(10, 25.5)], { 10: 30 }, 10)).toEqual([]);
    expect(judge([at(10, 35)], { 10: 30 }, 10)).toHaveLength(1);
    expect(judge([at(10, 25)], { 10: 30 }, 10)).toHaveLength(1);
  });

  it("with Levels 31 to 40 defined, fails unless Level 40 falls between day 330 and day 400", () => {
    expect(judge([at(40, 365)], {}, 40)).toEqual([]);
    expect(judge([at(40, 401)], {}, 40)[0]).toMatch(/between day 330 and day 400/);
    expect(judge([at(40, 329)], {}, 40)).toHaveLength(1);
    expect(judge([], {}, 40)[0]).toMatch(/not reached/);
    expect(judge([], {}, 10)).toEqual([]);
  });

  // Bug #2311: the hourly profile stalled at Level 4 (day 9.1) while the check-in reached Level 10 by day 31.4.
  it("fails the always-on run when it reaches a level later than the check-in, or not within its days", () => {
    const checkIn = [at(4, 11), at(5, 13.5), at(10, 31.4)];
    expect(lowerBoundLate(checkIn, [at(4, 8.7), at(5, 9.8), at(10, 24.2)], 60)).toEqual([]);
    expect(lowerBoundLate(checkIn, [at(4, 9.1)], 60)).toEqual([
      "Level 5: check-in at day 13.5, always-on not within its 60 days",
      "Level 10: check-in at day 31.4, always-on not within its 60 days"
    ]);
    expect(lowerBoundLate(checkIn, [at(4, 15.2), at(5, 12)], 20)).toEqual(["Level 4: check-in at day 11.0, always-on later, at day 15.2"]);
  });
});
