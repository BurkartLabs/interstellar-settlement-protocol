// AB#995 (ISP-288): the posting limits of docs/design/messaging.md trip, as server limits: they count and measure, and
// nothing reads what was written. Small limits are set before the server is imported (this file's own module
// instance, tests/helpers/app.js); every other file keeps the generous NODE_ENV=test limits.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";

process.env.ISP_RATE_LIMIT_CHAT_LINE_MAX = "3";
process.env.ISP_RATE_LIMIT_FORUM_THREAD_MAX = "2";
process.env.ISP_RATE_LIMIT_FORUM_POST_MAX = "3";

let app, url, server, registerAccount, authed, getState;
const sockets = [];
beforeAll(async () => {
  const appHelpers = await import("../helpers/app.js");
  ({ app, server } = await appHelpers.getApp());
  url = await appHelpers.serverUrl();
  ({ registerAccount, authed } = await import("../helpers/api.js"));
  ({ getState } = await import("../../server/gameState.js"));
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => server.close(resolve));
});

describe("chat and forum posting limits (AB#995)", () => {
  it("refuses a 4th chat line in 10 seconds from one account, with when to try again, and stores it nowhere", async () => {
    const { accessToken } = await registerAccount(app);
    const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token: accessToken } });
    sockets.push(s);
    await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    const heard = [];
    s.on("chat:new", (m) => heard.push(m.content));
    const refused = new Promise((resolve) => s.once("chat:refused", resolve));
    for (let i = 0; i < 4; i++) s.emit("chat:send", { channel: "global", content: `burst ${i}` });
    const refusal = await refused;
    expect(refusal.error).toMatch(/more than 3 lines in 10 seconds/);
    expect(refusal.retryAfterSeconds).toBeGreaterThan(0);
    expect(refusal.code).toBe("rate-limited"); // ISP-255c1 (AB#4830): the page reads it as Denied
    await new Promise((r) => setTimeout(r, 200));
    expect(heard.filter((c) => c.startsWith("burst"))).toEqual(["burst 0", "burst 1", "burst 2"]);
    expect((getState().chatLog.global || []).map((m) => m.content)).not.toContain("burst 3");
  });

  it("refuses a 3rd new thread in an hour from one account with 429 and a retry time", async () => {
    const api = authed(app, (await registerAccount(app)).accessToken);
    for (let i = 0; i < 2; i++) expect((await api.post("/api/forums/threads").send({ category: "General", title: `t${i}`, body: "b" })).status).toBe(200);
    const blocked = await api.post("/api/forums/threads").send({ category: "General", title: "t2", body: "b" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("refuses a 4th reply in an hour from one account, counted even when the reply is malformed", async () => {
    const poster = authed(app, (await registerAccount(app)).accessToken);
    const id = (await poster.post("/api/forums/threads").send({ category: "General", title: "for replies", body: "b" })).body.thread.id;
    const api = authed(app, (await registerAccount(app)).accessToken);
    expect((await api.post(`/api/forums/threads/${id}/replies`).send({ content: "one" })).status).toBe(200);
    expect((await api.post(`/api/forums/threads/${id}/replies`).send({ content: "" })).status).toBe(400); // counted
    expect((await api.post(`/api/forums/threads/${id}/replies`).send({ content: "three" })).status).toBe(200);
    expect((await api.post(`/api/forums/threads/${id}/replies`).send({ content: "four" })).status).toBe(429);
  });

  it("refuses posts over the size limits with 400, and writes nothing", async () => {
    const api = authed(app, (await registerAccount(app)).accessToken);
    const before = (getState().forums.threads || []).length;
    expect((await api.post("/api/forums/threads").send({ category: "General", title: "x".repeat(201), body: "b" })).status).toBe(400);
    expect((await api.post("/api/forums/threads").send({ category: "General", title: "t", body: "x".repeat(8001) })).status).toBe(400);
    expect((getState().forums.threads || []).length).toBe(before);
  });
});
