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
