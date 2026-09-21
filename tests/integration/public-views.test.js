import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { io as connect } from "socket.io-client";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getState } from "../../server/gameState.js";

// Bug #1134: forum threads, replies and likes carried the author's account id and a list of the account ids that
// liked them, and the whole forum state went to every socket and to GET /api/bootstrap, signed in or not.
// Bug #1145: the market's order book did the same with each listing's sellerAccountId.
// Mail stopped sending account ids in Bug #711 and per-account events stopped reaching other sockets in Bug #1021.
// This plays every social and market action between two corporations, records everything a second corporation and a
// socket with no login receive, and checks that none of it holds the first corporation's account id or email.
let app, server, url;
const sockets = [];

beforeAll(async () => {
  ({ app, server } = await getApp());
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});

async function player() {
  const { account, accessToken, body } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 100000;
    const station = state.corp.currentStationId || "earth-station-prime";
    state.corp.inventory = { ...(state.corp.inventory || {}), [station]: { Silicates: 500 } };
  });
  return {
    id: account.id,
    email: body.email,
    corpName: body.corpName,
    publicId: account.state?.corp?.publicId,
    token: accessToken,
    api: authed(app, accessToken)
  };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
  sockets.push(s);
  const heard = [];
  s.onAny((event, payload) => heard.push({ event, payload }));
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  await settle();
  return { s, heard };
}

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

/** The sources in `seen` whose payload contains any of `secrets`. */
function leaks(seen, secrets) {
  return seen
    .filter(({ payload }) => secrets.some((secret) => JSON.stringify(payload ?? null).includes(secret)))
    .map(({ source }) => source);
}

const thread = (forums, id) => (forums?.threads || []).find((t) => t.id === id);

describe("what one corporation can see of another (Bugs #1134, #1145)", () => {
  let a, b, threadId, replyId, orderId;
  const seenByB = [];
  const seenByAnon = [];

  beforeAll(async () => {
    a = await player();
    b = await player();
    const sa = await socket(a.token);
    const sb = await socket(b.token);
    const anon = await socket();

    // Forums: A starts a thread, B replies, each likes the other's post.
    const started = await a.api.post("/api/forums/threads").send({ category: "General", title: "Silicate prices", body: "Where do you sell?" });
    expect(started.status).toBe(200);
    threadId = started.body.thread.id;
    const replied = await b.api.post(`/api/forums/threads/${threadId}/replies`).send({ content: "At 24." });
    expect(replied.status).toBe(200);
    replyId = replied.body.reply.id;
    seenByB.push({ source: "B's reply response", payload: replied.body });
    const bLikes = await b.api.post(`/api/forums/threads/${threadId}/like`).send({});
    expect(bLikes.status).toBe(200);
    seenByB.push({ source: "B's like response", payload: bLikes.body });
    const aLikes = await a.api.post(`/api/forums/threads/${threadId}/like`).send({ replyId });
    expect(aLikes.status).toBe(200);

    // Market: A lists goods. Chat: A says something. Mail: A writes to B. A hires, which notifies A.
    const listed = await a.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 10, unitPrice: 30 });
    expect(listed.status).toBe(200);
    orderId = listed.body.order.id;
    sa.s.emit("chat:send", { channel: "global", content: "Selling Silicates at 30" });
    const sent = await a.api.post(`/api/accounts/${a.id}/messages/send`).send({ toCorpId: b.publicId, subject: "Silicates", body: "Ten at 30." });
    expect(sent.status).toBe(200);
    await a.api.post(`/api/accounts/${a.id}/gameplay/hire`).send({ count: 1 });
    await settle(500);

    for (const { event, payload } of sb.heard) seenByB.push({ source: `B's socket ${event}`, payload });
    for (const { event, payload } of anon.heard) seenByAnon.push({ source: `anonymous socket ${event}`, payload });

    // What a newcomer loads: the bootstrap and the first socket frame, signed in as B and signed out.
    seenByB.push({ source: "GET /api/bootstrap as B", payload: (await b.api.get("/api/bootstrap")).body });
    seenByAnon.push({ source: "GET /api/bootstrap signed out", payload: (await request(app).get("/api/bootstrap")).body });
    const lateB = await socket(b.token);
    const lateAnon = await socket();
    for (const { event, payload } of lateB.heard) seenByB.push({ source: `B's new socket ${event}`, payload });
    for (const { event, payload } of lateAnon.heard) seenByAnon.push({ source: `new anonymous socket ${event}`, payload });
    seenByB.push({ source: "B's inbox", payload: (await b.api.get(`/api/accounts/${b.id}/messages`)).body });
  });

  it("recorded the events it checks", () => {
    const events = new Set(seenByAnon.map((x) => x.source));
    for (const e of ["anonymous socket state:init", "anonymous socket forums:updated", "anonymous socket market:updated", "anonymous socket chat:new"]) {
      expect(events, e).toContain(e);
    }
    expect(seenByB.some((x) => x.source === "B's socket forums:updated")).toBe(true);
  });

  it("the stored forum still knows who posted and who liked, so one like per account holds", () => {
    const stored = thread(getState().forums, threadId);
    expect(stored.authorAccountId).toBe(a.id);
    expect(stored.likedBy).toEqual([b.id]);
    expect(stored.replies[0].likedBy).toEqual([a.id]);
  });

  it("B receives nothing that holds A's account id or email", () => {
    expect(leaks(seenByB, [a.id, a.email])).toEqual([]);
  });

  it("a socket with no login receives no account id or email of anyone", () => {
    expect(leaks(seenByAnon, [a.id, a.email, b.id, b.email])).toEqual([]);
  });

  it("each viewer is told only whether they liked a post, and the counts are right", async () => {
    const asA = thread((await a.api.get("/api/bootstrap")).body.forums, threadId);
    const asB = thread((await b.api.get("/api/bootstrap")).body.forums, threadId);
    const signedOut = thread((await request(app).get("/api/bootstrap")).body.forums, threadId);
    expect(asA).toMatchObject({ author: a.corpName, likes: 1, likedByMe: false });
    expect(asA.replies[0]).toMatchObject({ author: b.corpName, likes: 1, likedByMe: true });
    expect(asB).toMatchObject({ likes: 1, likedByMe: true });
    expect(asB.replies[0]).toMatchObject({ likes: 1, likedByMe: false });
    expect(signedOut).toMatchObject({ likes: 1, likedByMe: false });
    for (const view of [asA, asB, signedOut]) {
      expect(view).not.toHaveProperty("authorAccountId");
      expect(view).not.toHaveProperty("likedBy");
      expect(view.replies[0]).not.toHaveProperty("authorAccountId");
      expect(view.replies[0]).not.toHaveProperty("likedBy");
    }
  });

  it("each socket's forums:updated says whether that socket's own account liked the post", async () => {
    const sa = await socket(a.token);
    const sb = await socket(b.token);
    const before = [sa.heard.length, sb.heard.length];
    await b.api.post(`/api/forums/threads/${threadId}/like`).send({}); // B unlikes
    await settle();
    const lastForums = (h, from) => h.slice(from).filter((x) => x.event === "forums:updated").at(-1)?.payload;
    expect(thread(lastForums(sa.heard, before[0]), threadId)).toMatchObject({ likes: 0, likedByMe: false });
    expect(thread(lastForums(sb.heard, before[1]), threadId)).toMatchObject({ likes: 0, likedByMe: false });
    await b.api.post(`/api/forums/threads/${threadId}/like`).send({}); // and likes again
    await settle();
    expect(thread(lastForums(sb.heard, before[1]), threadId)).toMatchObject({ likes: 1, likedByMe: true });
    expect(thread(lastForums(sa.heard, before[0]), threadId)).toMatchObject({ likes: 1, likedByMe: false });
  });

  it("a listing says whether it is the viewer's own, and A can still cancel it", async () => {
    const mine = (await a.api.get("/api/bootstrap")).body.market.orderBook.find((o) => o.id === orderId);
    const theirs = (await b.api.get("/api/bootstrap")).body.market.orderBook.find((o) => o.id === orderId);
    expect(mine).toMatchObject({ seller: a.corpName, mine: true });
    expect(theirs).toMatchObject({ seller: a.corpName, mine: false });
    expect(theirs).not.toHaveProperty("sellerAccountId");
    const cancelled = await a.api.post(`/api/market/orders/${orderId}/cancel`).send({});
    expect(cancelled.status).toBe(200);
  });
});
