// The Forums tab: categories, threads and replies.
// AB#739 (ISP-53): everything here moved from app.js unchanged.
// AB#995 (ISP-288): the forums are read a page at a time (GET /api/forums/threads, GET /api/forums/threads/:id), not
// sent whole in state:init. This module holds what the player has paged in: the thread list for the open category,
// and the open thread's replies, with "Load more" for the next page of either.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { INDENT_MAX_DEPTH, bindOnce, likeRequest, mergeThread, postFor, quoteDraft, replyDraft, replyTree } from "../forumActions.js";
import { formatTime } from "../helpers.js";
import { escapeHtml, forumPostBodyHtml } from "../html.js";
import { appState } from "../state.js";
import { pushFeedback } from "./shared.js";
import { commsMeaning, setStatusLine } from "../commsProtocol.js"; // ISP-255c1 (AB#4830)
import { protocolLineHtml } from "../protocol.js";
import { scrollBehavior } from "../motion.js"; // AB#1760

// ─── What has been paged in (AB#995) ─────────────────────────────────────────
// Kept here rather than in appState.data.forums, which state:init replaces (with the categories only) on reconnect.
const cache = { threads: [] }; // thread summaries, each with `replies` once it has been opened
const list = { key: null, ids: [], nextCursor: null, loading: false, error: null }; // key: the category, "" for all
const open = { id: null, nextCursor: undefined, loading: false, error: null }; // nextCursor undefined: not read yet

const threadById = (id) => cache.threads.find((t) => t.id === id) || null;

/** A thread summary into the cache, keeping the replies already paged in for it. */
function putThread(summary, replies) {
  if (!summary?.id) return;
  const old = threadById(summary.id);
  cache.threads = mergeThread(cache.threads, { ...old, ...summary, replies: replies ?? old?.replies });
}

/**
 * Bug #1133: the one way a thread from a response enters the client's forums, once, by id (mergeThread). Since AB#995
 * a response carries the thread's summary; the replies the player has paged in are kept.
 */
export function putForumThread(thread) {
  putThread(thread);
}

/** A new reply, appended only when the reader has every reply before it; otherwise it waits on a later page. */
function addReply(threadId, reply) {
  const thread = threadById(threadId);
  if (!thread || !reply?.id || open.id !== threadId || open.nextCursor !== null || !Array.isArray(thread.replies)) return;
  if (!thread.replies.some((r) => r.id === reply.id)) thread.replies = [...thread.replies, reply];
}

/** A reply that changed (a like), where the reader has it. */
function updateReply(threadId, reply) {
  const thread = threadById(threadId);
  if (!thread || !reply?.id || !Array.isArray(thread.replies)) return;
  thread.replies = thread.replies.map((r) => (r.id === reply.id ? { ...r, ...reply } : r));
}

/**
 * AB#995: one forums:updated event: `kind` "thread" (a new thread), "reply" (a new reply) or "like", with the thread's
 * summary and, for a reply or a liked reply, the reply. Applied to what the player has paged in.
 */
export function applyForumsEvent(event) {
  const thread = event?.thread;
  if (!thread?.id) return;
  if (event.kind === "thread") {
    if (list.key !== null && (list.key === "" || list.key === thread.category) && !list.ids.includes(thread.id)) list.ids = [thread.id, ...list.ids];
    putThread(thread, []);
    return;
  }
  if (threadById(thread.id)) putThread(thread);
  if (event.kind === "reply") addReply(thread.id, event.reply);
  if (event.kind === "like" && event.reply) updateReply(thread.id, event.reply);
}

/** The open category's first page, or with `more` the next one. Renders when it lands. */
async function loadThreads(more = false) {
  const key = appState.selectedForumCategory || "";
  if (list.loading || (!more && list.key === key)) return;
  if (more && !list.nextCursor) return;
  list.loading = true;
  list.error = null;
  if (!more) { list.key = key; list.ids = []; list.nextCursor = null; }
  const params = new URLSearchParams();
  if (key) params.set("category", key);
  if (more) params.set("cursor", list.nextCursor);
  try {
    const page = await parseJsonResponse(await apiFetch(`/api/forums/threads?${params}`));
    if (list.key !== key) return; // the player moved to another category while this was on its way
    for (const t of page.threads || []) putThread(t);
    const ids = (page.threads || []).map((t) => t.id);
    list.ids = more ? [...list.ids, ...ids.filter((id) => !list.ids.includes(id))] : ids;
    list.nextCursor = page.nextCursor || null;
  } catch (err) {
    list.error = err.message;
    if (!more) list.key = null; // try again on the next render
  } finally {
    list.loading = false;
    renderForums(appState.data);
  }
}

/** The open thread and its first page of replies, or with `more` the next page. Renders when it lands. */
async function loadReplies(more = false) {
  const id = appState.selectedForumThreadId;
  if (!id || open.loading) return;
  if (!more && open.id === id && open.nextCursor !== undefined) return;
  if (more && !open.nextCursor) return;
  open.loading = true;
  open.error = null;
  if (open.id !== id) { open.id = id; open.nextCursor = undefined; }
  const params = new URLSearchParams();
  if (more) params.set("cursor", open.nextCursor);
  try {
    const page = await parseJsonResponse(await apiFetch(`/api/forums/threads/${encodeURIComponent(id)}?${params}`));
    if (open.id !== id) return;
    const had = more ? threadById(id)?.replies || [] : [];
    putThread(page.thread, [...had, ...(page.replies || []).filter((r) => !had.some((h) => h.id === r.id))]);
    open.nextCursor = page.nextCursor || null;
  } catch (err) {
    open.error = err.message;
    if (!more) open.id = null; // try again on the next render
  } finally {
    open.loading = false;
    renderForums(appState.data);
  }
}

export function renderForums(data) {
  const overviewView = document.getElementById("forum-overview-view");
  const threadView = document.getElementById("forum-thread-view");

  if (appState.forumsView === "thread") {
    if (overviewView) overviewView.hidden = true;
    if (threadView) threadView.hidden = false;

    const detailBody = document.getElementById("forum-thread-detail-body");
    const selected = threadById(appState.selectedForumThreadId);
    // AB#995: the thread and its first page of replies are read when it is opened
    if (open.id !== appState.selectedForumThreadId || open.nextCursor === undefined) {
      if (detailBody && !open.loading) {
        detailBody.innerHTML = open.error && open.id === null
          ? `<p class="forums__note">This thread could not be loaded: ${escapeHtml(open.error)} ${protocolLineHtml({ meaning: "failed", screen: "forums" })}</p>`
          : `<p class="forums__note">Loading the thread…</p>`;
      }
      loadReplies();
      return;
    }
    if (detailBody && selected) {
      const author = selected.author || "Anonymous";
      const opLikes = Number(selected.likes) || 0;
      const replies = Array.isArray(selected.replies) ? selected.replies : [];
      const replyCount = Number.isFinite(selected.replyCount) ? selected.replyCount : replies.length; // AB#995: all of them, loaded or not
      const myAccountId = appState.accountId || null;
      const opLiked = Boolean(myAccountId && selected.likedByMe); // the server says only whether this account liked it (Bug #1134)
      const initials = (str) => String(str || "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase() || "?";
      const opBody = selected.body
        || selected.summary
        || `Filing this thread to consolidate strategy on predatory mineral leases. Recent ISA arbitration cases suggest a narrow window for procedural objections — particularly when the lessor has failed to publish quarterly extraction reports. Would appreciate input from any corporation that has successfully challenged a Tier-2 lease auction in the last 18 months. I am compiling a citation pack for the Sol jurisdiction sub-forum and will share the redacted draft with anyone willing to co-sign.`;

      // AB#2466: each reply under the one it answers, to any depth; posting order within each level. Pages load in
      // posting order, so a reply's parent is always loaded before it.
      const byId = new Map(replies.map((r) => [r.id, r]));
      const nodeHtml = ({ reply, depth, children }) => {
            const author = reply.author || "Anonymous";
            const replyLiked = Boolean(myAccountId && reply.likedByMe);
            const parent = reply.replyToId ? byId.get(reply.replyToId) : null;
            return `
              <li class="forums__reply" data-reply-depth="${depth}">
                <article class="ui-card forums__post" id="forum-reply-${escapeHtml(reply.id)}">
                  <header class="forums__post-head">
                    <span class="forums__avatar" aria-hidden="true">${escapeHtml(initials(author))}</span>
                    <span class="forums__byline">
                      <strong class="forums__author">${escapeHtml(author)}</strong>
                      <span class="ui-card__meta">${formatTime(reply.createdAt)}${parent ? ` · replying to ${escapeHtml(parent.author || "Anonymous")}` : ""}</span>
                    </span>
                  </header>
                  <div class="forums__body">
                    ${forumPostBodyHtml(reply.content || "")}
                  </div>
                  <footer class="forums__post-actions">
                    <button class="ui-button ui-button--ghost" type="button" data-action="reply" data-reply-id="${escapeHtml(reply.id)}">Reply</button>
                    <button class="ui-button ui-button--ghost" type="button" data-action="quote" data-reply-id="${escapeHtml(reply.id)}">Quote</button>
                    <button class="ui-button ui-button--ghost forums__like" type="button" data-action="like" data-target="reply" data-reply-id="${escapeHtml(reply.id)}" aria-pressed="${replyLiked}">${replyLiked ? "Liked" : "Like"} <span class="forums__like-count">${Number(reply.likes) || 0}</span></button>
                  </footer>
                </article>
                ${children.length ? `<ol class="forums__replies forums__replies--nested${depth + 1 >= INDENT_MAX_DEPTH ? " forums__replies--deep" : ""}">${children.map(nodeHtml).join("")}</ol>` : ""}
              </li>`;
      };
      const repliesHtml = replies.length
        ? replyTree(replies).map(nodeHtml).join("")
        : `<li><p class="forums__note">No replies yet. Be the first to weigh in.</p></li>`;
      // AB#995: the next page of replies, while there is one
      const moreHtml = open.nextCursor
        ? `<div class="forums__more"><p class="ui-screen__meta" data-role="replies-shown">Showing ${replies.length} of ${replyCount} replies</p>
            <button class="ui-button ui-button--secondary" type="button" data-action="more-replies"${open.loading ? " disabled" : ""}>${open.loading ? "Loading…" : "Load more replies"}</button></div>`
        : "";
      // AB#2466: the reply the box will answer, while it is one in this thread
      const target = appState.forumReplyTo?.threadId === selected.id ? byId.get(appState.forumReplyTo.replyId) : null;
      if (!target) appState.forumReplyTo = null;

      // Bug #1222: the reply box is part of this HTML, so a re-render (any forum update) emptied a half-written reply.
      // Keep what is in it, where the cursor is and whether it had focus, for the same thread, and put them back below.
      const oldBox = detailBody.querySelector("#forum-reply-content");
      const keptDraft = oldBox && oldBox.closest("form")?.dataset.threadId === selected.id
        ? { value: oldBox.value, start: oldBox.selectionStart, end: oldBox.selectionEnd, focused: document.activeElement === oldBox }
        : null;
      detailBody.innerHTML = `
        <div class="forums__thread">
          <div class="forums__topbar">
            <button id="forum-back-btn-inline" class="ui-button ui-button--secondary" type="button">← Back to Forums</button>
            <span class="ui-badge">${escapeHtml(selected.category || "general")}</span>
          </div>

          <header class="ui-screen__header">
            <h2 class="ui-screen__title">${escapeHtml(selected.title || "Untitled Thread")}</h2>
            <p class="ui-screen__meta">Started ${formatTime(selected.createdAt)} · ${replyCount} repl${replyCount === 1 ? "y" : "ies"} · ${opLikes} like${opLikes === 1 ? "" : "s"}</p>
          </header>

          <article class="ui-card forums__post forums__post--op">
            <header class="forums__post-head">
              <span class="forums__avatar" aria-hidden="true">${escapeHtml(initials(author))}</span>
              <span class="forums__byline">
                <strong class="forums__author">${escapeHtml(author)}</strong>
                <span class="ui-card__meta">${formatTime(selected.createdAt)}</span>
              </span>
              <span class="ui-badge ui-badge--accent">Original post</span>
            </header>
            <div class="forums__body">
              ${forumPostBodyHtml(opBody)}
            </div>
            <footer class="forums__post-actions">
              <button class="ui-button ui-button--primary" type="button" data-action="reply">Reply</button>
              <button class="ui-button ui-button--ghost" type="button" data-action="quote">Quote</button>
              <button class="ui-button ui-button--ghost forums__like" type="button" data-action="like" data-target="thread" aria-pressed="${opLiked}">${opLiked ? "Liked" : "Like"} <span class="forums__like-count">${opLikes}</span></button>
            </footer>
          </article>

          <section class="ui-stack">
            <h3 class="forums__heading">${replyCount} Repl${replyCount === 1 ? "y" : "ies"}</h3>
            <ol class="forums__replies">${repliesHtml}</ol>
            ${moreHtml}
          </section>

          <!-- Reply composer at the bottom of the thread. -->
          <form id="forum-reply-form" class="ui-panel" data-thread-id="${escapeHtml(selected.id)}" aria-labelledby="forum-reply-heading">
            <header class="ui-panel__header"><h3 id="forum-reply-heading" class="ui-panel__title">Post a Reply</h3></header>
            <div class="ui-panel__body ui-stack">
              ${target ? `<p class="forums__reply-target" data-reply-target="${escapeHtml(target.id)}">Replying to <strong>${escapeHtml(target.author || "Anonymous")}</strong> <button class="ui-button ui-button--ghost" type="button" data-action="reply-to-thread">Reply to the thread instead</button></p>` : ""}
              <div class="ui-field">
                <label class="ui-field__label" for="forum-reply-content">Your Reply</label>
                <textarea id="forum-reply-content" class="ui-input ui-textarea" rows="4" maxlength="4000" required placeholder="Write your reply..."></textarea>
              </div>
              <div class="forums__actions">
                <button type="submit" class="ui-button ui-button--primary">Post Reply</button>
              </div>
              <p id="forum-reply-status" class="ui-screen__meta" aria-live="polite"></p>
            </div>
          </form>
        </div>
      `;

      const newBox = detailBody.querySelector("#forum-reply-content");
      if (keptDraft && newBox && keptDraft.value) {
        newBox.value = keptDraft.value;
        if (keptDraft.focused) {
          newBox.focus({ preventScroll: true });
          newBox.setSelectionRange(keptDraft.start, keptDraft.end);
        }
      }

      const inlineBack = detailBody.querySelector("#forum-back-btn-inline");
      if (inlineBack) {
        inlineBack.addEventListener("click", () => {
          appState.forumsView = "overview";
          appState.selectedForumThreadId = null;
          renderForums(appState.data);
        });
      }

      // AB#995: the next page of replies. Bound once, like Like (Bug #1131).
      bindOnce(detailBody, "moreRepliesBound", "click", (event) => {
        if (event.target.closest('[data-action="more-replies"]')) loadReplies(true);
      });

      // Like buttons (delegated). Toggles a like for the current account on
      // either the OP thread or a specific reply. Server enforces one-like-
      // per-account by tracking `likedBy`, which it keeps to itself (Bug #1134).
      // Bug #1131: detailBody outlives its innerHTML, so the listener is added once, not on every render, and reads the
      // open thread when clicked (forumActions.js).
      bindOnce(detailBody, "likeBound", "click", async (event) => {
        const likeBtn = event.target.closest('[data-action="like"]');
        if (!likeBtn || likeBtn.disabled) return;
        if (!appState.accountId) {
          pushFeedback("Sign in to like posts.", "warn", { meaning: "refused", screen: "forums" }); // ISP-255c1 (AB#4830)
          return;
        }
        const request = likeRequest(likeBtn, appState.selectedForumThreadId);
        if (!request) return;
        likeBtn.disabled = true;
        try {
          const response = await apiFetch(request.path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.body)
          });
          const payload = await parseJsonResponse(response);
          putForumThread(payload?.thread);
          if (payload?.reply) updateReply(appState.selectedForumThreadId, payload.reply); // AB#995
          renderForums(appState.data);
        } catch (err) {
          likeBtn.disabled = false;
          pushFeedback(`Like failed: ${err.message}`, "warn", { meaning: commsMeaning(err), screen: "forums" }); // ISP-255c1 (AB#4830)
        }
      });

      // Bug #1132: Reply and Quote work on the reply box at the foot of the thread. Bound once, like Like (Bug #1131).
      bindOnce(detailBody, "composeBound", "click", (event) => {
        // AB#2466: back to answering the thread itself
        if (event.target.closest('[data-action="reply-to-thread"]')) {
          appState.forumReplyTo = null;
          renderForums(appState.data);
          return;
        }
        const btn = event.target.closest('[data-action="reply"], [data-action="quote"]');
        if (!btn) return;
        // AB#2466: Reply or Quote on a reply makes the new reply answer it (nested under it); on the thread, the thread
        const replyId = btn.dataset.replyId || null;
        const changed = (appState.forumReplyTo?.replyId || null) !== replyId;
        appState.forumReplyTo = replyId ? { threadId: appState.selectedForumThreadId, replyId } : null;
        if (changed) renderForums(appState.data); // shows "Replying to", keeping the draft (Bug #1222)
        const box = detailBody.querySelector("#forum-reply-content");
        const thread = threadById(appState.selectedForumThreadId);
        const post = postFor(btn, thread);
        if (!box || !post) return;
        box.value = btn.dataset.action === "quote" ? quoteDraft(box.value, post) : replyDraft(box.value, post);
        box.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
        box.focus({ preventScroll: true });
        box.setSelectionRange(box.value.length, box.value.length);
      });

      // Reply submission — POST to the server, then re-render with the
      // updated thread payload returned by the API.
      const replyForm = detailBody.querySelector("#forum-reply-form");
      if (replyForm) {
        replyForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const threadId = replyForm.dataset.threadId;
          const contentEl = replyForm.querySelector("#forum-reply-content");
          const statusEl = replyForm.querySelector("#forum-reply-status");
          const content = String(contentEl?.value || "").trim();
          if (!content) {
            if (statusEl) {
              setStatusLine(statusEl, "Reply cannot be empty.", { meaning: "refused", screen: "forums" }); // ISP-255c1 (AB#4830)
              statusEl.classList.add("forums__status--warn");
            }
            return;
          }
          const submitBtn = replyForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          try {
            const replyToId = appState.forumReplyTo?.threadId === threadId ? appState.forumReplyTo.replyId : null; // AB#2466
            const response = await apiFetch(`/api/forums/threads/${encodeURIComponent(threadId)}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(replyToId ? { content, replyToId } : { content })
            });
            const payload = await parseJsonResponse(response);
            // The thread's summary and the new reply, shown now rather than waiting for the socket broadcast.
            putForumThread(payload?.thread);
            addReply(threadId, payload?.reply); // AB#995: at the end, once the reader has the replies before it
            // Bug #1222: clear the box on the page now, not contentEl: if the socket update re-rendered the thread first,
            // contentEl is the old, detached box and the sent text would come back as a kept draft.
            const liveBox = document.getElementById("forum-reply-content");
            if (liveBox) liveBox.value = "";
            appState.forumReplyTo = null; // AB#2466: the next reply answers the thread, until the player picks another
            renderForums(appState.data);
            if (open.nextCursor) pushFeedback("Reply posted. It is at the end of the thread: load more replies to see it.", "info", { meaning: "complete", screen: "forums" }); // ISP-255c1 (AB#4830)
          } catch (err) {
            if (statusEl) {
              setStatusLine(statusEl, `Failed to post reply: ${err.message}`, { meaning: commsMeaning(err), screen: "forums" }); // ISP-255c1 (AB#4830)
              statusEl.classList.add("forums__status--warn");
            }
          } finally {
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }
    }
    return;
  }

  // Overview view
  if (overviewView) overviewView.hidden = false;
  if (threadView) threadView.hidden = true;

  const categoriesEl = document.getElementById("forum-categories");
  if (categoriesEl) {
    // ISP-81 (AB#770): the categories are the design system's tabs over the thread list.
    const tab = (value, label) =>
      `<button class="ui-tab" type="button" role="tab" aria-selected="${(appState.selectedForumCategory || "") === value}" data-category="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    categoriesEl.innerHTML = tab("", "All") + (data.forums?.categories || []).map((cat) => tab(cat, cat)).join("");
  }

  // AB#995: the open category's threads, a page at a time
  const key = appState.selectedForumCategory || "";
  if (list.key !== key) loadThreads();
  const shown = list.key === key ? list.ids.map(threadById).filter(Boolean) : [];

  const threadsEl = document.getElementById("forum-threads");
  if (threadsEl) {
    if (!shown.length) {
      threadsEl.innerHTML = list.loading || list.key !== key
        ? `<p class="forums__note">Loading threads…</p>`
        : list.error
          ? `<p class="forums__note">The threads could not be loaded: ${escapeHtml(list.error)} ${protocolLineHtml({ meaning: "failed", screen: "forums" })}</p>`
          : `<p class="forums__note">No threads in this category yet.</p>`;
    } else {
      threadsEl.innerHTML = shown
        .map((thread) => {
          const replyCount = Number(thread.replyCount) || 0; // AB#995: counted by the server
          const lastActivity = Number(thread.lastPostAt) || Number(thread.createdAt) || 0;
          const excerpt = String(thread.body || "").slice(0, 240);
          return `
          <button class="ui-card ui-card--interactive forums__thread-card" type="button" data-thread-id="${escapeHtml(thread.id)}">
            <span class="forums__thread-head">
              <span class="ui-badge">${escapeHtml(thread.category)}</span>
              <span class="ui-card__meta">${Number(thread.likes) || 0} ${Number(thread.likes) === 1 ? "like" : "likes"}</span>
            </span>
            <span class="ui-card__title">${escapeHtml(thread.title)}</span>
            ${excerpt ? `<span class="ui-card__body forums__excerpt">${escapeHtml(excerpt)}</span>` : ""}
            <span class="ui-card__meta forums__thread-meta">
              <span>Started by <strong>${escapeHtml(thread.author)}</strong></span>
              <span>${replyCount} ${replyCount === 1 ? "reply" : "replies"}</span>
              ${lastActivity ? `<span class="forums__last">Last post · ${formatTime(lastActivity)}</span>` : ""}
            </span>
          </button>`;
        })
        .join("") + (list.nextCursor
        ? `<div class="forums__more"><button class="ui-button ui-button--secondary" type="button" data-action="more-threads"${list.loading ? " disabled" : ""}>${list.loading ? "Loading…" : "Load more threads"}</button></div>`
        : "");
    }
  }

  // Populate the new-thread category dropdown with the same allowlist used
  // server-side, then bind the form/button (idempotent — guarded via dataset
  // flag so re-renders don't stack listeners).
  const categories = data.forums?.categories || [];
  const categorySelect = document.getElementById("forum-new-thread-category");
  if (categorySelect) {
    const preselected = appState.selectedForumCategory || categories[0] || "";
    categorySelect.innerHTML = categories
      .map((c) => `<option value="${escapeHtml(c)}"${c === preselected ? " selected" : ""}>${escapeHtml(c)}</option>`)
      .join("");
  }

  const newThreadBtn = document.getElementById("forum-new-thread-btn");
  const newThreadForm = document.getElementById("forum-new-thread-form");
  const cancelBtn = document.getElementById("forum-new-thread-cancel");
  if (newThreadBtn && newThreadForm && !newThreadBtn.dataset.bound) {
    newThreadBtn.dataset.bound = "1";
    newThreadBtn.addEventListener("click", () => {
      newThreadForm.hidden = !newThreadForm.hidden;
      if (!newThreadForm.hidden) {
        newThreadForm.querySelector("#forum-new-thread-title")?.focus();
      }
    });
    cancelBtn?.addEventListener("click", () => {
      newThreadForm.hidden = true;
      newThreadForm.reset();
    });
    newThreadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const category = String(document.getElementById("forum-new-thread-category")?.value || "").trim();
      const title = String(document.getElementById("forum-new-thread-title")?.value || "").trim();
      const body = String(document.getElementById("forum-new-thread-body")?.value || "").trim();
      const statusEl = document.getElementById("forum-new-thread-status");
      if (!category || !title || !body) {
        if (statusEl) {
          setStatusLine(statusEl, "Category, title, and body are all required.", { meaning: "refused", screen: "forums" }); // ISP-255c1 (AB#4830)
          statusEl.classList.add("forums__status--warn");
        }
        return;
      }
      const submitBtn = newThreadForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const response = await apiFetch("/api/forums/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category, title, body })
        });
        const payload = await parseJsonResponse(response);
        // Bug #1133: the forums:updated broadcast usually lands first with this thread already in it.
        applyForumsEvent({ kind: "thread", thread: payload?.thread }); // AB#995: at the top of the list it belongs to
        newThreadForm.reset();
        newThreadForm.hidden = true;
        if (statusEl) statusEl.textContent = "";
        renderForums(appState.data);
      } catch (err) {
        if (statusEl) {
          setStatusLine(statusEl, `Failed to post thread: ${err.message}`, { meaning: commsMeaning(err), screen: "forums" }); // ISP-255c1 (AB#4830)
          statusEl.classList.add("forums__status--warn");
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

/** Forums: categories, recent threads, back, and opening a thread. */
export function bindForumForms() {
  const forumThreadListEl = document.getElementById("forum-threads");
  const forumCategoriesEl = document.getElementById("forum-categories");
  const forumRecentBtn = document.getElementById("forum-recent-btn");
  const forumBackBtn = document.getElementById("forum-back-btn");

  forumCategoriesEl?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-category]");
    if (!btn) return;
    appState.selectedForumCategory = btn.getAttribute("data-category") || null;
    renderForums(appState.data);
  });

  forumRecentBtn?.addEventListener("click", () => {
    appState.selectedForumCategory = null;
    renderForums(appState.data);
  });

  forumBackBtn?.addEventListener("click", () => {
    appState.forumsView = "overview";
    renderForums(appState.data);
  });

  forumThreadListEl?.addEventListener("click", (event) => {
    // AB#995: the next page of threads
    if (event.target.closest('[data-action="more-threads"]')) {
      loadThreads(true);
      return;
    }
    const trigger = event.target.closest("[data-thread-id]");
    if (!trigger) return;
    appState.selectedForumThreadId = trigger.getAttribute("data-thread-id");
    appState.forumsView = "thread";
    renderForums(appState.data);
  });
}
