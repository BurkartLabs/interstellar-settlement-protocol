// server/routes/forums.js: the forums routes, split out of server/index.js (AB#1815).
import { postView, threadView, UNNAMED_CORPORATION } from "../publicViews.js";
import { getAccountById, getState, mutateState } from "../gameState.js";
import { requireAuth } from "../auth.js";
import { emitForumsUpdated } from "../realtime.js";

export function registerForumRoutes(app) {
  // ─── Forums ──────────────────────────────────────────────────────────────────
  // Player-authored corporate forum threads & replies. Stored on the global
  // state.json under `forums.threads`, broadcast via socket so every connected
  // client sees new posts immediately.
  app.post("/api/forums/threads", requireAuth, (req, res) => { // AB#958: limited per account in server/index.js
    const { category, title, body } = req.body ?? {};
    const trimmedCategory = String(category || "").trim();
    const trimmedTitle = String(title || "").trim().slice(0, 200);
    const trimmedBody = String(body || "").trim().slice(0, 8000);
    if (!trimmedCategory || !trimmedTitle || !trimmedBody) {
      res.status(400).json({ error: "category, title, and body are required." });
      return;
    }

    const account = getAccountById(req.auth.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    const author = String(account.state?.corp?.corporationName || "").trim() || UNNAMED_CORPORATION; // never the email (Bug #1134)

    // Validate the category against the global allowlist before mutating.
    const currentForums = getState().forums || {};
    if (Array.isArray(currentForums.categories) && currentForums.categories.length
        && !currentForums.categories.includes(trimmedCategory)) {
      res.status(400).json({ error: "Unknown forum category." });
      return;
    }

    const newThread = {
      id: `thr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category: trimmedCategory,
      title: trimmedTitle,
      author,
      authorAccountId: account.id,
      body: trimmedBody,
      likes: 0,
      createdAt: Date.now(),
      replies: []
    };

    const updated = mutateState((draft) => {
      if (!draft.forums || typeof draft.forums !== "object") draft.forums = { categories: [], threads: [] };
      if (!Array.isArray(draft.forums.threads)) draft.forums.threads = [];
      draft.forums.threads.unshift(newThread);
    });

    emitForumsUpdated(updated.forums);
    res.json({ thread: threadView(newThread, account.id) });
  });

  app.post("/api/forums/threads/:threadId/replies", requireAuth, (req, res) => {
    const content = String(req.body?.content || "").trim().slice(0, 4000);
    if (!content) {
      res.status(400).json({ error: "Reply content is required." });
      return;
    }

    const account = getAccountById(req.auth.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    const author = String(account.state?.corp?.corporationName || "").trim() || UNNAMED_CORPORATION; // never the email (Bug #1134)
    // AB#2466: the reply it answers, when it answers one: a reply already in this thread, or refused with nothing written
    const replyToId = typeof req.body?.replyToId === "string" && req.body.replyToId.trim() ? req.body.replyToId.trim() : null;

    const reply = {
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      author,
      authorAccountId: account.id,
      content,
      likes: 0,
      createdAt: Date.now(),
      ...(replyToId ? { replyToId } : {})
    };

    let foundThread = null;
    let unknownParent = false;
    const updated = mutateState((draft) => {
      const thread = (draft.forums?.threads || []).find((t) => t.id === req.params.threadId);
      if (!thread) return;
      if (!Array.isArray(thread.replies)) thread.replies = [];
      if (replyToId && !thread.replies.some((r) => r.id === replyToId)) { unknownParent = true; return; }
      thread.replies.push(reply);
      foundThread = thread;
    });

    if (unknownParent) {
      res.status(400).json({ error: "That reply is not in this thread." });
      return;
    }
    if (!foundThread) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }

    emitForumsUpdated(updated.forums);
    res.json({ reply: postView(reply, account.id), thread: threadView(foundThread, account.id) });
  });

  // Toggle a like on a thread or reply. Tracks `likedBy` (account IDs) so each
  // account can only like once; clicking again unlikes. `likes` is always
  // derived from `likedBy.length` to stay consistent. `likedBy` never leaves the
  // server: clients get `likedByMe` (Bug #1134).
  app.post("/api/forums/threads/:threadId/like", requireAuth, (req, res) => {
    const replyId = req.body?.replyId ? String(req.body.replyId) : null;
    const accountId = req.auth.accountId;

    let result = null;
    let foundThread = null;
    const updated = mutateState((draft) => {
      const thread = (draft.forums?.threads || []).find((t) => t.id === req.params.threadId);
      if (!thread) return;
      foundThread = thread;

      const target = replyId
        ? (Array.isArray(thread.replies) ? thread.replies.find((r) => r.id === replyId) : null)
        : thread;
      if (!target) {
        result = { error: "not-found" };
        return;
      }
      if (!Array.isArray(target.likedBy)) target.likedBy = [];
      const idx = target.likedBy.indexOf(accountId);
      if (idx >= 0) {
        target.likedBy.splice(idx, 1);
      } else {
        target.likedBy.push(accountId);
      }
      target.likes = target.likedBy.length;
      result = { likes: target.likes, liked: idx < 0 };
    });

    if (!foundThread) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    if (result?.error === "not-found") {
      res.status(404).json({ error: "Reply not found." });
      return;
    }

    emitForumsUpdated(updated.forums);
    res.json({ ...result, thread: threadView(foundThread, accountId) });
  });
}
