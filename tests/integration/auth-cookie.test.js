import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { freshAgent, registerAccount, refreshCookieOf } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { getState } from "../../server/gameState.js";

// AB#757 (D-0.5-2): login tokens live where they normally live. The refresh token travels only in an HttpOnly,
// Secure, SameSite=Strict cookie scoped to /api/auth, so a script injected into the page cannot read it; the access
// token is returned in the body and the page keeps it in memory. Reloading the page is a refresh from the cookie.

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

/** The Set-Cookie line for the refresh cookie, or undefined. */
const setCookie = (res) => [].concat(res.headers["set-cookie"] || []).find((c) => c.startsWith("isp_refresh="));
const cookie = (token) => `isp_refresh=${token}`;

describe("the refresh token is an HttpOnly cookie, never a body field (AB#757)", () => {
  it("register, login and refresh set the cookie with HttpOnly, Secure, SameSite=Strict and Path=/api/auth", async () => {
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const login = await freshAgent(app).post("/api/auth/login").send({ email: reg.body.email, password: reg.body.password });
    const refreshed = await freshAgent(app).post("/api/auth/refresh").set("Cookie", cookie(refreshCookieOf(login)));
    for (const res of [reg.response, login, refreshed]) {
      expect(res.status).toBeLessThan(300);
      const line = setCookie(res);
      expect(line, "Set-Cookie isp_refresh").toBeTruthy();
      const attrs = line.split(";").map((a) => a.trim().toLowerCase());
      expect(attrs).toContain("httponly");
      expect(attrs).toContain("secure");
      expect(attrs).toContain("samesite=strict");
      expect(attrs).toContain("path=/api/auth");
      expect(attrs.some((a) => /^max-age=\d+$/.test(a) && Number(a.slice(8)) > 0)).toBe(true);
    }
  });

  it("no response body carries the refresh token; the access token is in the body", async () => {
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const token = refreshCookieOf(reg.response);
    const refreshed = await freshAgent(app).post("/api/auth/refresh").set("Cookie", cookie(token));
    for (const res of [reg.response, refreshed]) {
      expect(res.body.refreshToken).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(refreshCookieOf(res));
      expect(res.body.accessToken).toBeTruthy();
    }
  });

  it("a page reload is a refresh from the cookie: it returns the account and a working access token", async () => {
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const res = await freshAgent(app).post("/api/auth/refresh").set("Cookie", cookie(refreshCookieOf(reg.response)));
    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe(reg.account.id);
    const session = await freshAgent(app).get("/api/auth/session").set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(session.status).toBe(200);
  });

  it("a refresh token in the body is ignored: only the cookie is read", async () => {
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const res = await freshAgent(app).post("/api/auth/refresh").send({ refreshToken: refreshCookieOf(reg.response) });
    expect(res.status).toBe(401);
  });

  it("a refresh without the cookie is 401, and a refused refresh clears the cookie", async () => {
    const { app } = await getApp();
    const none = await freshAgent(app).post("/api/auth/refresh");
    expect(none.status).toBe(401);
    const forged = await freshAgent(app).post("/api/auth/refresh").set("Cookie", cookie("not-a-real-jwt"));
    expect(forged.status).toBe(401);
    expect(setCookie(forged)).toMatch(/Max-Age=0/i);
  });
});

describe("logout revokes by the cookie (AB#757)", () => {
  it("clears the cookie and revokes the refresh token server-side", async () => {
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const token = refreshCookieOf(reg.response);
    const out = await freshAgent(app).post("/api/auth/logout").set("Cookie", cookie(token));
    expect(out.status).toBe(200);
    expect(setCookie(out)).toMatch(/Max-Age=0/i);
    expect(setCookie(out)).toMatch(/Path=\/api\/auth/i);
    expect(accountsStore.accounts[reg.account.id].refreshTokens).toHaveLength(0);
    const reuse = await freshAgent(app).post("/api/auth/refresh").set("Cookie", cookie(token));
    expect(reuse.status).toBe(401);
  });

  it("a logout without the cookie revokes nothing, whatever the body names", async () => {
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const token = refreshCookieOf(reg.response);
    const out = await freshAgent(app).post("/api/auth/logout").send({ accountId: reg.account.id, refreshToken: token });
    expect(out.status).toBe(200);
    expect(accountsStore.accounts[reg.account.id].refreshTokens).toHaveLength(1);
    const still = await freshAgent(app).post("/api/auth/refresh").set("Cookie", cookie(token));
    expect(still.status).toBe(200);
  });
});

describe("the socket authenticates from the refreshed access token (AB#757)", () => {
  async function socket(token) {
    const s = connect(url, { transports: ["websocket"], forceNew: true, auth: token === undefined ? {} : { token } });
    sockets.push(s);
    await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    return s;
  }
  function heard(s, ms = 500) {
    const got = [];
    s.on("chat:new", (m) => got.push(m));
    return new Promise((resolve) => setTimeout(() => resolve(got), ms));
  }

  it("a socket with the access token a cookie refresh returned is signed in; one without a valid token is not", async () => {
    const { app } = await getApp();
    const reg = await registerAccount(app);
    const { body } = await freshAgent(app).post("/api/auth/refresh").set("Cookie", cookie(refreshCookieOf(reg.response)));
    const listener = await socket(body.accessToken);
    const signedIn = await socket(body.accessToken);
    const anon = await socket();
    const forged = await socket(refreshCookieOf(reg.response)); // a refresh token is not an access token
    const got = heard(listener);
    anon.emit("chat:send", { channel: "global", content: "anonymous" });
    forged.emit("chat:send", { channel: "global", content: "wrong kind of token" });
    signedIn.emit("chat:send", { channel: "global", content: "from the refreshed token" });
    const messages = (await got).map((m) => m.content);
    expect(messages).toEqual(["from the refreshed token"]);
    const stored = JSON.stringify(getState().chatLog);
    expect(stored).toContain("from the refreshed token");
    expect(stored).not.toContain("wrong kind of token");
  });
});
