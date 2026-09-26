import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { shortLivedToken, untilExpired } from "../helpers/shortToken.js";
import { mutateAccountState } from "../../server/gameState.js";

// Bug #1766: emitMarketUpdated, emitForumsUpdated and local chat's system lookup read peer.data.accountId
// directly instead of through checkSocketAuth (ISP-67's re-verification), so a socket whose token expired since
// connecting kept seeing "this is your own listing"/"liked by me" highlighting for its last-known account, and
// kept receiving its last-known system's local chat, until some other per-account event happened to force a
// re-check first. No private or financial data leaked through this path (market/forums are public data with
// viewer-relative highlighting, and local chat is public to the system); the fix is that the highlighting and
// the delivery both stop the moment the token has actually expired, the way per-account events already did.
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
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "earth-station-prime": { Silicates: 500 } };
    state.corp.finances.credits = 100_000;
  });
  return { id: account.id, token: accessToken, api: authed(app, accessToken) };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return s;
}

/** Every `event` `s` receives while `action` runs, and for `ms` after. */
async function heard(s, event, action, ms = 300) {
  const got = [];
  const on = (payload) => got.push(payload);
  s.on(event, on);
  await action();
  await new Promise((resolve) => setTimeout(resolve, ms));
  s.off(event, on);
  return got;
}

describe("market and forum broadcasts stop personalizing for an expired-token socket (Bug #1766)", () => {
  it("emitMarketUpdated: stops marking the expired socket's own listing 'mine'", async () => {
    const a = await player();
    const { token: soonToExpire, expiresAt } = shortLivedToken(a.id); // AB#2302
    const sa = await socket(soonToExpire);

    const list = await a.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 10, unitPrice: 25 });
    expect(list.status).toBe(200);

    // Let the short-lived token actually expire while the connection stays open (ISP-67's own idiom), rather than
    // forging an already-expired one: the point of this bug is a socket that was authenticated and stops being
    // so mid-connection.
    await untilExpired(expiresAt);

    const b = await player();
    const got = await heard(sa, "market:updated", () =>
      b.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 5, unitPrice: 30 }));
    expect(got.length).toBeGreaterThan(0);
    const own = got[got.length - 1].orderBook.find((o) => o.item === "Silicates" && o.unitPrice === 25);
    expect(own, "A's own listing must still be visible").toBeTruthy();
    expect(own.mine, "no longer 'mine' once the token has expired").toBe(false);
  });

  it("emitForumsUpdated: stops marking the expired socket's own like 'likedByMe'", async () => {
    const a = await player();
    const { token: soonToExpire, expiresAt } = shortLivedToken(a.id); // AB#2302
    const sa = await socket(soonToExpire);

    const thread = await a.api.post("/api/forums/threads").send({ category: "General", title: "Bug #1766 thread", body: "b" });
    expect(thread.status).toBe(200);
    const threadId = thread.body.thread.id;
    const like = await a.api.post(`/api/forums/threads/${threadId}/like`).send({});
    expect(like.status).toBe(200);

    await untilExpired(expiresAt);

    const b = await player();
    const got = await heard(sa, "forums:updated", () =>
      b.api.post("/api/forums/threads").send({ category: "General", title: "another thread", body: "b2" }));
    expect(got.length).toBeGreaterThan(0);
    const seen = got[got.length - 1].threads.find((t) => t.id === threadId);
    expect(seen, "A's own thread must still be visible").toBeTruthy();
    expect(seen.likedByMe, "no longer 'likedByMe' once the token has expired").toBe(false);
  });

  it("local chat: stops delivering to an expired-token socket in that system", async () => {
    const a = await player();
    const { token: soonToExpire, expiresAt } = shortLivedToken(a.id); // AB#2302
    const sa = await socket(soonToExpire);
    // A is in "sol" (the default currentSystemId), same as everyone's starter corp.

    await untilExpired(expiresAt);

    const b = await player();
    const sb = await socket(b.token);
    const gotA = await heard(sa, "chat:new", () => {
      sb.emit("chat:send", { channel: "local", content: "hello sol, after A's token expired" });
    });
    expect(gotA).toEqual([]);
  });
});
