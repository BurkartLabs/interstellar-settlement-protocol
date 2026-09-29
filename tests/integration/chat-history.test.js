// AB#995 (ISP-288): chat keeps the design's window (50 lines a channel) in memory; older history is read from the
// channel's file a page at a time (GET /api/chat/:channel/history).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getState } from "../../server/gameState.js";
import { resetChatCache } from "../../server/game/chatHistory.js";

let app, url, server;
const sockets = [];
beforeAll(async () => {
  ({ app, server } = await getApp());
  url = await serverUrl();
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});

async function player(systemId = "sol") {
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => { state.corp.currentSystemId = systemId; });
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token: accessToken } });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return { api: authed(app, accessToken), socket: s };
}

/** Send `n` lines on `channel` and wait until the last one comes back. */
async function say(p, channel, n, prefix) {
  const last = `${prefix} ${n - 1}`;
  const back = new Promise((resolve) => { const on = (m) => { if (m.content === last) { p.socket.off("chat:new", on); resolve(); } }; p.socket.on("chat:new", on); });
  for (let i = 0; i < n; i++) p.socket.emit("chat:send", { channel, content: `${prefix} ${i}` });
  await back;
}

describe("chat history (AB#995)", () => {
  it("keeps 50 lines of a channel in memory and reads older ones from the store, each once", async () => {
    const p = await player();
    await say(p, "trade", 130, "line");
    const window = getState().chatLog.trade;
    expect(window).toHaveLength(50);
    expect(window.at(-1).content).toBe("line 129");
    resetChatCache(); // as after a restart: the next read comes from the file
    const got = [];
    let cursor = window[0].id;
    for (;;) {
      const res = await p.api.get(`/api/chat/trade/history?cursor=${encodeURIComponent(cursor)}`);
      expect(res.status).toBe(200);
      got.unshift(...res.body.messages.map((m) => m.content));
      if (!res.body.nextCursor) break;
      cursor = res.body.nextCursor;
    }
    expect(got).toEqual(Array.from({ length: 80 }, (_, i) => `line ${i}`));
    expect((await p.api.get("/api/chat/trade/history?cursor=msg-nope")).status).toBe(400);
  });

  it("reads a player's own system's local channel, and no other's", async () => {
    const here = await player("sol");
    await say(here, "local", 3, "sol local");
    const page = (await here.api.get("/api/chat/local/history")).body;
    expect(page.channel).toBe("local:sol");
    expect(page.messages.map((m) => m.content)).toEqual(["sol local 0", "sol local 1", "sol local 2"]);
    const elsewhere = await player("tau-ceti");
    expect((await elsewhere.api.get("/api/chat/local/history")).body.messages).toEqual([]);
    expect((await elsewhere.api.get("/api/chat/local:sol/history")).status).toBe(404);
  });

  it("refuses a line over 300 characters out loud, and stores nothing", async () => {
    const p = await player();
    const refused = new Promise((resolve) => p.socket.once("chat:refused", resolve));
    const before = (getState().chatLog.global || []).length;
    p.socket.emit("chat:send", { channel: "global", content: "x".repeat(301) });
    expect((await refused).error).toMatch(/at most 300 characters/);
    expect((getState().chatLog.global || []).length).toBe(before);
  });
});
