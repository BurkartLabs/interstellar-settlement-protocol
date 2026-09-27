// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// AB#911: the Inbox's conversations. A thread with 500 messages opens on its latest page only, loads older pages as
// the player scrolls up, and ends holding every message exactly once; message text renders as text, never HTML.

// A server with one 500-message conversation, paging exactly as AB#910's routes do: newest first, the cursor is the
// last id returned, `limit` capped at 100.
const THREAD = Array.from({ length: 500 }, (_, i) => ({
  id: `m_${String(i).padStart(13, "0")}abcdef`, conversationId: "cv_test", fromCorpId: i % 2 ? "corp-b" : "corp-a",
  fromName: i % 2 ? "Beta" : "Alpha", mine: i % 2 === 0, body: `message ${i}`, sentAt: 1_790_000_000_000 + i * 1000
}));
const requests = [];
vi.mock("../../public/scripts/apiClient.js", () => ({
  apiFetch: vi.fn(async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET" });
    const u = new URL(url, "http://x");
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname.endsWith("/read")) return json({ conversation: { id: "cv_test", unread: 0 } });
    if (u.pathname.endsWith("/messages")) {
      const limit = Math.min(Number(u.searchParams.get("limit") || 50), 100);
      const cursor = u.searchParams.get("cursor");
      const upto = cursor ? THREAD.findIndex((m) => m.id >= cursor) : THREAD.length;
      const from = Math.max(0, upto - limit);
      const page = THREAD.slice(from, upto).reverse();
      return json({ conversation: { id: "cv_test", with: { publicId: "corp-b", corporationName: "Beta" }, unread: 3 }, messages: page, nextCursor: from > 0 ? page[page.length - 1].id : null });
    }
    return json({ conversations: [{ id: "cv_test", with: { publicId: "corp-b", corporationName: "Beta" }, lastMessage: "message 499", lastMessageAt: 1, unread: 3, messageCount: 500 }], nextCursor: null, unreadTotal: 3 });
  })
}));

const view = await import("../../public/scripts/views/conversations.js");
const { appState } = await import("../../public/scripts/state.js");

function mountThread() {
  document.body.innerHTML = `<div id="inbox-thread-view"><h3 id="thread-title"></h3>
    <div id="thread-scroll"><p id="thread-older-status"></p><ul id="thread-messages"></ul></div>
    <p id="thread-status"></p></div>`;
  // jsdom has no layout: give the scroller a height, and a content height that grows with what is rendered.
  const el = document.getElementById("thread-scroll");
  Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(el, "scrollHeight", { get: () => 60 * document.querySelectorAll("#thread-messages li").length, configurable: true });
  return el;
}
const rendered = () => [...document.querySelectorAll("#thread-messages li")].map((li) => li.dataset.messageId);

beforeEach(() => {
  requests.length = 0;
  appState.accountId = "acct-a";
  view.setConversationHooks({ show: () => {}, onChange: () => {}, formatDate: () => "27 Sep" });
});

describe("a thread of 500 messages (AB#911)", () => {
  it("opens on the latest page only, then loads older pages on scroll with no duplicate or missing message", async () => {
    const el = mountThread();
    await view.loadConversations();
    await view.openConversation("cv_test");
    expect(rendered()).toEqual(THREAD.slice(450).map((m) => m.id)); // the latest 50, oldest at the top
    expect(requests.filter((r) => r.url.includes("/messages"))).toHaveLength(1);

    let pages = 1;
    while (view.convState.open.nextCursor) {
      el.scrollTop = 10; // near the top: what a player scrolling up does
      view.onThreadScroll({ target: el });
      await vi.waitFor(() => expect(view.convState.open.loading).toBe(false));
      await new Promise((r) => setTimeout(r, 0));
      pages++;
      if (pages > 20) throw new Error("did not reach the start");
    }
    const ids = rendered();
    expect(ids).toEqual(THREAD.map((m) => m.id));
    expect(new Set(ids).size).toBe(500);
    expect(document.getElementById("thread-older-status").textContent).toBe("The start of this conversation");
  });

  it("marks the conversation read when it opens, and the unread total drops", async () => {
    mountThread();
    await view.loadConversations();
    expect(view.convState.unreadTotal).toBe(3);
    await view.openConversation("cv_test");
    await vi.waitFor(() => expect(requests.some((r) => r.url.endsWith("/cv_test/read") && r.method === "POST")).toBe(true));
    expect(view.convState.unreadTotal).toBe(0);
  });
});

describe("merging pages", () => {
  it("puts an older page in front without repeats, and a live message in order once", () => {
    const held = [{ id: "m3" }, { id: "m4" }];
    expect(view.mergeOlder(held, [{ id: "m3" }, { id: "m2" }, { id: "m1" }]).map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(view.appendNewer(held, { id: "m5" }).map((m) => m.id)).toEqual(["m3", "m4", "m5"]);
    expect(view.appendNewer(held, { id: "m4" })).toBe(held);
  });
});

describe("a conversation row on a phone (Bug #4666)", () => {
  it("keeps the unread count outside the preview that shortens, so an ellipsis never hides it", () => {
    document.body.innerHTML = `<ul>${view.conversationRowsHtml([{ id: "c1", with: { corporationName: "Orion Survey Company" }, lastMessage: "Venus Platform: file it this week? I will put in the goods.", lastMessageAt: 0, unread: 2 }], () => "now")}</ul>`;
    const line = document.querySelector(".inbox__preview-line");
    expect(line.querySelector(".inbox__preview").textContent).toBe("Venus Platform: file it this week? I will put in the goods.");
    expect(line.querySelector(".inbox__preview .ui-badge")).toBeNull();
    expect(line.querySelector(":scope > .ui-badge").textContent).toBe("2 new");
  });
});

describe("message text renders as text, never HTML", () => {
  it("escapes bodies, names and previews", () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>alert(1)</script>';
    const thread = view.threadMessagesHtml([{ id: "m1", mine: false, fromName: evil, subject: evil, body: evil, sentAt: 0 }], () => "now");
    const rows = view.conversationRowsHtml([{ id: '"><b>x', with: { corporationName: evil }, lastMessage: evil, lastMessageAt: 0, unread: 1 }], () => "now");
    for (const html of [thread, rows]) {
      expect(html).not.toMatch(/<img|<script|<b>/);
      document.body.innerHTML = `<ul>${html}</ul>`;
      expect(document.querySelector("img, script")).toBeNull();
    }
    document.body.innerHTML = `<ul>${thread}</ul>`;
    expect(document.querySelector(".thread__body").textContent).toBe(evil);
  });
});
