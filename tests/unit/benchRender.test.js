import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGET, percentile, renderReport, selfTimes } from "../../scripts/bench-render.mjs";

// AB#730: the render benchmark's arithmetic, and the measure it reads.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("bench-render (AB#730)", () => {
  it("every full re-render records the measure the benchmark reads", () => {
    const app = fs.readFileSync(path.join(ROOT, "public/scripts/app.js"), "utf8");
    expect(app).toMatch(/function updateAllViews\(\) \{\s+const start = performance\.now\(\);\s+renderAllViews\(\);\s+performance\.measure\("isp:updateAllViews", \{ start \}\);\s+\}/);
  });

  it("percentiles: nearest rank", () => {
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(10);
    expect(percentile(sorted, 95)).toBe(19);
    expect(percentile([7], 95)).toBe(7);
  });

  const base = { firstPaint: 400, firstContentfulPaint: 400, firstRender: 1200, tti: 1300, renders: [10, 12], median: 10, p95: 12, max: 12, idleBusyShare: 0.05, errors: [] };
  const machine = { cpu: "Test CPU", cores: 4, platform: "Test", node: "0", browser: "test" };

  it("says within when the median and p95 are both under budget, and over otherwise", () => {
    expect(renderReport(base, machine)).toContain(": within (median within, p95 within)");
    const over = renderReport({ ...base, median: 153, p95: 192 }, machine);
    expect(over).toContain(": OVER (median over, p95 over)");
    expect(BUDGET).toEqual({ medianMs: 16, p95Ms: 50 });
  });

  it("lists the parts of a re-render, slowest first, when a build measures them", () => {
    const text = renderReport({ ...base, parts: { renderMarket: [70, 74, 80], renderAssets: [4, 3, 5] } }, machine);
    expect(text.indexOf("renderMarket")).toBeLessThan(text.indexOf("renderAssets"));
    expect(text).toContain("74.0  renderMarket");
  });

  it("adds up self time per function from a CPU profile", () => {
    const profile = {
      nodes: [{ id: 1, callFrame: { functionName: "draw", url: "http://x/scripts/starfield.js", lineNumber: 46 } }, { id: 2, callFrame: { functionName: "", url: "", lineNumber: -1 } }],
      samples: [1, 1, 2, 1],
      timeDeltas: [1000, 1000, 2000, 1000]
    };
    expect(selfTimes(profile)).toEqual([
      { fn: "draw", where: "starfield.js:47", ms: 3, share: 0.6 },
      { fn: "(anonymous)", where: ":0", ms: 2, share: 0.4 }
    ]);
  });
});
