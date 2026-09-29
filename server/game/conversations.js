// server/game/conversations.js: private messages between two corporations (AB#910), on the model in
// docs/design/messaging.md (AB#909).
//
// The Board: D-0.12-1 (AB#707) "This should just be able to scale....", D-0.5-4 (AB#696) "no safety measures". So a
// message is free text to any corporation by its publicId, with no filter, block, report or moderation. The limits
// here (size, page size, and the rate limiters in rateLimiters.js) protect the server; none reads what a message says.
//
// Storage is the design's file stopgap until Postgres (v0.6, Decision #591), and none of it is in the accounts snapshot:
//   data/messages/<conversationId>.jsonl  each message appended as one line, never rewritten
//   data/inbox/<accountId>.json           that account's conversations (one entry per correspondent), rewritten only
//                                         when its own inbox changes
// A send appends the line, then writes both inboxes; if any write fails the line is cut off again and nothing in
// memory changes, so a failed send leaves nothing half-written (503). Account ids stay on the server (Bug #711/#1134):
// a client sees conversations by their opaque id and the other side by publicId.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir, safeWriteFile } from "./catalog.js";
import { accountsStore } from "./store.js";
import { resolveMailRecipient, senderName } from "./messaging.js";

export const BODY_MAX_CHARS = 8000; // today's mail cap, so migrated mail always fits
export const BODY_MAX_BYTES = 32 * 1024; // so 8,000 four-byte characters are not four times the storage
export const INBOX_PAGE = 30;
export const THREAD_PAGE = 50;
export const PAGE_MAX = 100;
const PREVIEW_CHARS = 140;

// ─── The files, behind a small layer a test can make fail ────────────────────
const messagesDir = () => path.join(dataDir, "messages");
const inboxDir = () => path.join(dataDir, "inbox");
const threadFile = (conversationId) => path.join(messagesDir(), `${conversationId}.jsonl`);
const inboxFile = (accountId) => path.join(inboxDir(), `${encodeURIComponent(accountId)}.json`);

const fileIo = {
  read(file) { try { return fs.readFileSync(file, "utf8"); } catch (e) { if (e?.code === "ENOENT") return null; throw e; } },
  size(file) { try { return fs.statSync(file).size; } catch (e) { if (e?.code === "ENOENT") return 0; throw e; } },
  append(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, text, "utf8"); },
  truncate(file, size) { if (size === 0) fs.rmSync(file, { force: true }); else fs.truncateSync(file, size); },
  write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); safeWriteFile(file, text); }
};
let io = fileIo;
/** Tests only: swap the file layer (to make the store unavailable), or pass nothing to restore it. */
export function setConversationIo(next) { io = next || fileIo; }
/** Tests and the probe: forget what is cached, so the next read comes from the files. */
export function resetConversationCache() { inboxes.clear(); threads.clear(); }

// ─── Ids ─────────────────────────────────────────────────────────────────────
/** The conversation between two accounts: the same id whichever side asks, and no account id readable from it. */
export function conversationIdFor(a, b) {
  const [x, y] = [String(a), String(b)].sort();
  return `cv_${crypto.createHash("sha256").update(`${x}\u0000${y}`).digest("base64url").slice(0, 22)}`;
}
let lastMs = 0;
let seq = 0;
/**
 * A message id that sorts in the order messages were written: a fixed-width base-36 time, a sequence for messages in
 * the same millisecond, and a random tail. `at` lets a migrated message sort by when it was sent.
 */
export function messageIdAt(at = Date.now()) {
  const ms = Math.max(0, Math.floor(at));
  if (ms === lastMs) seq++; else { lastMs = ms; seq = 0; }
  return `m_${ms.toString(36).padStart(9, "0")}${seq.toString(36).padStart(4, "0")}${crypto.randomBytes(3).toString("hex")}`;
}

// ─── Reading the files ───────────────────────────────────────────────────────
const inboxes = new Map(); // accountId -> { [otherAccountId]: member }
const threads = new Map(); // conversationId -> messages, oldest first

function loadInbox(accountId) {
  if (inboxes.has(accountId)) return inboxes.get(accountId);
  const raw = io.read(inboxFile(accountId));
  const parsed = raw ? JSON.parse(raw) : {};
  const members = parsed && typeof parsed === "object" && parsed.conversations ? parsed.conversations : {};
  inboxes.set(accountId, members);
  return members;
}

function loadThread(conversationId) {
  if (threads.has(conversationId)) return threads.get(conversationId);
  const raw = io.read(threadFile(conversationId)) || "";
  const list = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { list.push(JSON.parse(line)); } catch { /* a line cut short by a crash mid-append: never acknowledged, skipped */ }
  }
  list.sort((m, n) => (m.id < n.id ? -1 : m.id > n.id ? 1 : 0));
  threads.set(conversationId, list);
  return list;
}

const inboxText = (members) => JSON.stringify({ conversations: members });

// ─── Views: what a client sees ───────────────────────────────────────────────
function corpOf(accountId) {
  const corp = accountsStore.accounts?.[accountId]?.state?.corp;
  return corp ? { publicId: corp.publicId || null, corporationName: corp.corporationName || "" } : { publicId: null, corporationName: "A former corporation" };
}

export function messageView(message, viewerId) {
  const from = corpOf(message.from);
  return {
    id: message.id,
    conversationId: message.conversationId,
    fromCorpId: from.publicId,
    fromName: message.fromName || from.corporationName,
    mine: message.from === viewerId,
    ...(message.subject ? { subject: message.subject } : {}),
    body: message.body, // stored and returned exactly as sent: no filter (AB#696); clients render it as text
    sentAt: message.sentAt
  };
}

function conversationView(member) {
  return {
    id: member.conversationId,
    with: corpOf(member.other),
    lastMessageAt: member.lastMessageAt,
    lastMessage: member.lastPreview ?? "",
    lastFromMe: Boolean(member.lastFromMe),
    unread: member.unread || 0,
    messageCount: member.count || 0,
    archived: Boolean(member.archived)
  };
}

// ─── ISP-264 (AB#960): a player's mail, exported and erased ─────────────────
/** What an erased message reads as, in the other side's copy of the conversation. */
export const ERASED_MESSAGE = "This message was deleted with its sender's account.";

/** Every conversation the account is in, with every message in it, as the account sees them. */
export function exportAccountMail(accountId) {
  const members = loadInbox(accountId);
  return Object.values(members).map((member) => ({
    ...conversationView(member),
    messages: loadThread(member.conversationId).map((m) => messageView(m, accountId))
  }));
}

/**
 * The files an erasure will change, so the caller can put them back if a later step fails: the account's inbox, each
 * of its threads, and the other side's inbox of each. { [file]: text | null }.
 */
export function accountMailFiles(accountId) {
  const members = loadInbox(accountId);
  const files = [inboxFile(accountId), ...Object.values(members).flatMap((m) => [threadFile(m.conversationId), inboxFile(m.other)])];
  return Object.fromEntries(files.map((file) => [file, io.read(file)]));
}

/** Put files back as accountMailFiles read them (a missing one is removed), and forget what was cached. */
export function restoreMailFiles(saved) {
  for (const [file, text] of Object.entries(saved)) { if (text === null) io.truncate(file, 0); else io.write(file, text); }
  resetConversationCache();
}

/**
 * Erase the account's mail: its inbox goes, and in each conversation the messages it sent keep their place but not
 * their words, subject or sender name (the other side's thread stays whole, and says what happened). The other side's
 * preview of a last message the account sent is erased too. `label` is what the sender is called afterwards.
 */
export function eraseAccountMail(accountId, label) {
  const members = loadInbox(accountId);
  for (const member of Object.values(members)) {
    const thread = loadThread(member.conversationId).map((m) => (m.from === accountId
      ? { ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== "subject")), body: ERASED_MESSAGE, fromName: label }
      : m));
    io.write(threadFile(member.conversationId), thread.map((m) => JSON.stringify(m)).join("\n") + (thread.length ? "\n" : ""));
    const theirs = loadInbox(member.other);
    const row = theirs[accountId];
    if (row && !row.lastFromMe) row.lastPreview = ERASED_MESSAGE.slice(0, PREVIEW_CHARS);
    if (row) io.write(inboxFile(member.other), inboxText(theirs));
  }
  io.truncate(inboxFile(accountId), 0);
  resetConversationCache();
}

// ─── Cursors ─────────────────────────────────────────────────────────────────
const encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  try { return JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8")); } catch { return undefined; }
}
export function pageSize(requested, fallback) {
  const n = Number.parseInt(requested, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, PAGE_MAX) : fallback;
}

// ─── The body ────────────────────────────────────────────────────────────────
/** The body as it will be stored, or { status, error }. Size only: nothing about what it says. */
export function checkBody(value) {
  const body = typeof value === "string" ? value.trim() : "";
  if (!body) return { status: 400, error: "A message needs a body." };
  if (body.length > BODY_MAX_CHARS || Buffer.byteLength(body, "utf8") > BODY_MAX_BYTES) {
    return { status: 413, error: `A message is at most ${BODY_MAX_CHARS.toLocaleString("en-US")} characters.` };
  }
  return { body };
}

// ─── Writing ─────────────────────────────────────────────────────────────────
/** True when these two accounts have written to each other before (the new-conversation limit only counts new ones). */
export function conversationExists(fromAccountId, toAccountId) {
  return Boolean(loadInbox(fromAccountId)[toAccountId]);
}

function memberAfter(member, { conversationId, other, message, incoming, read = false }) {
  const m = member ? { ...member } : { conversationId, other, createdAt: message.sentAt, lastReadAt: 0, unread: 0, count: 0, archived: false, clearedBefore: 0 };
  m.count = (m.count || 0) + 1;
  if (message.sentAt >= (m.lastMessageAt || 0)) {
    m.lastMessageAt = message.sentAt;
    m.lastMessageId = message.id;
    m.lastPreview = message.body.slice(0, PREVIEW_CHARS);
    m.lastFromMe = !incoming;
  }
  if (incoming && !read) { m.unread = (m.unread || 0) + 1; m.archived = false; } else if (incoming) { m.lastReadAt = Math.max(m.lastReadAt || 0, message.sentAt); } else { m.lastReadAt = Math.max(m.lastReadAt || 0, message.sentAt); }
  return m;
}

/**
 * Store one message and update both inboxes, all or nothing. `extra` carries a migrated message's subject, sentAt and
 * legacyKey. Throws { status: 503 } when the store cannot be written; nothing is left behind in the files or in memory.
 */
function storeMessage(fromAccountId, toAccountId, body, extra = {}) {
  const conversationId = conversationIdFor(fromAccountId, toAccountId);
  const sentAt = extra.sentAt ?? Date.now();
  const message = {
    id: messageIdAt(sentAt), conversationId, from: fromAccountId, fromName: extra.fromName ?? senderName(accountsStore.accounts?.[fromAccountId]),
    ...(extra.subject ? { subject: extra.subject } : {}), body, sentAt, ...(extra.legacyKey ? { legacyKey: extra.legacyKey } : {})
  };
  const self = fromAccountId === toAccountId;
  let senderInbox, recipientInbox, thread;
  try {
    senderInbox = loadInbox(fromAccountId);
    recipientInbox = self ? senderInbox : loadInbox(toAccountId);
    thread = loadThread(conversationId);
  } catch (error) {
    throw Object.assign(new Error("The message store could not be read."), { status: 503, cause: error });
  }
  const nextSender = { ...senderInbox, [toAccountId]: memberAfter(senderInbox[toAccountId], { conversationId, other: toAccountId, message, incoming: false }) };
  const nextRecipient = self ? nextSender : { ...recipientInbox, [fromAccountId]: memberAfter(recipientInbox[fromAccountId], { conversationId, other: fromAccountId, message, incoming: true, read: Boolean(extra.read) }) };

  const file = threadFile(conversationId);
  let before = null;
  try {
    before = io.size(file);
    io.append(file, `${JSON.stringify(message)}\n`);
    io.write(inboxFile(fromAccountId), inboxText(nextSender));
    if (!self) io.write(inboxFile(toAccountId), inboxText(nextRecipient));
  } catch (error) {
    // Undo the append and whichever inbox was written, so a failed send leaves the files as they were.
    try { if (before !== null) io.truncate(file, before); } catch { /* the line is unacknowledged either way */ }
    try { io.write(inboxFile(fromAccountId), inboxText(senderInbox)); if (!self) io.write(inboxFile(toAccountId), inboxText(recipientInbox)); } catch { /* best effort */ }
    throw Object.assign(new Error("The message store is unavailable."), { status: 503, cause: error });
  }
  inboxes.set(fromAccountId, nextSender);
  if (!self) inboxes.set(toAccountId, nextRecipient);
  const at = thread.findIndex((m) => m.id > message.id);
  if (at < 0) thread.push(message); else thread.splice(at, 0, message);
  return { message, conversationId };
}

/**
 * Send a free-text message from `fromAccountId` (always the caller's own account, taken from the token) to the
 * corporation whose publicId is `toCorpId`. Returns { status, error } on a refusal; nothing is stored on one.
 */
export function sendConversationMessage(fromAccountId, { toCorpId, body } = {}) {
  if (!accountsStore.accounts?.[fromAccountId]) return { status: 404, error: "Sender not found." };
  const id = typeof toCorpId === "string" ? toCorpId.trim() : "";
  if (!id || id.length > 64) return { status: 400, error: "Say which corporation the message is for, by its id." };
  const resolved = resolveMailRecipient({ toCorpId: id });
  if (!resolved.account) return { status: 404, error: "No corporation has that id." };
  const checked = checkBody(body);
  if (checked.error) return checked;
  try {
    const { message, conversationId } = storeMessage(fromAccountId, resolved.account.id, checked.body);
    return { ok: true, message, conversationId, recipientAccountId: resolved.account.id };
  } catch (error) {
    if (error?.status === 503) return { status: 503, error: "Messages cannot be sent right now. Nothing was sent; try again shortly." };
    throw error;
  }
}

// ─── Reading pages ───────────────────────────────────────────────────────────
/** One page of an account's conversations, newest first, by (lastMessageAt, id). */
export function listConversations(accountId, { cursor, limit, archived = false } = {}) {
  const after = decodeCursor(cursor);
  if (after === undefined || (after !== null && !(Array.isArray(after) && after.length === 2))) return { status: 400, error: "That page marker is not valid." };
  const n = pageSize(limit, INBOX_PAGE);
  const rows = Object.values(loadInbox(accountId))
    .filter((m) => Boolean(m.archived) === Boolean(archived))
    .sort((m, o) => o.lastMessageAt - m.lastMessageAt || (o.conversationId > m.conversationId ? 1 : o.conversationId < m.conversationId ? -1 : 0));
  const start = after ? rows.findIndex((m) => m.lastMessageAt < after[0] || (m.lastMessageAt === after[0] && m.conversationId < after[1])) : 0;
  const page = start < 0 ? [] : rows.slice(start, start + n);
  const more = start >= 0 && start + n < rows.length;
  const last = page[page.length - 1];
  // AB#911: the Inbox tab's count is every unread message, not only the page returned
  const unreadTotal = Object.values(loadInbox(accountId)).reduce((n, m) => n + (m.archived ? 0 : m.unread || 0), 0);
  return { conversations: page.map(conversationView), nextCursor: more && last ? encodeCursor([last.lastMessageAt, last.conversationId]) : null, unreadTotal };
}

/** The member row for this account in this conversation, or null when it is not one of the two. */
function memberFor(accountId, conversationId) {
  return Object.values(loadInbox(accountId)).find((m) => m.conversationId === conversationId) || null;
}

/**
 * One page of a conversation, newest first. The cursor is the last id returned; ids only grow, so messages that arrive
 * while someone pages back come before the cursor and are never repeated or skipped.
 */
export function listConversationMessages(accountId, conversationId, { cursor, limit } = {}) {
  const member = memberFor(accountId, String(conversationId || ""));
  if (!member) return { status: 404, error: "No such conversation." };
  const before = cursor === undefined || cursor === null || cursor === "" ? null : String(cursor);
  if (before !== null && !/^m_[0-9a-z]{13}[0-9a-f]{6}$/.test(before)) return { status: 400, error: "That page marker is not valid." };
  const n = pageSize(limit, THREAD_PAGE);
  const thread = loadThread(member.conversationId).filter((m) => m.sentAt > (member.clearedBefore || 0));
  // the first message at or after the cursor, by binary search; the page is the n before it, newest first
  let lo = 0, hi = thread.length;
  if (before !== null) { while (lo < hi) { const mid = (lo + hi) >> 1; if (thread[mid].id < before) lo = mid + 1; else hi = mid; } } else lo = thread.length;
  const from = Math.max(0, lo - n);
  const page = thread.slice(from, lo).reverse();
  return {
    conversation: conversationView(member),
    messages: page.map((m) => messageView(m, accountId)),
    nextCursor: from > 0 && page.length ? page[page.length - 1].id : null
  };
}

/** Mark a conversation read up to its newest message. */
export function markConversationRead(accountId, conversationId) {
  const inbox = loadInbox(accountId);
  const member = memberFor(accountId, String(conversationId || ""));
  if (!member) return { status: 404, error: "No such conversation." };
  const next = { ...inbox, [member.other]: { ...member, unread: 0, lastReadAt: member.lastMessageAt || Date.now() } };
  try { io.write(inboxFile(accountId), inboxText(next)); } catch { return { status: 503, error: "The message store is unavailable. Try again shortly." }; }
  inboxes.set(accountId, next);
  return { conversation: conversationView(next[member.other]) };
}

/**
 * The old Inbox's send route writes here too, so conversations are complete from now on (AB#910). Best effort: the
 * old mail has already been delivered by then, and a message this misses is copied by migrateLegacyMail, which finds
 * it by the same legacyKey.
 */
export function recordLegacyMessage(m) {
  if (!m?.fromId || !m?.toAccountId) return false;
  try {
    const key = legacyKeyOf(m);
    if (loadThread(conversationIdFor(m.fromId, m.toAccountId)).some((x) => x.legacyKey === key)) return true;
    const body = String(m.body || "").trim().slice(0, BODY_MAX_CHARS) || "(no text)";
    storeMessage(m.fromId, m.toAccountId, body, { sentAt: m.sentAt, subject: m.subject && m.subject !== "(no subject)" ? m.subject : undefined, fromName: m.fromName, legacyKey: key });
    return true;
  } catch (error) {
    console.warn("[conversations] the old mail's copy could not be written; migrate-mail will copy it:", error?.message || error);
    return false;
  }
}

/**
 * AB#911: the Inbox reads player mail from conversations now, so the mail sent before AB#910 is copied in once, when the
 * server starts, rather than waiting for someone to run scripts/migrate-mail.mjs. A marker in data/messages records that
 * it ran (and its counts); it is idempotent anyway, so a lost marker only costs one more pass.
 */
export function migrateLegacyMailOnce(store = accountsStore) {
  const marker = path.join(messagesDir(), ".legacy-mail-migrated.json");
  if (io.read(marker)) return null;
  const report = migrateLegacyMail(store);
  // Nothing to copy (a new install, or a test's empty data directory) leaves the directory as it was; the scan is cheap.
  if (report.messages) io.write(marker, JSON.stringify({ at: new Date().toISOString(), ...report }));
  return report;
}

// ─── The old mail, into conversations ────────────────────────────────────────
/** One key per player message, the same for its inbox copy and its sent copy (they share every field that matters). */
export function legacyKeyOf(m) {
  return crypto.createHash("sha256").update(JSON.stringify([m.fromId, m.toAccountId, m.sentAt, m.subject || "", m.body || ""])).digest("base64url").slice(0, 22);
}

/**
 * Copy every player message in the accounts' old mail into conversations, once: the inbox and sent copies of a message
 * become one message, sender, recipient, subject, body and time kept. Idempotent (a message already copied is found by
 * its legacyKey), and it leaves the old mail where it is: the Inbox still reads it until it moves to conversations.
 * Counts before and after; throws if any old player message is not in a conversation afterwards.
 */
export function migrateLegacyMail(store = accountsStore) {
  const accounts = store.accounts || {};
  const unique = new Map();
  let copies = 0;
  for (const account of Object.values(accounts)) {
    for (const m of account?.messages || []) {
      if (m?.fromType !== "player" || m.folder === "draft" || !m.fromId || !m.toAccountId) continue;
      copies++;
      const key = legacyKeyOf(m);
      const seen = unique.get(key) || { ...m, key, read: false };
      // the recipient's own copy says whether they read it; the sender's copy is always read
      if (account.id === m.toAccountId && m.folder !== "sent" && m.readAt) seen.read = true;
      unique.set(key, seen);
    }
  }
  let written = 0, present = 0, skipped = 0;
  const ordered = [...unique.values()].sort((a, b) => Number(a.sentAt) - Number(b.sentAt));
  for (const m of ordered) {
    if (!accounts[m.fromId] || !accounts[m.toAccountId]) { skipped++; continue; } // a side that no longer exists
    const thread = loadThread(conversationIdFor(m.fromId, m.toAccountId));
    if (thread.some((x) => x.legacyKey === m.key)) { present++; continue; }
    const body = String(m.body || "").trim().slice(0, BODY_MAX_CHARS) || "(no text)";
    storeMessage(m.fromId, m.toAccountId, body, { sentAt: Number(m.sentAt) || Date.now(), subject: m.subject && m.subject !== "(no subject)" ? m.subject : undefined, fromName: m.fromName, legacyKey: m.key, read: m.read });
    written++;
  }
  // The proof is the count, not the exit code: every old message between two existing accounts is now in a thread.
  const missing = ordered.filter((m) => accounts[m.fromId] && accounts[m.toAccountId]
    && !loadThread(conversationIdFor(m.fromId, m.toAccountId)).some((x) => x.legacyKey === m.key));
  if (missing.length) throw new Error(`${missing.length} old message(s) are not in a conversation after the migration.`);
  return { copies, messages: unique.size, written, alreadyPresent: present, skippedMissingAccount: skipped };
}
