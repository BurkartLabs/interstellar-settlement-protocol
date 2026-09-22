import { describe, it, expect } from "vitest";
import { isAtBottom, chatScrollTop, CHAT_BOTTOM_SLACK } from "../../public/scripts/chatScroll.js";

// Bug #1135: the chat log follows the conversation. Numbers are the ones the AB#725 sweep measured: a log whose
// bottom was at scrollTop 4452 grew to 4512 when a line arrived, and the view stayed at 4452.
const atBottom = { scrollHeight: 4852, scrollTop: 4452, clientHeight: 400 };
const readingHistory = { scrollHeight: 4852, scrollTop: 1200, clientHeight: 400 };

describe("chat scroll (Bug #1135)", () => {
  it("a line from someone else follows the player who was at the newest line", () => {
    expect(chatScrollTop({ before: atBottom, afterScrollHeight: 4912 })).toBe(4912);
  });

  it("a player who scrolled up to read keeps their place when a line arrives", () => {
    expect(chatScrollTop({ before: readingHistory, afterScrollHeight: 4912 })).toBe(1200);
  });

  it("a channel switch opens on the newest line, not the oldest", () => {
    expect(chatScrollTop({ before: readingHistory, afterScrollHeight: 3000, channelChanged: true })).toBe(3000);
  });

  it("the player's own line is always shown", () => {
    expect(chatScrollTop({ before: readingHistory, afterScrollHeight: 4912, ownLine: true })).toBe(4912);
  });

  it("within about a line of the bottom still counts as at the bottom; a hidden or short log does too", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 600 - CHAT_BOTTOM_SLACK, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 600 - CHAT_BOTTOM_SLACK - 1, clientHeight: 400 })).toBe(false);
    expect(isAtBottom({ scrollHeight: 0, scrollTop: 0, clientHeight: 0 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true);
  });
});
