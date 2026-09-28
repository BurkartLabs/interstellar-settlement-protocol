import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { insightRemaining, researchRemaining, totalText } from "../../public/scripts/researchTotals.js";

// AB#2475 (Board review item 22): the time to finish every research item still outstanding. Each track runs one item at
// a time, so it is the sum of what is left: the running item's remainder and every other item's full duration.
const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 1, 12, 0);
const NODES = [{ id: "a", durationHours: 2 }, { id: "b", durationHours: 10, prereqs: ["a"] }, { id: "c", durationHours: 30, prereqs: ["b"] }, { id: "d", durationHours: 6 }];

describe("Corporate R&D's total (AB#2475)", () => {
  it("sums every node not yet researched, in series, whatever the prerequisite chain", () => {
    expect(researchRemaining({ nodes: NODES, done: [] }, NOW)).toEqual({ ms: 48 * H, items: 4 });
    expect(researchRemaining({ nodes: NODES, done: ["a"] }, NOW)).toEqual({ ms: 46 * H, items: 3 });
  });

  it("counts the running item's remaining time and a queued one's whole duration, so it falls as time passes and items complete", () => {
    const queue = [{ techId: "b", durationHours: 10, startedAt: NOW - 4 * H }, { techId: "c", durationHours: 30, startedAt: NOW + 6 * H }];
    expect(researchRemaining({ nodes: NODES, done: ["a"], queue }, NOW)).toEqual({ ms: (6 + 30 + 6) * H, items: 3 });
    expect(researchRemaining({ nodes: NODES, done: ["a"], queue }, NOW + H).ms).toBe((5 + 30 + 6) * H);
    expect(researchRemaining({ nodes: NODES, done: ["a", "b"], queue: queue.slice(1) }, NOW + 6 * H)).toEqual({ ms: 36 * H, items: 2 });
    expect(researchRemaining({ nodes: NODES, done: ["a", "b", "c", "d"] }, NOW)).toEqual({ ms: 0, items: 0 });
  });

  it("matches the real tree: 30 nodes, 472 hours, for a corporation that has researched nothing", () => {
    const tree = JSON.parse(fs.readFileSync(new URL("../../data/research.json", import.meta.url), "utf8")).nodes;
    expect(researchRemaining({ nodes: tree, done: [] }, NOW)).toEqual({ ms: 472 * H, items: 30 });
  });
});

describe("CEO Insight's total (AB#2475)", () => {
  const PROGRAMS = [{ id: "neg", durationHours: 4, maxLevels: 3 }, { id: "lead", durationHours: 8 }, { id: "plan", durationHours: 99, status: "planned" }];
  const isLive = (p) => p.status !== "planned";

  it("counts every level still to run, the running level's remainder, and leaves out a program that cannot run yet", () => {
    expect(insightRemaining({ programs: PROGRAMS, isLive }, NOW)).toEqual({ ms: (12 + 8) * H, items: 4 });
    expect(insightRemaining({ programs: PROGRAMS, completed: ["neg"], queue: [{ programId: "neg", durationHours: 4, startedAt: NOW - H }], isLive }, NOW)).toEqual({ ms: (3 + 4 + 8) * H, items: 3 });
    expect(insightRemaining({ programs: PROGRAMS, completed: ["neg", "neg", "neg", "lead"], isLive }, NOW)).toEqual({ ms: 0, items: 0 });
  });
});

describe("the figure as written (AB#2475)", () => {
  it("reads in days and hours, or hours and minutes, and says when nothing is left", () => {
    expect(totalText({ ms: 472 * H, items: 30 }, "technology", "technologies")).toBe("19 d 16 h (472 h) to finish all 30 remaining technologies, one at a time.");
    expect(totalText({ ms: 7.5 * H, items: 1 }, "technology", "technologies")).toBe("7 h 30 min to finish the 1 remaining technology, one at a time.");
    expect(totalText({ ms: 0, items: 0 }, "technology", "technologies")).toBe("nothing left: every technology is done.");
  });
});
