import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { targetDays, judge } from "../../scripts/probe-pacing.mjs";

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
});
