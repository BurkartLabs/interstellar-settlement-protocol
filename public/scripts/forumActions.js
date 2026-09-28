// Forum thread actions, kept out of app.js so they can be tested without a DOM.
//
// Bug #1131: renderForums replaced the thread view's innerHTML on every refresh but added a new click listener to the
// container each time, and the container itself survives. After n refreshes one click on Like sent n requests, each
// a toggle, so it liked, unliked or liked again by the parity of n. Each stale listener also held the thread that was
// open when it was added.

/**
 * Add `handler` for `type` to `element` once, however often this is called: the element carries a marker named by
 * `key`. For containers that outlive their innerHTML.
 */
export function bindOnce(element, key, type, handler) {
  if (!element || element.dataset[key]) return false;
  element.dataset[key] = "1";
  element.addEventListener(type, handler);
  return true;
}

/**
 * The like request a Like button stands for, in the thread open now (read at click time, never captured at render
 * time): { path, body }. The reply's id comes from the button; no account id is sent (Bug #1134).
 */
export function likeRequest(button, openThreadId) {
  if (!openThreadId) return null;
  const replyId = button.getAttribute("data-target") === "reply" ? button.getAttribute("data-reply-id") : null;
  return {
    path: `/api/forums/threads/${encodeURIComponent(openThreadId)}/like`,
    body: replyId ? { replyId } : {}
  };
}

// Bug #1132: Reply and Quote on a forum post had no handler. Both work on the reply box at the foot of the thread;
// replies are flat, so a reply to a reply names who it answers.
export const REPLY_MAX_LENGTH = 4000; // the reply textarea's maxlength and the server's cut

/** The post a Reply or Quote button belongs to, in the open thread: the thread itself, or one of its replies. */
export function postFor(button, thread) {
  if (!thread) return null;
  const replyId = button.getAttribute("data-reply-id");
  if (!replyId) return { author: thread.author, text: thread.body || thread.summary || "", isReply: false };
  const reply = (thread.replies || []).find((r) => r.id === replyId);
  return reply ? { author: reply.author, text: reply.content || "", isReply: true } : null;
}

/** "@Author " to start a reply to a reply, when the box is empty; the box as it is otherwise. */
export function replyDraft(existing, post) {
  if (String(existing || "").trim() || !post?.isReply || !post.author) return existing || "";
  return `@${post.author} `;
}

/**
 * The reply box with a quote of `post` added: "> Author wrote:" and its first `maxLines` lines, each prefixed "> ",
 * cut at `maxChars` with an ellipsis, then a blank line to write under. Kept within the reply limit.
 */
export function quoteDraft(existing, post, { maxLines = 4, maxChars = 300 } = {}) {
  const author = post?.author || "A corporation";
  let text = String(post?.text || "").trim();
  if (text.length > maxChars) text = `${text.slice(0, maxChars).trimEnd()}…`;
  let lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]} …`];
  const quote = [`> ${author} wrote:`, ...lines.map((l) => `> ${l}`)].join("\n");
  const before = String(existing || "").replace(/\s+$/, "");
  return `${before ? `${before}\n\n` : ""}${quote}\n\n`.slice(0, REPLY_MAX_LENGTH);
}

// Bug #1133: a new thread arrives twice, in the POST response and in the forums:updated broadcast, which the server
// sends first. The response path added it with unshift even when the broadcast had already put it in the list, so the
// poster saw it twice until a reload. Every path that puts one thread into the list goes through this, keyed by id.

/** `threads` with `thread` in it once: replacing the copy with the same id where it is, or at the top if new. */
/** AB#2466: how deep a reply indents; deeper ones stay nested, and keep this indent, so a long exchange fits a phone. */
export const INDENT_MAX_DEPTH = 5;

/**
 * AB#2466: a thread's replies as a tree, each under the reply it answers, to any depth the data holds: [{ reply,
 * depth, children }], each level in posting order. A reply that answers none, or one no longer in the thread, is a
 * reply to the thread; a loop in the data (which the server never writes) cannot nest a reply under itself.
 */
export function replyTree(replies) {
  const list = Array.isArray(replies) ? replies : [];
  const ids = new Set(list.map((r) => r?.id));
  const byParent = new Map();
  for (const r of list) {
    const parent = r?.replyToId && ids.has(r.replyToId) && r.replyToId !== r.id ? r.replyToId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(r);
  }
  const seen = new Set();
  const grow = (parent, depth) => (byParent.get(parent) || []).filter((r) => !seen.has(r.id)).map((reply) => {
    seen.add(reply.id);
    return { reply, depth, children: grow(reply.id, depth + 1) };
  });
  const roots = grow(null, 0);
  // what a loop left unplaced is shown as a reply to the thread, never lost
  for (const r of list) if (!seen.has(r.id)) { seen.add(r.id); roots.push({ reply: r, depth: 0, children: grow(r.id, 1) }); }
  return roots;
}

export function mergeThread(threads, thread) {
  const list = Array.isArray(threads) ? threads.filter((t) => t) : [];
  if (!thread?.id) return list;
  const at = list.findIndex((t) => t.id === thread.id);
  if (at >= 0) return list.map((t, i) => (i === at ? thread : t));
  return [thread, ...list];
}
