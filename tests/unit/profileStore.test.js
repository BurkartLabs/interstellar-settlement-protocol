import { describe, it, expect } from "vitest";
import { parseArgs, summarize, renderReport } from "../../scripts/load-test.mjs";
import { renderQueries, serverFile, summarizeProfile } from "../../scripts/profile-store.mjs";

// ISP-267 (AB#963): the store's query statistics, read off a CPU profile, and the harness's write accounting. The runs
// themselves need Docker and minutes, so they are not in the suite; these hold the arithmetic.

/** A profile: frames { id, url, line (1-based), name }, a parent map, then samples as [nodeId, microseconds]. */
function profileOf(frames, parents, samples) {
  const nodes = frames.map((f) => ({ id: f.id, callFrame: { functionName: f.name, url: f.url, lineNumber: f.line - 1, columnNumber: 0 }, children: [] }));
  for (const [child, parent] of Object.entries(parents)) nodes.find((n) => n.id === parent).children.push(Number(child));
  return { nodes, samples: samples.map(([id]) => id), timeDeltas: [0, ...samples.map(([, us]) => us)].slice(0, samples.length) };
}

describe("the store's query statistics (AB#963)", () => {
  const url = (file) => `file:///app/${file}`;
  const frames = [
    { id: 1, url: "", line: 1, name: "(root)" },
    { id: 2, url: url("server/index.js"), line: 240, name: "(anonymous)" }, // a timer
    { id: 3, url: url("server/loanServicing.js"), line: 157, name: "openLoans" }, // scans every account
    { id: 4, url: url("server/game/store.js"), line: 344, name: "getAccountById" },
    { id: 5, url: url("server/game/store.js"), line: 256, name: "sanitizeAccount" },
    { id: 6, url: url("server/ticks.js"), line: 10, name: "helper" } // neither a store function nor a scan
  ];
  const parents = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 2 };
  const source = { "server/loanServicing.js": Array.from({ length: 170 }, (_, i) => (i === 158 ? "  for (const accountId of getAllAccountIds()) {" : "")).join("\n"), "server/ticks.js": "", "server/index.js": "" };
  const read = (f) => source[f] ?? "";

  it("finds the queries (store functions and account scans), their totals, runs and callers", () => {
    // 1 ms samples: openLoans 3 ms (getAccountById inside it 2 ms), a gap, then openLoans again for 1 ms
    const samples = [[5, 1000], [5, 1000], [3, 1000], [6, 1000], [3, 1000], [6, 1000]];
    const s = summarizeProfile(profileOf(frames, parents, samples), { readSource: read });
    const byName = Object.fromEntries(s.queries.map((q) => [q.name, q]));
    expect(Object.keys(byName).sort()).toEqual(["getAccountById", "openLoans", "sanitizeAccount"]); // helper is not a query
    expect(byName.openLoans).toMatchObject({ totalMs: 4, runs: 2, maxMs: 3 });
    expect(byName.getAccountById).toMatchObject({ totalMs: 2, runs: 1 });
    expect(byName.getAccountById.callers[0].caller).toBe("openLoans (server/loanServicing.js:157)");
    expect(byName.sanitizeAccount.callers[0].caller).toBe("getAccountById (server/game/store.js:344)");
    expect(byName.openLoans.callers[0].caller).toBe("(anonymous) (server/index.js:240)");
    expect(s.queries[0].name).toBe("openLoans"); // sorted by total time
    expect(renderQueries(s)).toMatch(/\| 1 \| `openLoans` \(server\/loanServicing\.js:157\) \| 4 ms \|/);
  });

  it("reads a server file from a container, a Windows or a plain path, and nothing else", () => {
    expect(serverFile("file:///app/server/game/store.js")).toBe("server/game/store.js");
    expect(serverFile("file:///T:/x/isp/server/ticks.js")).toBe("server/ticks.js");
    expect(serverFile("node:internal/timers")).toBeNull();
    expect(serverFile("file:///app/node_modules/express/lib/router.js")).toBeNull();
  });
});

describe("the harness's write accounting and flags (AB#963)", () => {
  it("takes --profile and --data tmpfs", () => {
    expect(parseArgs([])).toMatchObject({ profile: false, data: "bind" });
    expect(parseArgs(["--profile", "--data", "tmpfs"])).toMatchObject({ profile: true, data: "tmpfs" });
    expect(parseArgs(["--data", "anything"])).toMatchObject({ data: "bind" });
  });

  it("totals the probe's writes by file, and per HTTP request", () => {
    const probeLines = [
      { timers: {}, eventLoopDelay: { p50: 1, p99: 2, max: 3 }, memory: { rss: 1, heapUsed: 1 }, writes: { "accounts-snapshot.json": { count: 2, bytes: 4 * 1024 * 1024, ms: 10 } } },
      { timers: {}, eventLoopDelay: { p50: 1, p99: 2, max: 3 }, memory: { rss: 1, heapUsed: 1 }, writes: { "accounts-snapshot.json": { count: 1, bytes: 2 * 1024 * 1024, ms: 5 }, "state.json": { count: 1, bytes: 1024, ms: 1 } } }
    ];
    const s = summarize({ probeLines, clientWindows: [{ events: 1, bytes: 1, byEvent: {}, seconds: 5, connected: 1 }], httpTimes: [{ ms: 1, ok: true }, { ms: 1, ok: true }], dockerSamples: [], memoryLimitBytes: 0, durationSec: 60 });
    expect(s.writes[0]).toMatchObject({ file: "accounts-snapshot.json", count: 3, bytes: 6 * 1024 * 1024, ms: 15 });
    expect(s.writtenBytes).toBe(6 * 1024 * 1024 + 1024);
    expect(s.writtenBytesPerRequest).toBe((6 * 1024 * 1024 + 1024) / 2);
    const report = renderReport(s, { corps: 1, minutes: 1, cpus: "0.5", memory: "1g", data: "tmpfs" }, "");
    expect(report).toContain("/data in memory (tmpfs)");
    expect(report).toMatch(/Files written: 6 MB in the run, 3,073 KiB per HTTP request\./);
    expect(report).toMatch(/accounts-snapshot\.json: 3 writes, 6 MB/);
  });
});
