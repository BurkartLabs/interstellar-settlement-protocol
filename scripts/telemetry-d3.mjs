// scripts/telemetry-d3.mjs (ISP-256, AB#952): the BRIEF's first number, day-3 return, from the stored events alone.
//
//   npm run telemetry:d3                     reads <ISP_DATA_DIR or data>/telemetry/*.jsonl
//   npm run telemetry:d3 -- <dir> [--day 1]  another data directory, or day 1 / day 7
//
// The query: a player is a distinct_id (one browser; server/telemetry.js). Its cohort is the UTC day of its first
// app_open. It returned on day N if it has an app_open on the UTC day N days after that. D3 return for a cohort is
// returned / cohort; a cohort whose day N has not ended yet is shown as pending, not as 0%. The overall rate counts
// only cohorts whose day N is over.
//
// What it cannot see: a player on two browsers is two players; cleared storage is a new player; nothing in the store
// says whether a return was prompted (the game sends no reminders today, so every return is unprompted).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAY = 86_400_000;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** Every stored row in a telemetry folder, oldest file first; an unreadable line is skipped. */
export function readRows(folder) {
  let files = [];
  try { files = fs.readdirSync(folder).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch { return []; }
  const rows = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(folder, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* a torn line */ }
    }
  }
  return rows;
}

/**
 * Day-N return by first-seen cohort: [{ cohort, players, returned, rate, pending }] oldest first, and the overall
 * { players, returned, rate } over the cohorts whose day N is over at `now`.
 */
export function dayNReturn(rows, n = 3, now = Date.now()) {
  const opens = new Map(); // distinct_id -> Set of UTC days it opened the game
  const first = new Map(); // distinct_id -> first open time
  for (const r of rows) {
    if (r?.event !== "app_open" || typeof r.distinct_id !== "string" || !Number.isFinite(r.at)) continue;
    if (!opens.has(r.distinct_id)) opens.set(r.distinct_id, new Set());
    opens.get(r.distinct_id).add(dayOf(r.at));
    if (!first.has(r.distinct_id) || r.at < first.get(r.distinct_id)) first.set(r.distinct_id, r.at);
  }
  const cohorts = new Map();
  for (const [id, at] of first) {
    const cohort = dayOf(at);
    const target = dayOf(Date.parse(`${cohort}T00:00:00Z`) + n * DAY);
    const c = cohorts.get(cohort) || { cohort, players: 0, returned: 0, pending: Date.parse(`${target}T00:00:00Z`) + DAY > now };
    c.players += 1;
    if (opens.get(id).has(target)) c.returned += 1;
    cohorts.set(cohort, c);
  }
  const list = [...cohorts.values()].sort((a, b) => a.cohort.localeCompare(b.cohort)).map((c) => ({ ...c, rate: c.players ? c.returned / c.players : 0 }));
  const done = list.filter((c) => !c.pending);
  const players = done.reduce((s, c) => s + c.players, 0);
  const returned = done.reduce((s, c) => s + c.returned, 0);
  return { n, cohorts: list, overall: { players, returned, rate: players ? returned / players : 0 } };
}

export function renderDayN({ n, cohorts, overall }) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const lines = [`D${n} return by first-seen cohort (UTC days; a player is one browser's anonymous id)`, ""];
  lines.push(`${"cohort".padEnd(12)} ${"players".padStart(8)} ${"returned".padStart(9)} ${"rate".padStart(8)}`);
  for (const c of cohorts) lines.push(`${c.cohort.padEnd(12)} ${String(c.players).padStart(8)} ${String(c.returned).padStart(9)} ${(c.pending ? "pending" : pct(c.rate)).padStart(8)}`);
  lines.push("", `Overall, cohorts whose day ${n} is over: ${overall.returned} of ${overall.players} returned (${overall.players ? pct(overall.rate) : "no cohort yet"}).`);
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dayArg = args.indexOf("--day");
  const n = dayArg >= 0 ? Math.max(1, Number(args[dayArg + 1]) || 3) : 3;
  const dirArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--day");
  const root = dirArg || process.env.ISP_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  console.log(renderDayN(dayNReturn(readRows(path.join(root, "telemetry")), n)));
}
