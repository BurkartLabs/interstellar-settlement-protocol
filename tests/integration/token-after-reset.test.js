import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { io as connect } from "socket.io-client";
import { getApp, serverUrl } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { issueResetToken, resetPassword } from "../../server/passwordReset.js";
import { emitToAccount } from "../../server/realtime.js";

// Bug #2291: a password reset (AB#988) revoked every refresh token but left access tokens, good for 7 days, working.
// Whoever held a stolen one kept the account's API and sockets after its owner reset the password to lock them out.
const NEW_PASSWORD = "a-new-password-2291";
let url;
const sockets = [];
beforeAll(async () => { url = await serverUrl(); });
afterAll(() => { for (const s of sockets) s.close(); });

async function playerThenReset() {
  const { app } = await getApp();
  const { account, accessToken, body } = await registerAccount(app);
  const before = accessToken;
  expect((await request(app).get("/api/auth/session").set("Authorization", `Bearer ${before}`)).status).toBe(200);
  expect(await resetPassword(issueResetToken(account.id), NEW_PASSWORD)).toEqual({ ok: true });
  return { app, id: account.id, email: body.email, before };
}

async function socket(token) {
  const s = connect(url, { transports: ["websocket"], forceNew: true, auth: { token } });
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

describe("a password reset ends the sessions it was meant to end (Bug #2291)", () => {
  it("an access token issued before the reset gets 401, the same answer as an expired one, on every signed-in route", async () => {
    const { app, id, before } = await playerThenReset();
    const session = await request(app).get("/api/auth/session").set("Authorization", `Bearer ${before}`);
    expect(session.status).toBe(401);
    expect(session.body.error).toBe("Invalid or expired access token.");
    const account = await request(app).get(`/api/accounts/${id}`).set("Authorization", `Bearer ${before}`);
    expect(account.status).toBe(401);
  });

  it("a login straight after the reset, in the same second, is let in", async () => {
    const { app, email } = await playerThenReset();
    const login = await request(app).post("/api/auth/login").send({ email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect((await request(app).get("/api/auth/session").set("Authorization", `Bearer ${login.body.accessToken}`)).status).toBe(200);
  });

  it("another account's reset leaves this account's token alone", async () => {
    const { app } = await getApp();
    const bystander = await registerAccount(app);
    await playerThenReset();
    expect((await request(app).get("/api/auth/session").set("Authorization", `Bearer ${bystander.accessToken}`)).status).toBe(200);
  });

  it("a token from before this fix, with no password stamp, works until the account's password changes", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const unstamped = jwt.sign({ sub: account.id, kind: "access" }, process.env.JWT_SECRET, { expiresIn: 3600 });
    expect((await request(app).get("/api/auth/session").set("Authorization", `Bearer ${unstamped}`)).status).toBe(200);
    await resetPassword(issueResetToken(account.id), NEW_PASSWORD);
    expect((await request(app).get("/api/auth/session").set("Authorization", `Bearer ${unstamped}`)).status).toBe(401);
  });

  it("a socket signed in before the reset stops hearing the account and is told its sign-in expired", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const s = await socket(accessToken);
    const ping = () => emitToAccount(account.id, "test:account-ping", { n: 1 });
    expect(await heard(s, "test:account-ping", ping)).toHaveLength(1);

    await resetPassword(issueResetToken(account.id), NEW_PASSWORD);
    const expired = [];
    s.on("auth:expired", () => expired.push(1));
    expect(await heard(s, "test:account-ping", ping)).toHaveLength(0);
    expect(expired.length).toBeGreaterThan(0);

    // Reconnecting with the same token signs nobody in.
    const again = await socket(accessToken);
    expect(await heard(again, "test:account-ping", ping)).toHaveLength(0);
  });
});
