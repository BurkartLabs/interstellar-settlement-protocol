// The Forums tab: categories, threads and replies.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { bindOnce, likeRequest, mergeThread, postFor, quoteDraft, replyDraft } from "../forumActions.js";
import { formatTime } from "../helpers.js";
import { escapeHtml, forumPostBodyHtml } from "../html.js";
import { appState } from "../state.js";
import { pushFeedback } from "./shared.js";
import { scrollBehavior } from "../motion.js"; // AB#1760

/**
 * Bug #1133: the one way a thread from a response enters the client's forums, once, by id (mergeThread). Both copies
 * are updated: updateAllViews copies serverData.forums over data.forums, so a thread added to data alone vanished.
 */
export function putForumThread(thread) {
  if (!thread?.id || !appState.data) return;
  for (const holder of [appState.data, appState.serverData]) {
    if (!holder) continue;
    if (!holder.forums) holder.forums = { categories: [], threads: [] };
    holder.forums.threads = mergeThread(holder.forums.threads, thread);
  }
}

export function renderForums(data) {
  const overviewView = document.getElementById("forum-overview-view");
  const threadView = document.getElementById("forum-thread-view");

  if (appState.forumsView === "thread") {
    if (overviewView) overviewView.hidden = true;
    if (threadView) threadView.hidden = false;

    const selected = (data.forums?.threads || []).find((t) => t.id === appState.selectedForumThreadId);
    const detailBody = document.getElementById("forum-thread-detail-body");
    if (detailBody && selected) {
      const author = selected.author || "Anonymous";
      const opLikes = Number(selected.likes) || 0;
      const replies = Array.isArray(selected.replies) ? selected.replies : [];
      const myAccountId = appState.accountId || null;
      const opLiked = Boolean(myAccountId && selected.likedByMe); // the server says only whether this account liked it (Bug #1134)
      const initials = (str) => String(str || "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase() || "?";
      const avatarHue = (str) => {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
        return h;
      };
      const opHue = avatarHue(author);
      const opBody = selected.body
        || selected.summary
        || `Filing this thread to consolidate strategy on predatory mineral leases. Recent ISA arbitration cases suggest a narrow window for procedural objections — particularly when the lessor has failed to publish quarterly extraction reports. Would appreciate input from any corporation that has successfully challenged a Tier-2 lease auction in the last 18 months. I am compiling a citation pack for the Sol jurisdiction sub-forum and will share the redacted draft with anyone willing to co-sign.`;

      const repliesHtml = replies.length
        ? replies.map((reply) => {
            const author = reply.author || "Anonymous";
            const hue = avatarHue(author);
            const replyLiked = Boolean(myAccountId && reply.likedByMe);
            return `
              <li class="thread-reply">
                <div class="thread-reply__connector" aria-hidden="true"></div>
                <article class="thread-card thread-card--reply">
                  <header class="thread-card__head">
                    <div class="thread-avatar" style="--avatar-hue:${hue};">${escapeHtml(initials(author))}</div>
                    <div class="thread-card__head-meta">
                      <span class="thread-card__author">${escapeHtml(author)}</span>
                      <span class="thread-card__timestamp">${formatTime(reply.createdAt)}</span>
                    </div>
                    <span class="thread-badge thread-badge--reply">Reply</span>
                  </header>
                  <div class="thread-card__body">
                    ${forumPostBodyHtml(reply.content || "")}
                  </div>
                  <footer class="thread-card__actions">
                    <button class="thread-action-btn" type="button" data-action="reply" data-reply-id="${escapeHtml(reply.id)}">↩ Reply</button>
                    <button class="thread-action-btn" type="button" data-action="quote" data-reply-id="${escapeHtml(reply.id)}">❝ Quote</button>
                    <button class="thread-action-btn thread-action-btn--like${replyLiked ? " is-liked" : ""}" type="button" data-action="like" data-target="reply" data-reply-id="${escapeHtml(reply.id)}" aria-pressed="${replyLiked}">▲ ${replyLiked ? "Liked" : "Like"} <span class="thread-action-count">${Number(reply.likes) || 0}</span></button>
                  </footer>
                </article>
              </li>`;
          }).join("")
        : `<li class="thread-reply thread-reply--empty"><p class="muted">No replies yet. Be the first to weigh in.</p></li>`;

      // Bug #1222: the reply box is part of this HTML, so a re-render (any forum update) emptied a half-written reply.
      // Keep what is in it, where the cursor is and whether it had focus, for the same thread, and put them back below.
      const oldBox = detailBody.querySelector("#forum-reply-content");
      const keptDraft = oldBox && oldBox.closest("form")?.dataset.threadId === selected.id
        ? { value: oldBox.value, start: oldBox.selectionStart, end: oldBox.selectionEnd, focused: document.activeElement === oldBox }
        : null;
      detailBody.innerHTML = `
        <div class="thread-detail">
          <div class="thread-detail__topbar">
            <button id="forum-back-btn-inline" class="thread-back-btn" type="button">← Back to Forums</button>
            <span class="thread-badge thread-badge--category">${escapeHtml((selected.category || "general").toUpperCase())}</span>
          </div>

          <header class="thread-detail__header">
            <h1 class="thread-detail__title">${escapeHtml(selected.title || "Untitled Thread")}</h1>
            <div class="thread-detail__meta">
              <span>Started ${formatTime(selected.createdAt)}</span>
              <span class="thread-meta-dot">•</span>
              <span>${replies.length} repl${replies.length === 1 ? "y" : "ies"}</span>
              <span class="thread-meta-dot">•</span>
              <span>${opLikes} like${opLikes === 1 ? "" : "s"}</span>
            </div>
          </header>

          <article class="thread-card thread-card--op">
            <div class="thread-card__op-tag">Original Post</div>
            <header class="thread-card__head">
              <div class="thread-avatar thread-avatar--op" style="--avatar-hue:${opHue};">${escapeHtml(initials(author))}</div>
              <div class="thread-card__head-meta">
                <span class="thread-card__author">${escapeHtml(author)}</span>
                <span class="thread-card__timestamp">${formatTime(selected.createdAt)}</span>
              </div>
              <span class="thread-badge thread-badge--op">OP</span>
            </header>
            <div class="thread-card__body thread-card__body--op">
              ${forumPostBodyHtml(opBody)}
            </div>
            <footer class="thread-card__actions">
              <button class="thread-action-btn thread-action-btn--primary" type="button" data-action="reply">↩ Reply</button>
              <button class="thread-action-btn" type="button" data-action="quote">❝ Quote</button>
              <button class="thread-action-btn thread-action-btn--like${opLiked ? " is-liked" : ""}" type="button" data-action="like" data-target="thread" aria-pressed="${opLiked}">▲ ${opLiked ? "Liked" : "Like"} <span class="thread-action-count">${opLikes}</span></button>
            </footer>
          </article>

          <section class="thread-replies">
            <h2 class="thread-replies__heading">${replies.length} Repl${replies.length === 1 ? "y" : "ies"}</h2>
            <ol class="thread-reply-list">${repliesHtml}</ol>
          </section>

          <!-- Reply composer at the bottom of the thread. -->
          <form id="forum-reply-form" class="form-card" data-thread-id="${escapeHtml(selected.id)}">
            <h3>Post a Reply</h3>
            <label>
              <span>Your Reply</span>
              <textarea id="forum-reply-content" rows="4" maxlength="4000" required placeholder="Write your reply..."></textarea>
            </label>
            <div class="form-actions">
              <button type="submit" class="btn btn-accent">Post Reply</button>
            </div>
            <p id="forum-reply-status" class="muted"></p>
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

      // Like buttons (delegated). Toggles a like for the current account on
      // either the OP thread or a specific reply. Server enforces one-like-
      // per-account by tracking `likedBy`, which it keeps to itself (Bug #1134).
      // Bug #1131: detailBody outlives its innerHTML, so the listener is added once, not on every render, and reads the
      // open thread when clicked (forumActions.js).
      bindOnce(detailBody, "likeBound", "click", async (event) => {
        const likeBtn = event.target.closest('[data-action="like"]');
        if (!likeBtn || likeBtn.disabled) return;
        if (!appState.accountId) {
          pushFeedback("Sign in to like posts.", "warn");
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
          renderForums(appState.data);
        } catch (err) {
          likeBtn.disabled = false;
          pushFeedback(`Like failed: ${err.message}`, "warn");
        }
      });

      // Bug #1132: Reply and Quote work on the reply box at the foot of the thread. Bound once, like Like (Bug #1131).
      bindOnce(detailBody, "composeBound", "click", (event) => {
        const btn = event.target.closest('[data-action="reply"], [data-action="quote"]');
        if (!btn) return;
        const box = detailBody.querySelector("#forum-reply-content");
        const thread = (appState.data?.forums?.threads || []).find((t) => t.id === appState.selectedForumThreadId);
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
              statusEl.textContent = "Reply cannot be empty.";
              statusEl.style.color = "var(--color-warn)";
            }
            return;
          }
          const submitBtn = replyForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          try {
            const response = await apiFetch(`/api/forums/threads/${encodeURIComponent(threadId)}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content })
            });
            const payload = await parseJsonResponse(response);
            // Splice the updated thread into the local cache so re-render
            // shows the new reply immediately (the socket broadcast will
            // also fire, but we don't want to wait for it).
            putForumThread(payload?.thread);
            // Bug #1222: clear the box on the page now, not contentEl: if the socket update re-rendered the thread first,
            // contentEl is the old, detached box and the sent text would come back as a kept draft.
            const liveBox = document.getElementById("forum-reply-content");
            if (liveBox) liveBox.value = "";
            renderForums(appState.data);
          } catch (err) {
            if (statusEl) {
              statusEl.textContent = `Failed to post reply: ${err.message}`;
              statusEl.style.color = "var(--color-warn)";
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
    categoriesEl.innerHTML =
      `<button class="forum-category-btn${!appState.selectedForumCategory ? " active" : ""}" type="button" data-category="">All</button>` +
      (data.forums?.categories || [])
        .map(
          (cat) =>
            `<button class="forum-category-btn${appState.selectedForumCategory === cat ? " active" : ""}" type="button" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
        )
        .join("");
  }

  const filtered = appState.selectedForumCategory
    ? (data.forums?.threads || []).filter((t) => t.category === appState.selectedForumCategory)
    : (data.forums?.threads || []);

  const threadsEl = document.getElementById("forum-threads");
  if (threadsEl) {
    if (!filtered.length) {
      threadsEl.innerHTML = `<p class="muted">No threads in this category yet.</p>`;
    } else {
      threadsEl.innerHTML = filtered
        .map((thread) => {
          const replies = Array.isArray(thread.replies) ? thread.replies : [];
          const lastActivity = replies.length
            ? Math.max(...replies.map((r) => Number(r.createdAt) || 0), Number(thread.createdAt) || 0)
            : Number(thread.createdAt) || 0;
          const lastAuthor = replies.length ? replies[replies.length - 1]?.author : thread.author;
          const excerpt = String(thread.body || replies[0]?.body || "").slice(0, 240);
          return `
          <button class="forum-thread-card" type="button" data-thread-id="${escapeHtml(thread.id)}">
            <div class="forum-thread-card__head">
              <span class="forum-thread-card__category">${escapeHtml(thread.category)}</span>
              <span class="forum-thread-card__stat" title="Likes">▲ ${Number(thread.likes) || 0}</span>
            </div>
            <h3 class="forum-thread-card__title">${escapeHtml(thread.title)}</h3>
            ${excerpt ? `<p class="forum-thread-card__excerpt">${escapeHtml(excerpt)}</p>` : ""}
            <div class="forum-thread-card__meta">
              <span>Started by <strong>${escapeHtml(thread.author)}</strong></span>
              <span class="forum-thread-card__stat">💬 ${replies.length} ${replies.length === 1 ? "reply" : "replies"}</span>
              ${lastActivity ? `<span style="margin-left:auto">Last by <strong>${escapeHtml(lastAuthor || thread.author)}</strong> · ${formatTime(lastActivity)}</span>` : ""}
            </div>
          </button>`;
        })
        .join("");
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
          statusEl.textContent = "Category, title, and body are all required.";
          statusEl.style.color = "var(--color-warn)";
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
        putForumThread(payload?.thread);
        newThreadForm.reset();
        newThreadForm.hidden = true;
        if (statusEl) statusEl.textContent = "";
        renderForums(appState.data);
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = `Failed to post thread: ${err.message}`;
          statusEl.style.color = "var(--color-warn)";
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
    const trigger = event.target.closest("[data-thread-id]");
    if (!trigger) return;
    appState.selectedForumThreadId = trigger.getAttribute("data-thread-id");
    appState.forumsView = "thread";
    renderForums(appState.data);
  });
}
