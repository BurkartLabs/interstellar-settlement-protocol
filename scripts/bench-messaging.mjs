// npm run bench:messaging (AB#910, the probe docs/design/messaging.md names): with 10,000 corporations and 1,000,000
// seeded messages, how long sending one message, reading one inbox page and reading one thread page take, measured
// in-process through the real functions on this machine. Built like AB#729's bench:ticks.
//
// These are BOT NUMBERS (P-PROXY). They measure the server's own time on the file store (data/messages/*.jsonl and
// data/inbox/*.json in a scratch data directory), cold caches first, as a restarted server would be. They do not
// measure the network, socket delivery to real clients, several instances, or how players actually write: a bot's
// messages are uniform and never read. The target is p95 under 50 ms for each operation; the script exits 1 if any
// p95 is over.
//
// The seed is skewed on purpose, because uniform seeding flatters every index: 2,000 busy pairs of 250 messages,
// 50,000 pairs of 9, and 50,000 pairs of 1 (1,000,000 messages in 102,000 conversations).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const CORPS = Number(process.env.BENCH_CORPS || 10_000);
const SHAPE = [[2_000, 250], [50_000, 9], [50_000, 1]]; // [pairs, messages each]
const SAMPLES = Number(process.env.BENCH_SAMPLES || 1_000);
const TARGET_MS = 50;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-bench-messaging-"));
process.env.ISP_DATA_DIR = dir;
const { accountsStore } = await import("../server/game/store.js");
const conv = await import("../server/game/conversations.js");

// A random number from a seed, so two runs seed the same world.
// mulberry32: 32-bit arithmetic throughout (a plain LCG in doubles loses precision and falls into a short cycle).
let seed = 910;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const pick = (n) => Math.floor(rand() * n);

const ids = Array.from({ length: CORPS }, (_, i) => `acct-${i.toString().padStart(5, "0")}`);
for (const [i, id] of ids.entries()) accountsStore.accounts[id] = { id, state: { corp: { publicId: `corp-${i}`, corporationName: `Corp ${i}` } }, messages: [] };

console.log(`Seeding ${CORPS.toLocaleString()} corporations and ${SHAPE.reduce((a, [p, m]) => a + p * m, 0).toLocaleString()} messages into ${dir} ...`);
const t0 = performance.now();
const inboxes = new Map();
const pairs = new Set();
const conversations = [];
let clock = Date.UTC(2026, 0, 1);
fs.mkdirSync(path.join(dir, "messages"), { recursive: true });
fs.mkdirSync(path.join(dir, "inbox"), { recursive: true });
for (const [count, per] of SHAPE) {
  for (let c = 0; c < count; c++) {
    let a, b, key;
    do { a = ids[pick(CORPS)]; b = ids[pick(CORPS)]; key = a < b ? `${a}|${b}` : `${b}|${a}`; } while (a === b || pairs.has(key));
    pairs.add(key);
    const conversationId = conv.conversationIdFor(a, b);
    const lines = [];
    let last = null;
    for (let m = 0; m < per; m++) {
      clock += 1 + pick(3);
      const from = m % 2 ? b : a;
      last = { id: conv.messageIdAt(clock), conversationId, from, fromName: from, body: `Bench message ${m} about ${per > 1 ? "a running trade" : "one question"}, ${"x".repeat(40 + pick(160))}`, sentAt: clock };
      lines.push(JSON.stringify(last));
    }
    fs.writeFileSync(path.join(dir, "messages", `${conversationId}.jsonl`), `${lines.join("\n")}\n`);
    for (const [me, other] of [[a, b], [b, a]]) {
      if (!inboxes.has(me)) inboxes.set(me, {});
      inboxes.get(me)[other] = { conversationId, other, createdAt: clock, lastReadAt: clock, unread: 0, count: per, archived: false, clearedBefore: 0, lastMessageAt: last.sentAt, lastMessageId: last.id, lastPreview: last.body.slice(0, 140), lastFromMe: last.from === me };
    }
    conversations.push({ conversationId, a, b, per });
  }
}
for (const [id, members] of inboxes) fs.writeFileSync(path.join(dir, "inbox", `${encodeURIComponent(id)}.json`), JSON.stringify({ conversations: members }));
const seedSeconds = ((performance.now() - t0) / 1000).toFixed(1);

const sizeOf = (d) => fs.readdirSync(d).reduce((sum, f) => sum + fs.statSync(path.join(d, f)).size, 0);
const messageBytes = sizeOf(path.join(dir, "messages"));
const inboxBytes = sizeOf(path.join(dir, "inbox"));

conv.resetConversationCache(); // cold, as after a restart
const timings = { send: [], inbox: [], thread: [] };
const busy = conversations.filter((c) => c.per === 250);
for (let i = 0; i < SAMPLES; i++) {
  // a third of the reads land on busy conversations, the rest anywhere
  const c = i % 3 === 0 ? busy[pick(busy.length)] : conversations[pick(conversations.length)];
  let t = performance.now();
  const page = conv.listConversationMessages(c.a, c.conversationId, { limit: 50 });
  timings.thread.push(performance.now() - t);
  if (page.error || !page.messages.length) throw new Error(`thread page failed: ${page.error}`);

  const reader = ids[pick(CORPS)];
  t = performance.now();
  const inbox = conv.listConversations(reader, { limit: 30 });
  timings.inbox.push(performance.now() - t);
  if (inbox.error) throw new Error(`inbox page failed: ${inbox.error}`);

  const from = ids[pick(CORPS)];
  let to = ids[pick(CORPS)];
  if (to === from) to = ids[(ids.indexOf(from) + 1) % CORPS];
  t = performance.now();
  const sent = conv.sendConversationMessage(from, { toCorpId: accountsStore.accounts[to].state.corp.publicId, body: `Probe send ${i}` });
  timings.send.push(performance.now() - t);
  if (sent.error) throw new Error(`send failed: ${sent.error}`);
}

const stat = (list) => {
  const s = [...list].sort((x, y) => x - y);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: at(0.5), p95: at(0.95), max: s[s.length - 1] };
};
const fmt = (n) => `${n.toFixed(2)} ms`;
console.log(`\nAB#910 messaging probe: BOT NUMBERS, the server's own time on the file store, cold start, ${SAMPLES} samples each.`);
console.log(`Machine: ${os.cpus()[0]?.model ?? "unknown"}, ${os.cpus().length} cores, ${os.platform()}, Node ${process.version}. Seeded in ${seedSeconds} s.`);
console.log(`Store: ${conversations.length.toLocaleString()} conversations, ${(messageBytes / 1e6).toFixed(1)} MB of messages, ${(inboxBytes / 1e6).toFixed(1)} MB of inboxes.\n`);
console.log(`operation                       median        p95          max       target p95`);
let over = false;
for (const [name, label] of [["send", "send one message"], ["inbox", "read an inbox page (30)"], ["thread", "read a thread page (50)"]]) {
  const r = stat(timings[name]);
  if (r.p95 > TARGET_MS) over = true;
  console.log(`${label.padEnd(30)} ${fmt(r.median).padStart(10)} ${fmt(r.p95).padStart(11)} ${fmt(r.max).padStart(12)}   < ${TARGET_MS} ms ${r.p95 > TARGET_MS ? "OVER" : "ok"}`);
}
fs.rmSync(dir, { recursive: true, force: true });
if (over) process.exit(1);
