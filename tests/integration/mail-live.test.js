import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById } from "../../server/gameState.js";

// Bug #1130: player mail was stored in the recipient's inbox and nothing told their open session, so it appeared only
// after a reload. The send route now emits messages:new to the recipient's own sockets, carrying no ids (Bug #1134).
let url, server;
const sockets = [];

beforeAll(async () => {
  ({ server } = await getApp());
  url = await serverUrl();
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});

async function player() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const publicId = getAccountById(account.id).state.corp.publicId;
  return { id: account.id, publicId, token: accessToken, api: authed(app, accessToken) };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return s;
}

/** Every `event` each socket receives while `action` runs, and for 300 ms after. */
async function heard(list, event, action) {
  const got = list.map(() => []);
  const handlers = list.map((s, i) => { const on = (p) => got[i].push(p); s.on(event, on); return on; });
  await action();
  await new Promise((resolve) => setTimeout(resolve, 300));
  list.forEach((s, i) => s.off(event, handlers[i]));
  return got;
}

describe("new mail reaches the recipient's open session (Bug #1130)", () => {
  it("tells the recipient's sockets only, with no ids in the event", async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    const [sa, sb, sc, anon] = [await socket(a.token), await socket(b.token), await socket(c.token), await socket()];

    const send = async () => {
      const res = await a.api.post(`/api/accounts/${a.id}/messages/send`).send({ toCorpId: b.publicId, subject: "Ore prices", body: "Selling silicates at 22." });
      expect(res.status).toBe(200);
      // The response to the sender does not carry the recipient's account id either.
      expect(JSON.stringify(res.body)).not.toContain(b.id);
    };
    const [gotA, gotB, gotC, gotAnon] = await heard([sa, sb, sc, anon], "messages:new", send);

    expect(gotB).toEqual([{}]);
    expect(gotA).toEqual([]);
    expect(gotC).toEqual([]);
    expect(gotAnon).toEqual([]);

    // What the recipient's client fetches on that event holds the mail.
    const inbox = await b.api.get(`/api/accounts/${b.id}/messages`);
    expect(inbox.body.messages.some((m) => m.folder === "inbox" && m.subject === "Ore prices")).toBe(true);
  });

  it("says nothing when a send is refused", async () => {
    const a = await player();
    const b = await player();
    const sb = await socket(b.token);
    const [gotB] = await heard([sb], "messages:new", async () => {
      const res = await a.api.post(`/api/accounts/${a.id}/messages/send`).send({ toCorpId: b.publicId, subject: "Empty", body: "" });
      expect(res.status).toBe(400);
    });
    expect(gotB).toEqual([]);
  });
});
