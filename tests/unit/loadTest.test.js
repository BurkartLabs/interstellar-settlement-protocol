import { describe, it, expect } from "vitest";
import { parseArgs, percentile, labelFor, summarize, renderReport } from "../../scripts/load-test.mjs";

// AB#962: the load harness's arithmetic and its report. The run itself needs Docker and minutes, so it is not in the suite.
describe("load:test (AB#962)", () => {
  it("defaults to 200 corporations for 10 minutes at production's size", () => {
    expect(parseArgs([])).toMatchObject({ corps: 200, minutes: 10, cpus: "0.5", memory: "1g" });
    expect(parseArgs(["--corps", "500", "--minutes", "2", "--cpus", "1", "--json", "x.json"])).toMatchObject({ corps: 500, minutes: 2, cpus: "1", json: "x.json" });
  });

  it("takes a percentile by rank", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 95)).toBe(0);
  });

  it("names a timer by the tickers its line calls, else by the function around it", () => {
    const src = {
      "server/index.js": "a\nif (x) setInterval(() => { const now = Date.now(); loanServicingTick(now); defaultRecoveryTick(now); }, 60_000);\nsetInterval(miningTick, 5000);",
      "server/game/store.js": "export function writeAccountsSnapshotToDisk() {\n  if (t) return;\n  t = setTimeout(() => {"
    };
    const read = (file) => src[file];
    expect(labelFor("server/index.js:2", read)).toBe("loanServicingTick + defaultRecoveryTick");
    expect(labelFor("server/index.js:3", read)).toBe("miningTick");
    expect(labelFor("server/game/store.js:3", read)).toBe("writeAccountsSnapshotToDisk (server/game/store.js:3)");
    expect(labelFor("server/missing.js:1", () => { throw new Error("no"); })).toBe("server/missing.js:1");
  });

  it("summarizes the probe's windows and flags what is over budget", () => {
    const probeLines = [
      { timers: { "server/index.js:1": { kind: "interval", everyMs: 5000, times: [10, 3000] } }, eventLoopDelay: { p50: 2, p99: 20, max: 30 }, memory: { rss: 100e6, heapUsed: 50e6 } },
      { timers: { "server/index.js:1": { kind: "interval", everyMs: 5000, times: [3500] } }, eventLoopDelay: { p50: 2, p99: 400, max: 900 }, memory: { rss: 900e6, heapUsed: 60e6 } }
    ];
    const clientWindows = [{ events: 100, bytes: 1000, byEvent: { "chat:new": 100 }, seconds: 5, connected: 3 }, { events: 50, bytes: 500, byEvent: { "chat:new": 50 }, seconds: 5, connected: 2 }];
    const s = summarize({ probeLines, clientWindows, httpTimes: [{ ms: 10, ok: true }, { ms: 900, ok: false }], dockerSamples: [{ cpuPercent: 40, memBytes: 200e6 }], memoryLimitBytes: 1e9, durationSec: 10, label: () => "miningTick" });
    expect(s.tickers[0]).toMatchObject({ name: "miningTick", runs: 3, p95: 3500, max: 3500 });
    expect(s.tickers[0].busyShare).toBeCloseTo(0.651, 3);
    expect(s.eventLoop).toMatchObject({ worstP99: 400, windowsOverBudget: 1, windows: 2 });
    expect(s.fanOut.meanPerSecond).toBe(15);
    expect(s.fanOut.byEvent["chat:new"]).toBe(15);
    expect(s.http).toMatchObject({ requests: 2, errors: 1 });
    const report = renderReport(s, { corps: 3, minutes: 1, cpus: "0.5", memory: "1g" }, "Host: test.");
    expect(report).toMatch(/OVER {2}miningTick: p95 3,500 ms/);
    expect(report).toMatch(/OVER {2}event-loop delay/);
    expect(report).toMatch(/OVER {2}memory/);
    expect(report).toMatch(/OVER {2}HTTP errors: 1/);
    expect(report).toMatch(/OVER {2}sockets: as few as 2 of 3/);
  });

  it("says everything is within budget when it is", () => {
    const s = summarize({ probeLines: [{ timers: {}, eventLoopDelay: { p50: 2, p99: 5, max: 9 }, memory: { rss: 1e8, heapUsed: 1e7 } }], clientWindows: [{ events: 1, bytes: 1, byEvent: {}, seconds: 5, connected: 1 }], httpTimes: [{ ms: 5, ok: true }], dockerSamples: [], memoryLimitBytes: 1e9, durationSec: 5 });
    expect(renderReport(s, { corps: 1, minutes: 1, cpus: "0.5", memory: "1g" }, "")).toMatch(/Everything is within budget\./);
  });
});
