import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { io as connect } from "socket.io-client";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState } from "../../server/gameState.js";
import { chatLineHtml, messageListItemsHtml } from "../../public/scripts/html.js";

// AB#733: chat, forums and player mail ship to the playtest as they are (Board ruling on AB#696). This proves, on a
// fresh install (tests/setup.js gives every run a state file that does not exist), that two players can use all four
// channels, that text arrives as it was typed, that it renders as text, and that the author is always the sender.
const HOSTILE = `<script>window.__xss = 1</script><img src=x onerror="window.__xss = 2"> & 10 < price < 30`;

let app, server, url;
const sockets = [];
let a, b;

async function player() {
  const { account, accessToken } = await registerAccount(app);
  return {
    id: account.id,
    api: authed(app, accessToken),
    token: accessToken,
    corpName: getAccountById(account.id).state.corp.corporationName,
    publicId: getAccountById(account.id).state.corp.publicId
  };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token } });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return s;
}

/** The next chat:new on `s` whose content is `content`, or null after `ms`. */
function heard(s, content, ms = 1500) {
  return new Promise((resolve) => {
    const on = (m) => { if (m.content === content) { s.off("chat:new", on); clearTimeout(t); resolve(m); } };
    const t = setTimeout(() => { s.off("chat:new", on); resolve(null); }, ms);
    s.on("chat:new", on);
  });
}

beforeAll(async () => {
  ({ app, server } = await getApp());
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  a = await player();
  b = await player();
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});

describe("two players on a fresh install use every player-to-player channel (AB#733)", () => {
  it("global chat: B receives A's line, exactly as typed, signed by A's corporation", async () => {
    const [sa, sb] = [await socket(a.token), await socket(b.token)];
    const got = heard(sb, HOSTILE);
    sa.emit("chat:send", { channel: "global", author: "ISA Enforcement Division", content: HOSTILE });
    const m = await got;
    expect(m).toMatchObject({ channel: "global", author: a.corpName, content: HOSTILE });
    expect(getState().chatLog.global.at(-1)).toMatchObject({ author: a.corpName, content: HOSTILE });
  });

  it("local chat: B, in the same system, receives A's line", async () => {
    const [sa, sb] = [await socket(a.token), await socket(b.token)];
    const line = `local from ${a.corpName}`;
    const got = heard(sb, line);
    sa.emit("chat:send", { channel: "local", content: line });
    expect(await got).toMatchObject({ channel: "local:sol", author: a.corpName, content: line });
  });

  it("chat keeps a line of 300 characters and drops one of 301 (Bug #1127)", async () => {
    const [sa, sb] = [await socket(a.token), await socket(b.token)];
    const ok = "y".repeat(300), long = "z".repeat(301);
    const [gotOk, gotLong] = [heard(sb, ok), heard(sb, long, 800)];
    sa.emit("chat:send", { channel: "global", content: ok });
    sa.emit("chat:send", { channel: "global", content: long });
    expect(await gotOk).not.toBeNull();
    expect(await gotLong).toBeNull();
    expect(getState().chatLog.global.some((m) => m.content === long)).toBe(false);
  });

  it("forums: A starts a thread, B replies, and each sees the other's post as written", async () => {
    const started = await a.api.post("/api/forums/threads").send({ category: "General", title: "Silicate prices", body: HOSTILE });
    expect(started.status).toBe(200);
    const threadId = (getState().forums.threads || []).find((t) => t.title === "Silicate prices")?.id;
    expect(threadId).toBeTruthy();

    const seenByB = (await request(app).get("/api/bootstrap")).body.forums.threads.find((t) => t.id === threadId);
    expect(seenByB).toMatchObject({ title: "Silicate prices", body: HOSTILE });
    expect(JSON.stringify(seenByB)).toContain(a.corpName);

    const replied = await b.api.post(`/api/forums/threads/${threadId}/replies`).send({ content: `Reply ${HOSTILE}` });
    expect(replied.status).toBe(200);
    const seenByA = (await request(app).get("/api/bootstrap")).body.forums.threads.find((t) => t.id === threadId);
    const reply = seenByA.replies.at(-1);
    expect(reply.content).toBe(`Reply ${HOSTILE}`);
    expect(JSON.stringify(reply)).toContain(b.corpName);
  });

  it("player mail: A finds B by name, sends, and B's inbox has it, from A, as written", async () => {
    const found = await a.api.get(`/api/accounts/${a.id}/corporations`).query({ name: b.corpName });
    const to = found.body.corporations.find((c) => c.corporationName === b.corpName);
    expect(to?.publicId).toBe(b.publicId);
    const sent = await a.api.post(`/api/accounts/${a.id}/messages/send`).send({ toCorpId: to.publicId, subject: `Hello <b>${b.corpName}</b>`, body: HOSTILE });
    expect(sent.status).toBe(200);
    const inbox = (await b.api.get(`/api/accounts/${b.id}/messages`)).body.messages.filter((m) => m.folder === "inbox");
    const mail = inbox.find((m) => m.body === HOSTILE);
    expect(mail).toMatchObject({ subject: `Hello <b>${b.corpName}</b>`, fromName: a.corpName });
  });
});

describe("player text renders as text, never as HTML (AB#733)", () => {
  it("a chat line escapes its text and its author", () => {
    const html = chatLineHtml({ author: "<b>Corp</b>", content: HOSTILE, createdAt: 0 }, () => "12:00");
    expect(html).not.toMatch(/<script|<img|<b>/);
    expect(html).toContain("&lt;script&gt;window.__xss = 1&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;Corp&lt;/b&gt;");
    expect(html).toContain("10 &lt; price &lt; 30");
  });

  it("the inbox list escapes a mail's subject and sender", () => {
    const html = messageListItemsHtml([{ id: "m1", folder: "inbox", fromName: "<img src=x>", subject: HOSTILE, sentAt: 0 }], () => "today");
    expect(html).not.toMatch(/<script|<img/);
  });

  it("a mail's subject and body are set as text in the reader, and chat and forum text go through escapeHtml", () => {
    const client = readFileSync(new URL("../../public/scripts/app.js", import.meta.url), "utf8");
    expect(client).toMatch(/getElementById\("inbox-detail-subject"\)\.textContent =/);
    expect(client).toMatch(/getElementById\("inbox-detail-body"\)\.textContent =/);
    expect(client).toMatch(/\.map\(\(msg\) => chatLineHtml\(msg, formatTime\)\)/);
    expect(client).toContain("${escapeHtml(reply.content || \"\")}");
    expect(client).toContain("${escapeHtml(selected.title || \"Untitled Thread\")}");
    expect(client).toMatch(/opBody\.split\([^)]*\)\.map\(\(para\) => `<p>\$\{escapeHtml\(para\)\}<\/p>`\)/);
  });
});

describe("nothing is hidden behind a social feature flag (AB#733)", () => {
  it("no file in the product names one", () => {
    const flag = ["ISP", "SOCIAL"].join("_");
    const root = new URL("../../", import.meta.url);
    const skip = new Set(["node_modules", ".git", "data", "coverage"]);
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const path = new URL(name, dir);
        if (statSync(path).isDirectory()) walk(new URL(`${name}/`, dir));
        else if (/\.(js|mjs|html|css|json|md)$/.test(name) && readFileSync(path, "utf8").includes(flag)) hits.push(path.pathname);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
