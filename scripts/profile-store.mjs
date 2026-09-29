// scripts/profile-store.mjs (AB#963, ISP-267): the store's "query statistics", from a V8 CPU profile of the server under
// load. The store is the accounts snapshot and the world state in memory, written to JSON files; it has no query
// log of its own, so this reads one off the profile instead:
//
// - a "query" is a store function (server/game/store.js, server/gameState.js) or any function that walks every
//   account (a line reading accountsStore.accounts or getAllAccountIds()), found from the source;
// - its total is the time any sample had it on the stack (inclusive: what it calls is its cost), so nested queries
//   overlap in the totals;
// - a "run" is an unbroken stretch of samples with it on the stack. At the profile's 1 ms interval a slow call is
//   measured well; short back-to-back calls merge into one run, so p95 per run is an upper bound for fast queries;
// - its callers are the nearest other server frames (a route handler, a ticker, another query), each with its share.
//
//   node scripts/profile-store.mjs <file.cpuprofile> [--top 10]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE_FILES = new Set(["server/game/store.js", "server/gameState.js"]);
const SCAN = /accountsStore\.accounts\b|getAllAccountIds\(\)/;

/** "server/game/store.js" from a profile URL (file:///app/server/…, a Windows path, …), or null outside server/. */
export function serverFile(url) {
  const m = String(url || "").replace(/\\/g, "/").match(/(?:^|\/)(server\/[^?#]+\.m?js)$/);
  return m ? m[1] : null;
}

/** The value at percentile p, or 0. */
const pct = (values, p) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

/**
 * Summarise a profile. `readSource(file)` returns a server file's text (tests pass their own). Returns
 * { durationMs, queries: [{ key, name, file, line, totalMs, share, runs, p50Ms, p95Ms, maxMs, callers: [{ caller, ms }] }] }
 * sorted by total time.
 */
export function summarizeProfile(profile, { readSource = (f) => fs.readFileSync(path.join(ROOT, f), "utf8"), top = 10 } = {}) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);

  // each frame's key and file; which frames are queries
  const frame = new Map(); // node id -> { key, name, file, line }
  const byFile = new Map(); // file -> sorted distinct 1-based start lines of its frames
  for (const n of profile.nodes) {
    const file = serverFile(n.callFrame.url);
    if (!file) continue;
    const line = (n.callFrame.lineNumber ?? 0) + 1;
    const name = n.callFrame.functionName || "(anonymous)";
    frame.set(n.id, { key: `${file}:${line}:${name}`, name, file, line });
    if (!byFile.has(file)) byFile.set(file, new Set());
    byFile.get(file).add(line);
  }
  const queryStarts = new Set(); // `${file}:${line}` of every query function
  const sources = new Map();
  for (const [file, starts] of byFile) {
    const lines = [...starts].sort((a, b) => a - b);
    if (STORE_FILES.has(file)) { for (const l of lines) queryStarts.add(`${file}:${l}`); continue; }
    let text;
    try { text = sources.get(file) ?? readSource(file); sources.set(file, text); } catch { continue; }
    text.split(/\r?\n/).forEach((src, i) => {
      if (!SCAN.test(src) || /^\s*(\/\/|\*)/.test(src)) return;
      const enclosing = lines.filter((l) => l <= i + 1).at(-1); // the nearest function that starts at or above it
      if (enclosing) queryStarts.add(`${file}:${enclosing}`);
    });
  }
  const isQuery = (id) => { const f = frame.get(id); return Boolean(f && queryStarts.has(`${f.file}:${f.line}`)); };

  // walk the samples
  const stats = new Map(); // key -> { f, totalUs, runs: [], open, callers: Map }
  const deltas = profile.timeDeltas || [];
  let prevOnStack = new Set();
  let totalUs = 0;
  profile.samples.forEach((id, i) => {
    const dt = Math.max(0, deltas[i + 1] ?? deltas[i] ?? 0); // a sample's time is the gap to the next one
    totalUs += dt;
    const onStack = new Set();
    let nearestOutside = null; // walking up: the first non-query server frame above the innermost query
    const chain = [];
    for (let n = id; n !== undefined; n = parent.get(n)) chain.push(n);
    for (let k = 0; k < chain.length; k++) {
      const n = chain[k];
      if (!isQuery(n)) continue;
      const f = frame.get(n);
      if (onStack.has(f.key)) continue;
      onStack.add(f.key);
      let caller = "(a timer or the event loop)";
      for (let j = k + 1; j < chain.length; j++) {
        const up = frame.get(chain[j]);
        if (up && up.key !== f.key) { caller = `${up.name} (${up.file}:${up.line})`; break; }
      }
      const s = stats.get(f.key) || { f, totalUs: 0, runs: [], open: 0, callers: new Map() };
      s.totalUs += dt;
      s.open += dt;
      s.callers.set(caller, (s.callers.get(caller) || 0) + dt);
      stats.set(f.key, s);
      nearestOutside = nearestOutside ?? caller;
    }
    for (const key of prevOnStack) if (!onStack.has(key)) { const s = stats.get(key); s.runs.push(s.open); s.open = 0; }
    prevOnStack = onStack;
  });
  for (const key of prevOnStack) { const s = stats.get(key); s.runs.push(s.open); s.open = 0; }

  const ms = (us) => Math.round(us / 10) / 100;
  const queries = [...stats.values()].map((s) => ({
    key: s.f.key, name: s.f.name, file: s.f.file, line: s.f.line,
    totalMs: ms(s.totalUs), share: totalUs ? s.totalUs / totalUs : 0,
    runs: s.runs.length, p50Ms: ms(pct(s.runs, 50)), p95Ms: ms(pct(s.runs, 95)), maxMs: ms(Math.max(0, ...s.runs)),
    callers: [...s.callers].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([caller, us]) => ({ caller, ms: ms(us) }))
  })).sort((a, b) => b.totalMs - a.totalMs);
  return { durationMs: ms(totalUs), queries: top ? queries.slice(0, top) : queries, all: queries.length };
}

/** The table the report and the pull request show. */
export function renderQueries(summary) {
  const out = [`Store queries by total time, from the CPU profile (${Math.round(summary.durationMs / 1000)} s sampled, ${summary.all} query functions seen):`, ""];
  out.push("| # | query | total | share | runs | p50 / p95 per run | top caller |", "|---|---|---|---|---|---|---|");
  summary.queries.forEach((q, i) => {
    const c = q.callers[0];
    out.push(`| ${i + 1} | \`${q.name}\` (${q.file}:${q.line}) | ${q.totalMs.toLocaleString("en-US")} ms | ${(q.share * 100).toFixed(1)}% | ${q.runs} | ${q.p50Ms} / ${q.p95Ms} ms | ${c ? `${c.caller}, ${Math.round((c.ms / q.totalMs) * 100)}%` : ""} |`);
  });
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const top = Number(process.argv[process.argv.indexOf("--top") + 1]) || 10;
  if (!file) throw new Error("usage: node scripts/profile-store.mjs <file.cpuprofile> [--top 10]");
  console.log(renderQueries(summarizeProfile(JSON.parse(fs.readFileSync(file, "utf8")), { top })));
}
