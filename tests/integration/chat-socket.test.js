import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { mutateAccountState, getState } from "../../server/gameState.js";

// Bug #710: chat:send had no authentication and took author and channel from the payload, so anyone - logged in
// or not - could post as any corporation or authority, into any system's local channel or a channel they invented.
let url, server;
const sockets = [];

beforeAll(async () => {
  ({ server } = await getApp());
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});

async function player(systemId = "sol") {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => { state.corp.currentSystemId = systemId; });
  return { id: account.id, token: accessToken, corpName: account.state?.corp?.corporationName };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return s;
}

/** Everything `s` receives on chat:new within `ms`. */
function collect(s, ms = 400) {
  const got = [];
  const on = (m) => got.push(m);
  s.on("chat:new", on);
  return new Promise((resolve) => setTimeout(() => { s.off("chat:new", on); resolve(got); }, ms));
}

describe("chat over socket.io (Bug #710)", () => {
  it("drops chat from a socket with no token or a bad token, and stores nothing", async () => {
    const listener = await socket((await player()).token);
    const anon = await socket();
    const forged = await socket("not-a-real-token");
    const before = JSON.stringify(getState().chatLog);
    const heard = collect(listener);
    anon.emit("chat:send", { channel: "global", author: "GEX Commodities Authority", content: "Standing bid raised to 90cr" });
    forged.emit("chat:send", { channel: "global", author: "ISA Enforcement Division", content: "Pay the fine" });
    expect(await heard).toEqual([]);
    expect(JSON.stringify(getState().chatLog)).toBe(before);
  });

  it("replaces a forged author with the sender's own corporation, and never broadcasts the account id", async () => {
    const sender = await player();
    const s = await socket(sender.token);
    const heard = collect(s);
    s.emit("chat:send", { channel: "global", author: "GEX Commodities Authority", content: "hello" });
    const [msg] = await heard;
    expect(msg).toBeTruthy();
    expect(msg.author).not.toBe("GEX Commodities Authority");
    expect(msg.author).toBe(sender.corpName);
    expect(JSON.stringify(msg)).not.toContain(sender.id);
  });

  for (const channel of ["local:tau-ceti", "anything-you-like", "private", "", 42]) {
    it(`refuses the channel ${JSON.stringify(channel)} from a corporation in Sol`, async () => {
      const s = await socket((await player("sol")).token);
      const before = JSON.stringify(getState().chatLog);
      const heard = collect(s);
      s.emit("chat:send", { channel, content: "should not land" });
      expect(await heard).toEqual([]);
      expect(JSON.stringify(getState().chatLog)).toBe(before);
    });
  }

  it("delivers a local message to corporations in the sender's system, and nowhere else", async () => {
    const [a, b, far] = [await player("sol"), await player("sol"), await player("tau-ceti")];
    const [sa, sb, sfar] = [await socket(a.token), await socket(b.token), await socket(far.token)];
    const [heardB, heardFar] = [collect(sb), collect(sfar)];
    sa.emit("chat:send", { channel: "local:sol", content: "anyone at Earth Station Prime?" });
    const got = await heardB;
    expect(got.map((m) => [m.channel, m.content])).toEqual([["local:sol", "anyone at Earth Station Prime?"]]);
    expect(await heardFar).toEqual([]);
  });

  it("maps a bare 'local' to the sender's own system, as the server knows it", async () => {
    const a = await player("tau-ceti");
    const s = await socket(a.token);
    const heard = collect(s);
    s.emit("chat:send", { channel: "local", content: "hi from Tau Ceti" });
    const [msg] = await heard;
    expect(msg?.channel).toBe("local:tau-ceti");
  });

  it("still broadcasts global and trade to every connected socket, logged in or not", async () => {
    const sender = await socket((await player()).token);
    const reader = await socket();
    const heard = collect(reader);
    sender.emit("chat:send", { channel: "trade", content: "selling silicate" });
    expect((await heard).map((m) => m.channel)).toEqual(["trade"]);
  });
});
