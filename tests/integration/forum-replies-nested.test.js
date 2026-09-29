import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getState } from "../../server/gameState.js";

// AB#2466: a forum reply may answer another reply in the same thread (replyToId), so the page can nest it under that
// reply; a reply naming one that is not in the thread is refused and nothing is written.
let app;
beforeAll(async () => { ({ app } = await getApp()); });

async function poster() {
  const { accessToken } = await registerAccount(app);
  return authed(app, accessToken);
}

describe("replies that answer a reply (AB#2466)", () => {
  it("stores what a reply answers, and serves it", async () => {
    const a = await poster(), b = await poster();
    const thread = (await a.post("/api/forums/threads").send({ category: "General", title: "Nesting", body: "Opening post" })).body.thread;
    const first = (await b.post(`/api/forums/threads/${thread.id}/replies`).send({ content: "A reply to the thread" })).body.reply;
    expect(first.replyToId).toBeUndefined();
    const res = await a.post(`/api/forums/threads/${thread.id}/replies`).send({ content: "An answer to the reply", replyToId: first.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reply).toMatchObject({ content: "An answer to the reply", replyToId: first.id });
    const deeper = await b.post(`/api/forums/threads/${thread.id}/replies`).send({ content: "And back", replyToId: res.body.reply.id });
    expect(deeper.status).toBe(200);
    // AB#995: a reply's response carries the thread's summary; its replies are read a page at a time
    const page = (await a.get(`/api/forums/threads/${thread.id}`)).body;
    expect(page.replies.map((r) => r.replyToId ?? null)).toEqual([null, first.id, res.body.reply.id]);
  });

  it("refuses a reply to a reply that is not in the thread, and writes nothing", async () => {
    const a = await poster();
    const one = (await a.post("/api/forums/threads").send({ category: "General", title: "One", body: "x" })).body.thread;
    const two = (await a.post("/api/forums/threads").send({ category: "General", title: "Two", body: "y" })).body.thread;
    const elsewhere = (await a.post(`/api/forums/threads/${two.id}/replies`).send({ content: "In thread two" })).body.reply;
    const before = JSON.stringify(getState().forums.threads.find((t) => t.id === one.id));
    for (const replyToId of [elsewhere.id, "rep-nope"]) {
      const res = await a.post(`/api/forums/threads/${one.id}/replies`).send({ content: "Stray", replyToId });
      expect(res.status, replyToId).toBe(400);
    }
    expect(JSON.stringify(getState().forums.threads.find((t) => t.id === one.id))).toBe(before);
  });
});
