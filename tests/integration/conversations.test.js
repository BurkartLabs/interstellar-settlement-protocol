import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById } from "../../server/gameState.js";
import { dataDir } from "../../server/game/catalog.js";
import { setConversationIo, resetConversationCache, conversationIdFor, BODY_MAX_CHARS, PAGE_MAX } from "../../server/game/conversations.js";

// AB#910 (docs/design/messaging.md): private messages between corporations by id, in their own files, paged by cursor,
// delivered to the recipient's room, with size and rate limits that protect the server. The Board ruled no filter,
// block, report or moderation (AB#707, AB#696), so nothing here looks at what a message says.
let url, server, app;
const sockets = [];

beforeAll(async () => {
  ({ server, app } = await getApp());
  url = await serverUrl();
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});
afterEach(() => setConversationIo(null));

async function player() {
  const { account, accessToken } = await registerAccount(app);
  const publicId = getAccountById(account.id).state.corp.publicId;
  return { id: account.id, publicId, token: accessToken, api: authed(app, accessToken), base: `/api/accounts/${account.id}` };
}
async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token } });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return s;
}
const send = (from, to, body) => from.api.post(`${from.base}/conversations/send`).send({ toCorpId: to.publicId, body });
const threadFile = (a, b) => path.join(dataDir, "messages", `${conversationIdFor(a.id, b.id)}.jsonl`);
const inboxFile = (p) => path.join(dataDir, "inbox", `${encodeURIComponent(p.id)}.json`);
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

describe("sending by corporation id", () => {
  it("delivers to the corporation with that publicId, stored outside the accounts snapshot", async () => {
    const a = await player(), b = await player();
    const res = await send(a, b, "Rates for helium-3?");
    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ body: "Rates for helium-3?", mine: true, fromCorpId: a.publicId });
    expect(JSON.stringify(res.body)).not.toContain(a.id); // no account id leaves the server (Bug #1134)
    expect(read(threadFile(a, b))).toContain("Rates for helium-3?");
    const inbox = await b.api.get(`${b.base}/conversations`);
    expect(inbox.body.conversations[0]).toMatchObject({ id: res.body.conversationId, with: { publicId: a.publicId }, unread: 1, messageCount: 1 });
  });

  it("answers 404 for an unknown corporation id and stores nothing", async () => {
    const a = await player();
    const before = read(inboxFile(a));
    const res = await a.api.post(`${a.base}/conversations/send`).send({ toCorpId: "corp-that-is-not-there", body: "hello" });
    expect(res.status).toBe(404);
    expect(read(inboxFile(a))).toBe(before);
  });

  it("answers 413 for a body over the limit, in characters or in bytes, and stores nothing", async () => {
    const a = await player(), b = await player();
    expect((await send(a, b, "x".repeat(BODY_MAX_CHARS + 1))).status).toBe(413);
    expect((await send(a, b, "\u{1F680}".repeat(8_200))).status).toBe(413); // 8,200 rockets: fewer than 16,400 chars, 32,800 bytes
    expect(read(threadFile(a, b))).toBeNull();
    expect((await send(a, b, "x".repeat(BODY_MAX_CHARS))).status).toBe(201); // exactly the limit is fine
  });

  it("takes the sender from the token only: a body naming another sender is ignored", async () => {
    const a = await player(), b = await player(), c = await player();
    const res = await a.api.post(`${a.base}/conversations/send`).send({ toCorpId: b.publicId, body: "from a", fromCorpId: c.publicId, fromAccountId: c.id, from: c.id });
    expect(res.status).toBe(201);
    expect(res.body.message.fromCorpId).toBe(a.publicId);
    expect(read(threadFile(c, b))).toBeNull();
    // and another account's route is refused before it is reached (requireAccountAccess)
    expect((await a.api.post(`/api/accounts/${c.id}/conversations/send`).send({ toCorpId: b.publicId, body: "x" })).status).toBe(403);
  });

  it("stores and returns a body exactly as sent, <script> included, and the Inbox renders bodies as text", async () => {
    const a = await player(), b = await player();
    const body = '<script>alert("x")</script> & 10 < 20';
    const sent = await send(a, b, body);
    const page = await b.api.get(`${b.base}/conversations/${sent.body.conversationId}/messages`);
    expect(page.body.messages[0].body).toBe(body); // no filter and no stripping (AB#696): the client escapes
    const inbox = fs.readFileSync(path.resolve("public/scripts/views/inbox.js"), "utf8");
    expect(inbox).toMatch(/inbox-detail-body"\)\.textContent = msg\.body/);
  });
});

describe("cursor pages", () => {
  it("returns every message exactly once while new ones arrive between pages, newest first", async () => {
    const a = await player(), b = await player();
    const first = [];
    for (let i = 0; i < 25; i++) first.push((await send(i % 2 ? b : a, i % 2 ? a : b, `m${i}`)).body.message.id);
    const conversationId = conversationIdFor(a.id, b.id);
    const seen = [];
    let cursor = null;
    let round = 0;
    do {
      const res = await a.api.get(`${a.base}/conversations/${conversationId}/messages`).query({ limit: 7, ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      seen.push(...res.body.messages.map((m) => m.id));
      cursor = res.body.nextCursor;
      await send(b, a, `arrived during page ${round++}`); // lands after the cursor: never repeated, never skipped
    } while (cursor);
    expect(seen).toEqual([...first].reverse());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("caps the page size on the server, and refuses a page marker it cannot read", async () => {
    const a = await player(), b = await player();
    for (let i = 0; i < PAGE_MAX + 5; i++) await send(a, b, `n${i}`);
    const conversationId = conversationIdFor(a.id, b.id);
    const big = await a.api.get(`${a.base}/conversations/${conversationId}/messages`).query({ limit: 1000 });
    expect(big.body.messages).toHaveLength(PAGE_MAX);
    expect(big.body.nextCursor).toBeTruthy();
    expect((await a.api.get(`${a.base}/conversations/${conversationId}/messages`).query({ cursor: "not-a-cursor" })).status).toBe(400);
    expect((await a.api.get(`${a.base}/conversations`).query({ cursor: "!!" })).status).toBe(400);
  });

  it("pages the inbox by last message, and a stranger cannot read a conversation", async () => {
    const a = await player();
    const others = [];
    for (let i = 0; i < 5; i++) { const o = await player(); others.push(o); await send(o, a, `hi ${i}`); }
    const one = await a.api.get(`${a.base}/conversations`).query({ limit: 2 });
    const two = await a.api.get(`${a.base}/conversations`).query({ limit: 2, cursor: one.body.nextCursor });
    const three = await a.api.get(`${a.base}/conversations`).query({ limit: 2, cursor: two.body.nextCursor });
    const order = [...one.body.conversations, ...two.body.conversations, ...three.body.conversations].map((c) => c.with.publicId);
    expect(order).toEqual(others.map((o) => o.publicId).reverse());
    expect(three.body.nextCursor).toBeNull();
    const stranger = await player();
    const conversationId = conversationIdFor(a.id, others[0].id);
    expect((await stranger.api.get(`${stranger.base}/conversations/${conversationId}/messages`)).status).toBe(404);
  });

  it("marks a conversation read", async () => {
    const a = await player(), b = await player();
    const { conversationId } = (await send(a, b, "one")).body;
    await send(a, b, "two");
    expect((await b.api.get(`${b.base}/conversations`)).body.conversations[0].unread).toBe(2);
    expect((await b.api.get(`${b.base}/conversations`)).body.unreadTotal).toBe(2); // AB#911: the Inbox tab's count
    expect((await b.api.post(`${b.base}/conversations/${conversationId}/read`)).body.conversation.unread).toBe(0);
    resetConversationCache(); // from the files, not memory
    expect((await b.api.get(`${b.base}/conversations`)).body.conversations[0].unread).toBe(0);
  });
});

describe("live delivery", () => {
  it("reaches the recipient's room and the sender's own tabs, and a third socket receives nothing", async () => {
    const a = await player(), b = await player(), c = await player();
    const [sa, sb, sc] = [await socket(a.token), await socket(b.token), await socket(c.token)];
    const got = [[], [], []];
    [sa, sb, sc].forEach((s, i) => s.on("conversations:new", (p) => got[i].push(p)));
    await send(a, b, "live");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(got[1]).toHaveLength(1);
    expect(got[1][0].message).toMatchObject({ body: "live", mine: false, fromCorpId: a.publicId });
    expect(got[0][0].message.mine).toBe(true);
    expect(got[2]).toEqual([]);
    expect(JSON.stringify(got)).not.toContain(a.id);
  });
});

describe("failing closed", () => {
  it("answers 503 when the store cannot be written, and leaves nothing half-written", async () => {
    const a = await player(), b = await player();
    await send(a, b, "before");
    const files = [threadFile(a, b), inboxFile(a), inboxFile(b)].map(read);
    let appended = false;
    setConversationIo({
      read: (f) => read(f), size: (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0),
      append: (f, t) => { fs.appendFileSync(f, t); appended = true; }, // the message line is written...
      truncate: (f, n) => fs.truncateSync(f, n),
      write: () => { throw new Error("disk full"); } // ...and the inbox write fails
    });
    const res = await send(a, b, "during the outage");
    expect(res.status).toBe(503);
    expect(appended).toBe(true);
    setConversationIo(null);
    expect([threadFile(a, b), inboxFile(a), inboxFile(b)].map(read)).toEqual(files);
    resetConversationCache();
    const page = await a.api.get(`${a.base}/conversations/${conversationIdFor(a.id, b.id)}/messages`);
    expect(page.body.messages.map((m) => m.body)).toEqual(["before"]);
  });
});

describe("the old Inbox's send writes the conversation too", () => {
  it("puts a message sent through /messages/send in its conversation, once", async () => {
    const a = await player(), b = await player();
    const res = await a.api.post(`${a.base}/messages/send`).send({ toCorpId: b.publicId, subject: "Ore", body: "Old route" });
    expect(res.status).toBe(200);
    const page = await b.api.get(`${b.base}/conversations/${conversationIdFor(a.id, b.id)}/messages`);
    expect(page.body.messages).toHaveLength(1);
    expect(page.body.messages[0]).toMatchObject({ body: "Old route", subject: "Ore", fromCorpId: a.publicId });
  });
});
