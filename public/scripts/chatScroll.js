// Where the chat log sits after it is redrawn (Bug #1135).
//
// The log is rebuilt whole on every new line, send and channel switch. It used to keep whatever scroll position the
// browser left, and only the player's own send (and only when already at the bottom) moved it: a line from someone
// else arrived below the view, and a channel opened on its oldest line. Now the log follows the conversation the way
// chat does elsewhere: it stays at the newest line if the player was there, jumps to it on a channel switch or their
// own line, and otherwise leaves a player who scrolled up to read where they were.

/** How close to the bottom still counts as "at the newest line", in pixels: about one line of chat. */
export const CHAT_BOTTOM_SLACK = 24;

/** Whether a scrolled box is showing its last line. A box with nothing to scroll (or hidden) counts as at the bottom. */
export function isAtBottom({ scrollHeight, scrollTop, clientHeight }, slack = CHAT_BOTTOM_SLACK) {
  return scrollHeight - scrollTop - clientHeight <= slack;
}

/**
 * The scrollTop to set after redrawing. `before` is { scrollHeight, scrollTop, clientHeight } measured before the
 * redraw; `afterScrollHeight` is the new scrollHeight; `channelChanged` and `ownLine` are why it was redrawn.
 */
export function chatScrollTop({ before, afterScrollHeight, channelChanged = false, ownLine = false }) {
  if (channelChanged || ownLine || isAtBottom(before)) return afterScrollHeight;
  return before.scrollTop;
}
