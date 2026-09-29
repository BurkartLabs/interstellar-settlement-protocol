// The Inbox's Players tab: private conversations between corporations (AB#911), on the routes AB#910 built
// (docs/design/messaging.md). A conversation list paged 30 at a time, a thread that opens on its latest page and loads
// older pages as the player scrolls up, a reply box, and the unread total the Inbox tab shows.
//
// Free text between any two corporations, with no filter, block, report or moderation (Board: AB#707, AB#696). Every
// body, name and preview goes through escapeHtml: message text renders as text, never HTML.

import { apiFetch } from "../apiClient.js";
import { escapeHtml } from "../html.js";
import { commsMeaning, setStatusLine } from "../commsProtocol.js"; // ISP-255c1 (AB#4830)
import { markdownHtml } from "../markdown.js"; // AB#2467: a body renders its Markdown, escaped as it is built
import { appState } from "../state.js";
import { utcTime } from "../timeFormat.js";

export const convState = {
  list: [],            // conversations, newest first
  nextCursor: null,
  unreadTotal: 0,      // across every conversation, not only the page held
  loaded: false,
  open: null           // { conversation, messages (oldest first), nextCursor, loading }
};

let hooks = { onChange: () => {}, show: () => {}, formatDate: (t) => utcTime(t) }; // ISP-249 (AB#945)
/** inbox.js passes what this module needs from it, so the two do not import each other. */
export function setConversationHooks(next) { hooks = { ...hooks, ...next }; }

const base = () => `/api/accounts/${appState.accountId}/conversations`;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ─── Pure: merging pages ─────────────────────────────────────────────────────
/** An older page (newest first, as the server sends it) put in front of what is held (oldest first), no repeats. */
export function mergeOlder(held, pageNewestFirst) {
  const seen = new Set(held.map((m) => m.id));
  return [...pageNewestFirst.filter((m) => !seen.has(m.id)).reverse(), ...held];
}
/** One new message (sent here, or arrived live) added in id order, unless it is already held. */
export function appendNewer(held, message) {
  if (!message || held.some((m) => m.id === message.id)) return held;
  return [...held, message].sort(byId);
}

// ─── Pure: the HTML ──────────────────────────────────────────────────────────
export function conversationRowsHtml(list, formatDate) {
  return list.map((c) => {
    const unread = c.unread > 0;
    const who = escapeHtml(c.with?.corporationName || "A former corporation");
    const preview = `${c.lastFromMe ? "You: " : ""}${c.lastMessage || ""}`;
    return `<li><button type="button" class="ui-card ui-card--interactive inbox__message inbox__conversation${unread ? " is-unread" : ""}" data-conv-id="${escapeHtml(c.id)}">
      <span class="ui-card__meta inbox__message-meta"><span>${who}</span><span>${escapeHtml(formatDate(c.lastMessageAt))}</span></span>
      <span class="ui-card__title inbox__preview-line"><span class="inbox__preview">${escapeHtml(preview)}</span>${unread ? `<span class="ui-badge ui-badge--accent">${c.unread} new</span>` : ""}</span>
    </button></li>`;
  }).join("");
}

export function threadMessagesHtml(messages, formatDate) {
  return messages.map((m) => `<li class="thread__msg ${m.mine ? "thread__msg--mine" : "thread__msg--theirs"}" data-message-id="${escapeHtml(m.id)}">
      <span class="thread__meta">${m.mine ? "You" : escapeHtml(m.fromName || "Unknown")} · ${escapeHtml(formatDate(m.sentAt))}</span>
      ${m.subject ? `<span class="thread__subject">${escapeHtml(m.subject)}</span>` : ""}
      <div class="thread__body">${markdownHtml(m.body)}</div>
    </li>`).join("");
}

// ─── The conversation list ───────────────────────────────────────────────────
async function getJson(url, options) {
  const res = await apiFetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function loadConversations({ more = false } = {}) {
  if (!appState.accountId) return;
  const cursor = more && convState.nextCursor ? `&cursor=${encodeURIComponent(convState.nextCursor)}` : "";
  const { ok, data } = await getJson(`${base()}?limit=30${cursor}`);
  if (!ok) return;
  convState.list = more ? [...convState.list, ...data.conversations.filter((c) => !convState.list.some((x) => x.id === c.id))] : data.conversations;
  convState.nextCursor = data.nextCursor;
  convState.unreadTotal = data.unreadTotal ?? convState.list.reduce((n, c) => n + (c.unread || 0), 0);
  convState.loaded = true;
  hooks.onChange();
}

export function renderConversationList() {
  const list = document.getElementById("inbox-conversation-list");
  const more = document.getElementById("inbox-conversation-more");
  const empty = document.getElementById("inbox-empty-notice");
  if (!list) return;
  list.innerHTML = conversationRowsHtml(convState.list, hooks.formatDate);
  list.querySelectorAll("[data-conv-id]").forEach((el) => el.addEventListener("click", () => openConversation(el.dataset.convId)));
  if (more) more.hidden = !convState.nextCursor;
  if (empty) {
    empty.hidden = convState.list.length > 0 || !convState.loaded;
    if (!convState.list.length) empty.textContent = "No conversations yet. Press Compose to write to any corporation.";
  }
}

// ─── A thread ────────────────────────────────────────────────────────────────
const scroller = () => document.getElementById("thread-scroll");

function renderThread({ keepBottom = false, heightBefore = null } = {}) {
  const open = convState.open;
  const listEl = document.getElementById("thread-messages");
  if (!open || !listEl) return;
  document.getElementById("thread-title").textContent = open.conversation.with?.corporationName || "A former corporation";
  const older = document.getElementById("thread-older-status");
  if (older) older.textContent = open.loading ? "Loading older messages…" : open.nextCursor ? "Scroll up for older messages" : "The start of this conversation";
  listEl.innerHTML = threadMessagesHtml(open.messages, hooks.formatDate);
  const el = scroller();
  if (!el) return;
  if (keepBottom) el.scrollTop = el.scrollHeight;
  else if (heightBefore !== null) el.scrollTop += el.scrollHeight - heightBefore; // older page above: stay on the same message
}

/**
 * Size the thread to the screen and bring it into view, so the newest messages and the reply box are both on it. On a
 * phone the thread opened below the other Company panels, with the fixed navigation over its bottom (seen at 375x812).
 */
function fitThreadToScreen() {
  const el = scroller();
  const view = document.getElementById("inbox-thread-view");
  const form = document.getElementById("thread-reply-form");
  if (!el || !view || !form || typeof window === "undefined" || !window.innerHeight) return;
  const header = document.querySelector(".app-header");
  const top = header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().height : 0;
  const fixedBelow = [...document.querySelectorAll(".app-nav, .nav-group__tabs")]
    .filter((n) => getComputedStyle(n).position === "fixed" && n.getBoundingClientRect().height > 0)
    .reduce((most, n) => Math.max(most, window.innerHeight - n.getBoundingClientRect().top), 0);
  const above = el.getBoundingClientRect().top - view.getBoundingClientRect().top; // Back and the title
  const room = window.innerHeight - top - fixedBelow - above - form.getBoundingClientRect().height - 24;
  el.style.maxHeight = `${Math.round(Math.max(180, Math.min(560, room)))}px`;
  window.scrollTo({ top: window.scrollY + view.getBoundingClientRect().top - top - 8 });
}
if (typeof window !== "undefined") window.addEventListener("resize", () => { if (convState.open) fitThreadToScreen(); });

export async function openConversation(conversationId) {
  const summary = convState.list.find((c) => c.id === conversationId);
  convState.open = { conversation: summary || { id: conversationId, with: {} }, messages: [], nextCursor: null, loading: true };
  hooks.show("thread");
  document.getElementById("thread-status").textContent = "";
  const { ok, data } = await getJson(`${base()}/${encodeURIComponent(conversationId)}/messages?limit=50`);
  if (!ok || convState.open?.conversation.id !== conversationId) return;
  convState.open = { conversation: data.conversation, messages: mergeOlder([], data.messages), nextCursor: data.nextCursor, loading: false };
  renderThread();
  fitThreadToScreen();
  renderThread({ keepBottom: true });
  await fillScreen();
  markRead(conversationId);
}

/** Load the page before the oldest held message. Returns true when it loaded one. */
export async function loadOlder() {
  const open = convState.open;
  if (!open || open.loading || !open.nextCursor) return false;
  open.loading = true;
  const id = open.conversation.id;
  const heightBefore = scroller()?.scrollHeight ?? 0;
  renderThread({ heightBefore });
  const { ok, data } = await getJson(`${base()}/${encodeURIComponent(id)}/messages?limit=50&cursor=${encodeURIComponent(open.nextCursor)}`);
  if (convState.open !== open) return false;
  open.loading = false;
  if (!ok) { renderThread(); return false; }
  const before = scroller()?.scrollHeight ?? 0;
  open.messages = mergeOlder(open.messages, data.messages);
  open.nextCursor = data.nextCursor;
  renderThread({ heightBefore: before });
  return true;
}

/** A short thread on a tall screen has no scrollbar to scroll up with, so load older pages until it has one. */
async function fillScreen() {
  const el = scroller();
  for (let i = 0; i < 5 && el && el.scrollHeight <= el.clientHeight && convState.open?.nextCursor; i++) {
    if (!(await loadOlder())) break;
  }
}

async function markRead(conversationId) {
  const held = convState.list.find((c) => c.id === conversationId);
  const was = held?.unread || 0;
  if (held) held.unread = 0;
  convState.unreadTotal = Math.max(0, convState.unreadTotal - was);
  hooks.onChange();
  const { ok } = await getJson(`${base()}/${encodeURIComponent(conversationId)}/read`, { method: "POST" });
  if (!ok) loadConversations(); // put the true counts back
}

export async function sendInThread(body) {
  const open = convState.open;
  const status = document.getElementById("thread-status");
  const text = String(body || "").trim();
  if (!open || !text) return false;
  status.textContent = "Sending…";
  const { ok, status: code, data } = await getJson(`${base()}/send`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toCorpId: open.conversation.with?.publicId, body: text })
  });
  if (!ok) {
    setStatusLine(status, data.error || "The message was not sent.", { meaning: commsMeaning({ status: code, code: data.code, error: data.error }), screen: "inbox" }); // ISP-255c1 (AB#4830)
    return false;
  }
  open.messages = appendNewer(open.messages, data.message);
  status.textContent = "";
  renderThread({ keepBottom: true });
  loadConversations();
  return true;
}

/** A first message from the composer: to a corporation by its publicId. Opens the thread it lands in. */
export async function sendNew(toCorpId, body) {
  const { ok, status, data } = await getJson(`${base()}/send`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toCorpId, body })
  });
  if (!ok) return { error: data.error || "The message was not sent.", protocol: { meaning: commsMeaning({ status, code: data.code, error: data.error }), screen: "inbox" } }; // ISP-255c1 (AB#4830)
  await loadConversations();
  await openConversation(data.conversationId);
  return { ok: true };
}

/** A message arrived live (conversations:new, to this account's own room). */
export function onConversationEvent(payload) {
  const open = convState.open;
  const threadVisible = !document.getElementById("inbox-thread-view")?.hidden;
  if (open && payload?.conversationId === open.conversation.id && threadVisible) {
    const atBottom = (() => { const el = scroller(); return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80; })();
    open.messages = appendNewer(open.messages, payload.message);
    renderThread({ keepBottom: atBottom });
    if (!payload.message?.mine) markRead(open.conversation.id);
  }
  loadConversations();
}

export function closeConversation() { convState.open = null; }

/** The thread scroller's scroll handler: near the top, load the page before. */
export function onThreadScroll(event) { if ((event?.target?.scrollTop ?? 1e9) < 80) loadOlder(); }

