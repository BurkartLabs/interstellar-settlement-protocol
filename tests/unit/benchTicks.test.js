import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TICKERS, BUDGET, renderReport } from "../../scripts/bench-ticks.mjs";

// AB#729: the benchmark times the tickers the server really registers, at the intervals it registers them.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const index = fs.readFileSync(path.join(ROOT, "server/index.js"), "utf8");

const toMs = (expr) => {
  const constant = index.match(new RegExp(`const ${expr} = ([\\d_]+);`));
  return Number((constant ? constant[1] : expr).replace(/_/g, ""));
};

describe("bench:ticks (AB#729)", () => {
  it("covers every setInterval in server/index.js, at the interval the server uses", () => {
    const registered = [...index.matchAll(/setInterval\((\w+), ([\w_]+)\)/g)].map((m) => ({ name: m[1], intervalMs: toMs(m[2]) }));
    expect(registered.length).toBeGreaterThan(0);
    expect([...registered].sort((a, b) => a.name.localeCompare(b.name))).toEqual([...TICKERS].sort((a, b) => a.name.localeCompare(b.name)));
  });

  it("every ticker it times is exported by server/index.js", () => {
    const exported = index.match(/export \{\s*([\s\S]*?)\};/g).join(" ");
    for (const { name } of TICKERS) expect(exported, name).toContain(name);
  });

  const machine = { cpu: "Test CPU", cores: 4, ramGb: 8, platform: "Test", node: "0" };
  const result = (n, perTicker, writeMs) => ({
    n, writeMs, accountsBytes: 1024 * 1024, stateBytes: 1024,
    tickers: Object.fromEntries(TICKERS.map(({ name }) => [name, { medianMs: perTicker(name), maxMs: perTicker(name) }]))
  });

  it("reports everything within budget when it is", () => {
    const text = renderReport([result(10, () => 1, 5), result(1000, () => 100, 300)], machine);
    expect(text).toContain("Everything is within budget.");
    expect(text).toContain("N = 1,000");
    expect(text).toContain("Machine: Test CPU (4 logical cores)");
  });

  it("names each ticker over half its interval, and a write over a second", () => {
    const text = renderReport([result(1000, (name) => (name === "miningTick" ? 2_600 : 10), 1_200)], machine);
    expect(text).toContain("OVER  miningTick: 2,600 ms against 2,500 ms");
    expect(text).toContain("OVER  state write: 1,200 ms against 1000 ms");
    expect(text).not.toContain("OVER  refineryTick");
    expect(BUDGET).toEqual({ tickerShareOfInterval: 0.5, writeMs: 1000 });
  });

  it("npm run bench:ticks is the script", () => {
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts["bench:ticks"]).toBe("node scripts/bench-ticks.mjs");
  });
});
