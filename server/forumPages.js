// AB#995 (ISP-288, docs/design/messaging.md "Chat history and forums on the same model"): the forums a page at a time.
// Threads page 25 at a time by (last post, id), newest activity first; replies 50 at a time in the order they were
// written. Page sizes are the server's: a client may ask for fewer or more, never more than PAGE_MAX. The forums are
// still stored in state.json (the design's move to per-thread files is later work); what changes is that nobody is
// sent all of them.
import { postView } from "./publicViews.js";

export const THREAD_LIST_PAGE = 25;
export const REPLY_PAGE = 50;
export const PAGE_MAX = 100;

export function pageSize(requested, fallback) {
  const n = Number.parseInt(requested, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, PAGE_MAX) : fallback;
}

const encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** null for no cursor, undefined for one the server cannot read (a 400, not a restart from the top). */
function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  try { return JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8")); } catch { return undefined; }
}

const replies = (thread) => (Array.isArray(thread?.replies) ? thread.replies : []);
const createdAt = (post) => Number(post?.createdAt) || 0;

/** When a thread was last posted in: its own time, or its newest reply's. Kept on the thread since AB#995. */
export function lastPostAt(thread) {
  if (Number.isFinite(thread?.lastPostAt)) return thread.lastPostAt;
  return replies(thread).reduce((at, r) => Math.max(at, createdAt(r)), createdAt(thread));
}

/** The same, as it stood at `asOf`: what the thread list's order was when the reader opened its first page. */
function lastPostAsOf(thread, asOf) {
  const last = lastPostAt(thread);
  if (last <= asOf) return last;
  return replies(thread).reduce((at, r) => (createdAt(r) <= asOf ? Math.max(at, createdAt(r)) : at), createdAt(thread));
}

/** A thread in a list, as `viewer` sees it: no replies, their count and when the last one came. */
export function threadSummary(thread, viewer = null) {
  // eslint-disable-next-line no-unused-vars
  const { replies: _replies, ...rest } = postView(thread, viewer);
  return { ...rest, replyCount: replies(thread).length, lastPostAt: lastPostAt(thread) };
}

/**
 * One page of a category's threads, newest activity first. The order is the one the list had when its first page was
 * read (the cursor carries that time), so a thread posted in while someone pages down is neither repeated nor
 * skipped, and a thread started since then waits for the next first page. Every thread appears exactly once.
 */
export function listThreads(forums, { category, cursor, limit, viewer = null, now = Date.now() } = {}) {
  const after = decodeCursor(cursor);
  if (after === undefined || (after !== null && !(Number.isFinite(after?.asOf) && Number.isFinite(after?.at) && typeof after?.id === "string"))) {
    return { status: 400, error: "That page marker is not valid." };
  }
  const n = pageSize(limit, THREAD_LIST_PAGE);
  const asOf = after ? after.asOf : now;
  const wanted = category ? String(category) : null;
  const rows = [];
  for (const thread of Array.isArray(forums?.threads) ? forums.threads : []) {
    if (wanted && thread.category !== wanted) continue;
    if (createdAt(thread) > asOf) continue;
    const at = lastPostAsOf(thread, asOf);
    if (after && (at > after.at || (at === after.at && thread.id >= after.id))) continue;
    rows.push({ thread, at });
  }
  rows.sort((a, b) => b.at - a.at || (a.thread.id < b.thread.id ? 1 : a.thread.id > b.thread.id ? -1 : 0));
  const page = rows.slice(0, n);
  const last = page[page.length - 1];
  return {
    threads: page.map((row) => threadSummary(row.thread, viewer)),
    nextCursor: rows.length > n && last ? encodeCursor({ asOf, at: last.at, id: last.thread.id }) : null
  };
}

/**
 * A thread and one page of its replies, in the order they were written. The cursor is the last reply id the reader
 * has; replies only ever append, so replies written while someone reads come after it, never repeated or skipped.
 */
export function threadRepliesPage(forums, threadId, { cursor, limit, viewer = null } = {}) {
  const thread = (Array.isArray(forums?.threads) ? forums.threads : []).find((t) => t.id === threadId);
  if (!thread) return { status: 404, error: "Thread not found." };
  const all = replies(thread);
  let start = 0;
  if (cursor !== undefined && cursor !== null && cursor !== "") {
    const i = all.findIndex((r) => r.id === String(cursor));
    if (i < 0) return { status: 400, error: "That page marker is not valid." };
    start = i + 1;
  }
  const n = pageSize(limit, REPLY_PAGE);
  const page = all.slice(start, start + n);
  return {
    thread: threadSummary(thread, viewer),
    replies: page.map((r) => postView(r, viewer)),
    nextCursor: start + n < all.length && page.length ? page[page.length - 1].id : null
  };
}
