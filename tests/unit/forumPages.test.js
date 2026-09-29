// AB#995 (ISP-288): the forums a page at a time. Pure: listThreads and threadRepliesPage over a forums object.
import { describe, it, expect } from "vitest";
import { listThreads, threadRepliesPage, lastPostAt, THREAD_LIST_PAGE, PAGE_MAX } from "../../server/forumPages.js";

const T0 = 1_790_000_000_000;
function forumsWith(n, { category = "General" } = {}) {
  const threads = [];
  for (let i = 0; i < n; i++) threads.push({ id: `thr-${String(i).padStart(4, "0")}`, category, title: `t${i}`, body: "b", author: "Corp", authorAccountId: "acct", likedBy: [], createdAt: T0 + i * 1000, lastPostAt: T0 + i * 1000, replies: [] });
  return { categories: ["General", "Trade"], threads };
}
const ids = (page) => page.threads.map((t) => t.id);

describe("thread list pages (AB#995)", () => {
  it("serves the newest activity first, 25 a page by default and never more than 100", () => {
    const forums = forumsWith(130);
    const first = listThreads(forums, { now: T0 + 1e9 });
    expect(first.threads).toHaveLength(THREAD_LIST_PAGE);
    expect(first.threads[0].id).toBe("thr-0129");
    expect(first.nextCursor).toBeTruthy();
    expect(listThreads(forums, { limit: 1000, now: T0 + 1e9 }).threads).toHaveLength(PAGE_MAX);
  });

  it("gives every thread exactly once while threads are posted in and started between pages", () => {
    const forums = forumsWith(40);
    const now = T0 + 100_000;
    const seen = [];
    let page = listThreads(forums, { limit: 7, now });
    seen.push(...ids(page));
    // between pages: a reply bumps a thread not yet seen, one already seen, and a new thread starts
    forums.threads[3].replies.push({ id: "rep-1", createdAt: now + 1 }); forums.threads[3].lastPostAt = now + 1;
    forums.threads[39].replies.push({ id: "rep-2", createdAt: now + 2 }); forums.threads[39].lastPostAt = now + 2;
    forums.threads.unshift({ id: "thr-new", category: "General", title: "new", createdAt: now + 3, lastPostAt: now + 3, replies: [] });
    while (page.nextCursor) {
      page = listThreads(forums, { limit: 7, cursor: page.nextCursor, now: now + 10 });
      seen.push(...ids(page));
    }
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
    expect(seen).not.toContain("thr-new"); // it waits for the next first page, where it is on top
    expect(ids(listThreads(forums, { limit: 3, now: now + 10 }))[0]).toBe("thr-new");
  });

  it("filters by category, and refuses a cursor it cannot read", () => {
    const forums = forumsWith(5);
    forums.threads.push({ id: "thr-trade", category: "Trade", title: "x", createdAt: T0, replies: [] });
    expect(ids(listThreads(forums, { category: "Trade", now: T0 + 1e6 }))).toEqual(["thr-trade"]);
    expect(listThreads(forums, { cursor: "not-a-cursor" }).status).toBe(400);
    expect(listThreads(forums, { cursor: Buffer.from('{"asOf":1}').toString("base64url") }).status).toBe(400);
  });

  it("reads a thread's last post from its replies when it predates the stored field", () => {
    expect(lastPostAt({ createdAt: 5, replies: [{ createdAt: 9 }, { createdAt: 7 }] })).toBe(9);
    expect(lastPostAt({ createdAt: 5, lastPostAt: 11, replies: [] })).toBe(11);
  });
});

describe("reply pages (AB#995)", () => {
  const thread = { id: "thr-x", category: "General", title: "x", createdAt: T0, replies: [] };
  for (let i = 0; i < 120; i++) thread.replies.push({ id: `rep-${i}`, content: `r${i}`, authorAccountId: "acct", likedBy: [], createdAt: T0 + i });
  const forums = { categories: [], threads: [thread] };

  it("serves replies in posting order, 50 a page, and a reply written while reading comes at the end, once", () => {
    const got = [];
    let page = threadRepliesPage(forums, "thr-x");
    expect(page.thread.replyCount).toBe(120);
    expect(page.thread).not.toHaveProperty("replies");
    got.push(...page.replies.map((r) => r.id));
    thread.replies.push({ id: "rep-late", content: "late", createdAt: T0 + 999 });
    while (page.nextCursor) {
      page = threadRepliesPage(forums, "thr-x", { cursor: page.nextCursor });
      got.push(...page.replies.map((r) => r.id));
    }
    expect(got).toHaveLength(121);
    expect(new Set(got).size).toBe(121);
    expect(got.at(-1)).toBe("rep-late");
    expect(page.replies[0]).not.toHaveProperty("authorAccountId");
  });

  it("refuses an unknown cursor with 400 and an unknown thread with 404", () => {
    expect(threadRepliesPage(forums, "thr-x", { cursor: "rep-nope" }).status).toBe(400);
    expect(threadRepliesPage(forums, "thr-none").status).toBe(404);
  });
});
