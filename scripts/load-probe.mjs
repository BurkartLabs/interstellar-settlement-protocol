// scripts/load-probe.mjs (AB#962): loaded into the server with NODE_OPTIONS="--import <this file>" by
// scripts/load-test.mjs, never by the server itself. It measures from inside the process, without changing server code:
//
// - every setInterval and setTimeout the server's own code registers (a call site under server/, not node_modules) is
//   wrapped, and each run's synchronous time is recorded against that call site. The synchronous part is what holds
//   the event loop; an async ticker's awaited work is not in it.
// - the event loop's delay (perf_hooks.monitorEventLoopDelay at 2 ms resolution, so about 2 ms is its floor), and process memory.
//
// Every ISP_LOAD_METRICS_INTERVAL_MS (5 s) it appends one JSON line to ISP_LOAD_METRICS and starts a new window.
import fs from "node:fs";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const OUT = process.env.ISP_LOAD_METRICS;
if (OUT) {
  const windowMs = Number(process.env.ISP_LOAD_METRICS_INTERVAL_MS) || 5_000;
  const runs = new Map(); // call site -> { kind, everyMs, times: [] }
  const realSetInterval = globalThis.setInterval;
  const realSetTimeout = globalThis.setTimeout;

  /** "server/index.js:227" for the server's own code, or null for a library's timer. */
  function callSite() {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 4;
    const stack = new Error().stack || "";
    Error.stackTraceLimit = limit;
    const frame = stack.split("\n").slice(2).find((l) => !l.includes("load-probe.mjs"));
    if (!frame || frame.includes("node_modules") || frame.includes("node:")) return null;
    const m = frame.match(/[/\\](server[/\\][^:()]+):(\d+):\d+/);
    return m ? `${m[1].replace(/\\/g, "/")}:${m[2]}` : null;
  }

  function wrap(real, kind) {
    return function (fn, ms, ...args) {
      const site = typeof fn === "function" ? callSite() : null;
      if (!site) return real.call(this, fn, ms, ...args);
      return real.call(this, function (...a) {
        const start = performance.now();
        try { return fn.apply(this, a); } finally {
          let r = runs.get(site);
          if (!r) { r = { kind, everyMs: Number(ms) || 0, times: [] }; runs.set(site, r); }
          r.times.push(performance.now() - start);
        }
      }, ms, ...args);
    };
  }
  globalThis.setInterval = wrap(realSetInterval, "interval");
  globalThis.setTimeout = wrap(realSetTimeout, "timeout");

  // AB#963 (ISP-267): every synchronous file write the server makes, by file: how many, how many bytes, and how long the
  // write itself held the event loop (the JSON.stringify before it is in the calling timer's time, not here). The store
  // writes through fs.writeFileSync on the default fs object, then renames the ".tmp" into place.
  const writes = new Map(); // file -> { count, bytes, ms }
  const fileKey = (p) => String(p).replace(/\\/g, "/").replace(/\.tmp$/, "").replace(/^.*\/data\//, "").replace(/^statements\/.*$/, "statements/*.json");
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (file, data, ...rest) {
    const start = performance.now();
    try { return realWriteFileSync.call(this, file, data, ...rest); } finally {
      if (typeof file === "string" && file !== OUT) {
        const key = fileKey(file);
        const w = writes.get(key) || { count: 0, bytes: 0, ms: 0 };
        w.count += 1;
        w.bytes += typeof data === "string" ? Buffer.byteLength(data) : (data?.byteLength || 0);
        w.ms += performance.now() - start;
        writes.set(key, w);
      }
    }
  };

  const eld = monitorEventLoopDelay({ resolution: 2 });
  eld.enable();
  const ms = (ns) => Math.round((ns / 1e6) * 100) / 100;
  const flush = () => {
    const timers = {};
    for (const [site, r] of runs) if (r.times.length) { timers[site] = { kind: r.kind, everyMs: r.everyMs, times: r.times.map((t) => Math.round(t * 100) / 100) }; r.times = []; }
    const mem = process.memoryUsage();
    const line = {
      at: Date.now(),
      timers,
      eventLoopDelay: { p50: ms(eld.percentile(50)), p95: ms(eld.percentile(95)), p99: ms(eld.percentile(99)), max: ms(eld.max) },
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external },
      writes: Object.fromEntries([...writes].map(([k, w]) => [k, { count: w.count, bytes: w.bytes, ms: Math.round(w.ms * 100) / 100 }]))
    };
    writes.clear();
    eld.reset();
    try { fs.appendFileSync(OUT, JSON.stringify(line) + "\n"); } catch { /* measuring never breaks the server */ }
  };
  realSetInterval(flush, windowMs).unref();
}
