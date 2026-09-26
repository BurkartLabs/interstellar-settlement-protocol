// Supertest helpers for ISP routes.
// Usage:
//   import { freshAgent, registerAccount } from "../helpers/api.js";
//   const { app } = await import("../../server/index.js");
//   const { agent, account, accessToken } = await registerAccount(app);

import request from "supertest";
import jwt from "jsonwebtoken";
import { testOutbox } from "../../server/mail.js";

let registerSeq = 0;

export function freshAgent(app) {
  return request(app);
}

/**
 * AB#2288: follow the newest verification link the test transport captured for this address, as a player follows it
 * from their mail. Throws if there is none or it does not verify.
 */
export async function verifyEmailFor(app, email) {
  const mail = testOutbox().filter((m) => m.to === String(email).trim().toLowerCase() && /verify-email\.html#token=/.test(m.text)).at(-1);
  const token = mail?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("verifyEmailFor: no verification link in the test outbox for that address");
  const res = await request(app).post("/api/auth/verify-email").send({ token });
  if (res.status !== 200) throw new Error(`verifyEmailFor: ${res.status} ${JSON.stringify(res.body)}`);
}

/**
 * AB#2288: the same, against a server running in its own process (its outbox is there, not in this one), read through
 * GET /api/dev/outbox; the server must be started with ISP_DEV=1.
 */
export async function verifyEmailOnServer(url, email) {
  const outbox = await request(url).get("/api/dev/outbox");
  if (outbox.status !== 200) throw new Error(`verifyEmailOnServer: GET /api/dev/outbox answered ${outbox.status}; start the server with ISP_DEV=1`);
  const mail = outbox.body.messages.filter((m) => m.to === String(email).trim().toLowerCase() && /verify-email\.html#token=/.test(m.text)).at(-1);
  const token = mail?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("verifyEmailOnServer: no verification link in that server's outbox for that address");
  const res = await request(url).post("/api/auth/verify-email").send({ token });
  if (res.status !== 200) throw new Error(`verifyEmailOnServer: ${res.status} ${JSON.stringify(res.body)}`);
}

/**
 * AB#2288: registration answers with no account, so a test that checks what registering stored reads it here: the
 * account as the API shows it (getAccountById), found by the email it was registered with, and the raw stored record.
 */
export async function storedAccountByEmail(email) {
  const { accountsStore, getAccountById } = await import("../../server/game/store.js");
  const raw = Object.values(accountsStore.accounts).find((a) => a.email === String(email).trim().toLowerCase());
  return raw ? { account: getAccountById(raw.id), raw } : { account: undefined, raw: undefined };
}

/**
 * AB#2288: register an account and stop there, unverified and without a session, as a player is between registering
 * and opening the link. Returns what it registered with and the new account's id.
 */
export async function registerUnverified(app, overrides = {}) {
  registerSeq += 1;
  const unique = `${Date.now()}-${registerSeq}-${Math.random().toString(36).slice(2, 6)}`;
  const body = { email: `unverified+${unique}@example.com`, password: "supersecret123", ceoName: "Test CEO", corpName: `Unverified-${unique}`, ...overrides };
  const res = await request(app).post("/api/auth/register").send(body);
  if (res.status !== 201) throw new Error(`registerUnverified failed: ${res.status} ${JSON.stringify(res.body)}`);
  const { accountsStore } = await import("../../server/game/store.js");
  const id = Object.values(accountsStore.accounts).find((a) => a.email === body.email.trim().toLowerCase())?.id;
  return { body, email: body.email.trim().toLowerCase(), id };
}

/**
 * Register a brand-new account through the live HTTP routes and return the
 * resulting account + tokens. Each call uses a unique email so multiple
 * accounts can coexist in the same test run. AB#2288: registration gives no
 * session, so this registers, follows the verification link from the test
 * outbox, and logs in; `response` is the login's, which carries the session.
 */
export async function registerAccount(app, overrides = {}) {
  registerSeq += 1;
  const unique = `${Date.now()}-${registerSeq}-${Math.random().toString(36).slice(2, 6)}`;
  const body = {
    email: `tester+${unique}@example.com`,
    password: "supersecret123",
    ceoName: "Test CEO",
    corpName: `TestCorp-${unique}`,
    ...overrides
  };
  const registered = await request(app).post("/api/auth/register").send(body);
  if (registered.status !== 201) {
    throw new Error(
      `registerAccount failed: ${registered.status} ${JSON.stringify(registered.body)}`
    );
  }
  await verifyEmailFor(app, body.email);
  const res = await request(app).post("/api/auth/login").send({ email: body.email, password: body.password });
  if (res.status !== 200) {
    throw new Error(`registerAccount: login after verifying failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    body,
    registered,
    response: res,
    account: res.body.account,
    accessToken: res.body.accessToken,
    // AB#757: the refresh token arrives only as the HttpOnly isp_refresh cookie; send it back with
    // .set("Cookie", `isp_refresh=${refreshToken}`).
    refreshToken: refreshCookieOf(res),
    accessTokenExpiresAt: res.body.accessTokenExpiresAt,
    refreshTokenExpiresAt: res.body.refreshTokenExpiresAt
  };
}

/**
 * AB#2294: an access token lives 30 minutes, and the page renews it before then. A test that moves the clock hours
 * ahead holds one token across the jump instead, so this signs one that outlives it, stamped as a login's is (Bug #2291).
 */
export async function longLivedAccessToken(accountId, seconds = 30 * 24 * 60 * 60) {
  const { passwordChangedAtOf } = await import("../../server/gameState.js");
  return jwt.sign({ sub: accountId, kind: "access", pwc: passwordChangedAtOf(accountId) }, process.env.JWT_SECRET, { expiresIn: seconds });
}

/** The refresh token a response set in its isp_refresh cookie (AB#757), or undefined. */
export function refreshCookieOf(res) {
  const line = [].concat(res.headers["set-cookie"] || []).find((c) => c.startsWith("isp_refresh="));
  return line ? decodeURIComponent(line.slice("isp_refresh=".length).split(";")[0]) || undefined : undefined;
}

/**
 * Returns a function that wraps supertest with the Authorization header
 * already set, so callers can write `auth.get(path)` / `auth.post(path)`.
 */
export function authed(app, accessToken) {
  const agent = request(app);
  const wrap = (method) => (path) =>
    agent[method](path).set("Authorization", `Bearer ${accessToken}`);
  return {
    get: wrap("get"),
    post: wrap("post"),
    put: wrap("put"),
    delete: wrap("delete"),
    patch: wrap("patch")
  };
}
