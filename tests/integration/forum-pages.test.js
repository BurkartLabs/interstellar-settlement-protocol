// AB#995 (ISP-288): the forums over HTTP a page at a time, with threads and replies arriving while a player pages.
import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";

let app;
let a;
let b;
beforeAll(async () => {
  ({ app } = await getApp());
  const one = await registerAccount(app);
  const two = await registerAccount(app);
  a = authed(app, one.accessToken);
  b = authed(app, two.accessToken);
});

const CATEGORY = "Trade & Exchange";
const Q = encodeURIComponent(CATEGORY);
const post = (who, title) => who.post("/api/forums/threads").send({ category: CATEGORY, title, body: `${title} body` });

describe("forum pages over HTTP (AB#995)", () => {
  it("pages the thread list by cursor, each thread exactly once while others are posted in and started", async () => {
    const mine = [];
    for (let i = 0; i < 12; i++) mine.push((await post(a, `paging ${i}`)).body.thread.id);
    const seen = [];
    let res = await b.get(`/api/forums/threads?category=${Q}&limit=5`);
    expect(res.status).toBe(200);
    seen.push(...res.body.threads.map((t) => t.id));
    // meanwhile: a reply to one already seen and to one not yet seen, and a new thread
    await b.post(`/api/forums/threads/${mine[11]}/replies`).send({ content: "bump a seen one" });
    await b.post(`/api/forums/threads/${mine[0]}/replies`).send({ content: "bump an unseen one" });
    const late = (await post(b, "started while paging")).body.thread.id;
    while (res.body.nextCursor) {
      res = await b.get(`/api/forums/threads?category=${Q}&limit=5&cursor=${encodeURIComponent(res.body.nextCursor)}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.threads.map((t) => t.id));
    }
    const ofMine = seen.filter((id) => mine.includes(id));
    expect(ofMine).toHaveLength(12);
    expect(new Set(ofMine).size).toBe(12);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(late);
    const top = (await b.get(`/api/forums/threads?category=${Q}&limit=3`)).body.threads.map((t) => t.id);
    expect(top[0]).toBe(late);
  });

  it("caps the page size, and answers 400 to a cursor it cannot read", async () => {
    expect((await a.get("/api/forums/threads?limit=100000")).body.threads.length).toBeLessThanOrEqual(100);
    expect((await a.get("/api/forums/threads?cursor=garbage")).status).toBe(400);
  });

  it("pages a long thread's replies in order, and a reply posted while reading comes at the end, once", async () => {
    const id = (await post(a, "a long thread")).body.thread.id;
    for (let i = 0; i < 60; i++) await b.post(`/api/forums/threads/${id}/replies`).send({ content: `reply ${i}` });
    let res = await a.get(`/api/forums/threads/${id}`);
    expect(res.body.replies).toHaveLength(50);
    expect(res.body.thread.replyCount).toBe(60);
    const got = res.body.replies.map((r) => r.content);
    await b.post(`/api/forums/threads/${id}/replies`).send({ content: "posted while reading" });
    res = await a.get(`/api/forums/threads/${id}?cursor=${encodeURIComponent(res.body.nextCursor)}`);
    got.push(...res.body.replies.map((r) => r.content));
    expect(res.body.nextCursor).toBeNull();
    expect(got).toEqual([...Array.from({ length: 60 }, (_, i) => `reply ${i}`), "posted while reading"]);
    expect((await a.get(`/api/forums/threads/${id}?cursor=rep-nope`)).status).toBe(400);
  });

  it("no longer sends every thread in the bootstrap", async () => {
    const boot = (await a.get("/api/bootstrap")).body;
    expect(boot.forums.categories.length).toBeGreaterThan(0);
    expect(boot.forums).not.toHaveProperty("threads");
  });
});
