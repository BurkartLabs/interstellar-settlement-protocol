// npm run bench:forums (AB#995, ISP-288; docs/design/messaging.md "Load target"): with 10,000 seeded forum threads, how
// long reading the first page of the thread list, a later page, and one page of a busy thread's replies take, measured
// in-process through the real paging functions (server/forumPages.js). Built like bench:messaging (AB#910).
//
// These are BOT NUMBERS (P-PROXY). They measure the server's own time over the forums as ISP holds them today (in
// memory, from state.json), in one process on this machine. They do not measure the network, the HTTP layer, socket
// delivery to real clients, several instances, or how players actually post: a bot's threads are uniform in size and
// never read. The target is the design's p95 under 50 ms; the script exits 1 if any p95 is over.
//
// The seed is skewed on purpose, because uniform seeding flatters every list: 200 busy threads of 250 replies, 2,000
// of 20, and 7,800 with none, across the five categories, posted over 90 days.
import os from "node:os";
import { performance } from "node:perf_hooks";
import { listThreads, threadRepliesPage } from "../server/forumPages.js";

const THREADS = Number(process.env.BENCH_THREADS || 10_000);
const SHAPE = [[200, 250], [2_000, 20]]; // [threads, replies each]; the rest have none
const SAMPLES = Number(process.env.BENCH_SAMPLES || 1_000);
const TARGET_MS = 50;
const CATEGORIES = ["General", "Trade & Exchange", "Mining & Industry", "Conglomerates & Diplomacy", "Help & Guides"];

// mulberry32, as bench-messaging.mjs: a seeded random number, so two runs seed the same forums
let seed = 995;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const pick = (n) => Math.floor(rand() * n);

const seededAt = performance.now();
const NOW = Date.UTC(2026, 8, 28);
const DAY = 86_400_000;
const threads = [];
let replyTotal = 0;
for (let i = 0; i < THREADS; i++) {
  const createdAt = NOW - pick(90 * DAY);
  const replyCount = i < SHAPE[0][0] ? SHAPE[0][1] : i < SHAPE[0][0] + SHAPE[1][0] ? SHAPE[1][1] : 0;
  const replies = [];
  let at = createdAt;
  for (let r = 0; r < replyCount; r++) {
    at += 1 + pick(DAY / 4);
    replies.push({ id: `rep-${i}-${r}`, author: `Corp ${pick(THREADS)}`, authorAccountId: `acct-${pick(THREADS)}`, content: `Reply ${r} to thread ${i}.`, likedBy: [], createdAt: at });
  }
  replyTotal += replyCount;
  threads.push({ id: `thr-${i.toString().padStart(5, "0")}`, category: CATEGORIES[pick(CATEGORIES.length)], title: `Thread ${i}`, author: `Corp ${i}`, authorAccountId: `acct-${i}`, body: `Opening post of thread ${i}.`, likedBy: [], createdAt, lastPostAt: replies.length ? at : createdAt, replies });
}
const forums = { categories: CATEGORIES, threads };
const seedSeconds = ((performance.now() - seededAt) / 1000).toFixed(1);

const timings = { first: [], firstCategory: [], later: [], replies: [] };
for (let i = 0; i < SAMPLES; i++) {
  let t = performance.now();
  const first = listThreads(forums, { viewer: `acct-${pick(THREADS)}`, now: NOW });
  timings.first.push(performance.now() - t);
  if (first.threads.length !== 25) throw new Error("the first page is not 25 threads");

  t = performance.now();
  listThreads(forums, { category: CATEGORIES[i % CATEGORIES.length], viewer: `acct-${pick(THREADS)}`, now: NOW });
  timings.firstCategory.push(performance.now() - t);

  t = performance.now();
  listThreads(forums, { cursor: first.nextCursor, viewer: `acct-${pick(THREADS)}` });
  timings.later.push(performance.now() - t);

  t = performance.now();
  threadRepliesPage(forums, threads[pick(SHAPE[0][0])].id, { viewer: `acct-${pick(THREADS)}` });
  timings.replies.push(performance.now() - t);
}

const stat = (list) => {
  const s = [...list].sort((x, y) => x - y);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: at(0.5), p95: at(0.95), max: s[s.length - 1] };
};
const fmt = (n) => `${n.toFixed(2)} ms`;
console.log(`\nAB#995 forums probe: BOT NUMBERS, the server's own time over the in-memory forums, ${SAMPLES} samples each.`);
console.log(`Machine: ${os.cpus()[0]?.model ?? "unknown"}, ${os.cpus().length} cores, ${os.platform()}, Node ${process.version}. Seeded in ${seedSeconds} s.`);
console.log(`Forums: ${THREADS.toLocaleString()} threads, ${replyTotal.toLocaleString()} replies.\n`);
console.log(`operation                              median        p95          max       target p95`);
let over = false;
for (const [name, label] of [["first", "first page, all threads (25)"], ["firstCategory", "first page of a category (25)"], ["later", "a later page (25)"], ["replies", "a busy thread's replies (50)"]]) {
  const r = stat(timings[name]);
  if (r.p95 > TARGET_MS) over = true;
  console.log(`${label.padEnd(37)} ${fmt(r.median).padStart(10)} ${fmt(r.p95).padStart(11)} ${fmt(r.max).padStart(12)}   < ${TARGET_MS} ms ${r.p95 > TARGET_MS ? "OVER" : "ok"}`);
}
if (over) process.exit(1);
