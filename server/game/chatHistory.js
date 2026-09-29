// AB#995 (ISP-288, docs/design/messaging.md "Chat history and forums on the same model" and "If v0.12 comes before
// Postgres"): chat history kept on disk, only the design's window in memory.
//
//   data/chat/<channel>.jsonl   each line appended once, never rewritten
//
// state.chatLog keeps the last CHAT_WINDOW lines of each channel, which state:init sends; older lines are read from
// the channel's file a page at a time (GET /api/chat/:channel/history). A chat line carries no account id, only the
// author's public name, so nothing here identifies an account. Retention (the design's 30 days) is not built yet: the
// files only grow, by at most 10 lines per 10 seconds per account (rateLimiters.js chat-line).
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./catalog.js";

export const CHAT_WINDOW = 50; // lines per channel kept in memory and sent in state:init
export const CHAT_PAGE = 50; // lines per history page
const PAGE_MAX = 100; // as conversations.js: a client may ask for fewer or more, never more than this

function pageSize(requested, fallback) {
  const n = Number.parseInt(requested, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, PAGE_MAX) : fallback;
}

const chatDir = () => path.join(dataDir, "chat");
/** One file per channel; "local:tau-ceti" is written local_tau-ceti. */
const channelFile = (channel) => path.join(chatDir(), `${String(channel).replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`);

const fileIo = {
  read(file) { try { return fs.readFileSync(file, "utf8"); } catch (e) { if (e?.code === "ENOENT") return null; throw e; } },
  append(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, text, "utf8"); }
};
let io = fileIo;
/** Tests only: swap the file layer (to make the store unavailable), or pass nothing to restore it. */
export function setChatIo(next) { io = next || fileIo; }
/** Tests and the probe: forget what is cached, so the next read comes from the files. */
export function resetChatCache() { channels.clear(); }

const channels = new Map(); // channel -> { lines: [], at: Map(id -> index) }

/**
 * The channel's history, oldest first. A channel with no file yet starts from `seed`, the lines state.chatLog already
 * holds from before this store existed (up to 120 each), so upgrading loses no history.
 */
function load(channel, seed = []) {
  const cached = channels.get(channel);
  if (cached) return cached;
  let text = io.read(channelFile(channel));
  if (text === null && Array.isArray(seed) && seed.length) {
    text = seed.map((m) => JSON.stringify(m)).join("\n") + "\n";
    io.append(channelFile(channel), text);
  }
  const lines = [];
  for (const row of String(text || "").split("\n")) {
    if (!row.trim()) continue;
    try { lines.push(JSON.parse(row)); } catch { /* a torn last line after a crash: skipped, not fatal */ }
  }
  const entry = { lines, at: new Map(lines.map((m, i) => [m.id, i])) };
  channels.set(channel, entry);
  return entry;
}

/**
 * Store one chat line in its channel's file, before it is kept in memory or sent. Throws when the file cannot be
 * written: the caller refuses the line rather than send what was not stored. `seed` as for load.
 */
export function appendChatLine(message, seed = []) {
  const entry = load(message.channel, seed);
  io.append(channelFile(message.channel), `${JSON.stringify(message)}\n`);
  entry.at.set(message.id, entry.lines.length);
  entry.lines.push(message);
}

/**
 * One page of a channel's history before `cursor` (the id of the oldest line the reader has), oldest first, so a
 * client prepends it as it is. Without a cursor, the newest page. `nextCursor` is the id to ask with next, null at the
 * start of the channel. Lines only ever append, so lines that arrive while someone reads back are never repeated or
 * skipped. An id the channel does not hold is a 400, not a restart from the top.
 */
export function chatHistoryPage(channel, { cursor, limit, seed = [] } = {}) {
  const entry = load(channel, seed);
  const n = pageSize(limit, CHAT_PAGE);
  let end = entry.lines.length;
  if (cursor !== undefined && cursor !== null && cursor !== "") {
    const i = entry.at.get(String(cursor));
    if (i === undefined) return { status: 400, error: "That page marker is not valid." };
    end = i;
  }
  const start = Math.max(0, end - n);
  const messages = entry.lines.slice(start, end);
  return { channel, messages, nextCursor: start > 0 && messages.length ? messages[0].id : null };
}
