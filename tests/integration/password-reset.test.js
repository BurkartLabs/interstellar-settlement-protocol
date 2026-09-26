// AB#988 (ISP-281): reset a forgotten password by email. The request answers the same whether or not the address has
// an account and is rate-limited per address and per client; the reset token is random, stored hashed, single-use and
// good for one hour; a reset enforces the password rules, revokes every refresh token and tells the owner by email.

import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { freshAgent, registerAccount, refreshCookieOf } from "../helpers/api.js";
import { clearTestOutbox, testOutbox } from "../../server/mail.js";
import { accountsStore, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../server/game/store.js";
import { issueResetToken, RESET_TTL_MS, resetPassword } from "../../server/passwordReset.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const NEW_PASSWORD = "a-brand-new-password";
const tokenIn = (text) => text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
const mailsTo = (email) => testOutbox().filter((m) => m.to === email);

async function player(app) {
  const { account, body, response } = await registerAccount(app);
  return { id: account.id, email: body.email, password: body.password, refresh: refreshCookieOf(response) };
}

describe("asking for a reset (AB#988)", () => {
  it("mails one single-use link to an account's address", async () => {
    const { app } = await getApp();
    const p = await player(app);
    clearTestOutbox();
    const res = await request(app).post("/api/auth/forgot-password").send({ email: p.email.toUpperCase() });
    expect(res.status).toBe(202);
    const mails = mailsTo(p.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toMatch(/^https?:\/\/\S+\/reset-password\.html#token=[A-Za-z0-9_-]{43}$/m);
    expect(mails[0].text).toMatch(/one hour/);
  });

  it("answers identically whether or not the address has an account, and sends only to one that does", async () => {
    const { app } = await getApp();
    const p = await player(app);
    clearTestOutbox();
    const known = await request(app).post("/api/auth/forgot-password").send({ email: p.email });
    for (const email of [`nobody-${Date.now()}@example.com`, "", { $ne: "" }, ["x@example.com"]]) {
      const r = await request(app).post("/api/auth/forgot-password").send({ email });
      expect(r.status, JSON.stringify(email)).toBe(known.status);
      expect(r.body, JSON.stringify(email)).toEqual(known.body);
    }
    expect(testOutbox()).toHaveLength(1);
  });
});

describe("the reset token (AB#988)", () => {
  it("is 32 random bytes, stored only as a hash, and expires after one hour", async () => {
    const { app } = await getApp();
    const p = await player(app);
    const now = Date.now();
    const raw = issueResetToken(p.id, now);
    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    expect(JSON.stringify(accountsStore.accounts[p.id])).not.toContain(raw);
    expect(accountsStore.accounts[p.id].passwordReset.tokenHash).toBe(crypto.createHash("sha256").update(raw).digest("hex"));
    expect(RESET_TTL_MS).toBe(60 * 60_000);
    expect(await resetPassword(raw, NEW_PASSWORD, now + RESET_TTL_MS + 1)).toEqual({ ok: false, reason: "spent" });
    expect((await request(app).post("/api/auth/login").send({ email: p.email, password: p.password })).status).toBe(200);
  });

  it("works once: a used token changes nothing", async () => {
    const { app } = await getApp();
    const p = await player(app);
    const raw = issueResetToken(p.id);
    expect((await request(app).post("/api/auth/reset-password").send({ token: raw, password: NEW_PASSWORD })).status).toBe(200);
    const again = await request(app).post("/api/auth/reset-password").send({ token: raw, password: "yet-another-password" });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("This link has expired or was already used. Ask for a new one.");
    expect((await request(app).post("/api/auth/login").send({ email: p.email, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("nonsense changes nothing", async () => {
    const { app } = await getApp();
    for (const token of [undefined, "", "short", "x".repeat(5000), { $gt: "" }]) {
      const r = await request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASSWORD });
      expect(r.status, JSON.stringify(token)).toBe(400);
    }
  });
});

describe("a successful reset (AB#988)", () => {
  it("sets the new password: the old one stops working, the new one logs in", async () => {
    const { app } = await getApp();
    const p = await player(app);
    const res = await request(app).post("/api/auth/reset-password").send({ token: issueResetToken(p.id), password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: true });
    expect((await request(app).post("/api/auth/login").send({ email: p.email, password: p.password })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: p.email, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("revokes every refresh token the account had: a previously issued one then fails", async () => {
    const { app } = await getApp();
    const p = await player(app);
    const login = await request(app).post("/api/auth/login").send({ email: p.email, password: p.password });
    const second = refreshCookieOf(login);
    expect((await freshAgent(app).post("/api/auth/refresh").set("Cookie", `isp_refresh=${second}`)).status).toBe(200);
    const beforeReset = refreshCookieOf(await request(app).post("/api/auth/login").send({ email: p.email, password: p.password }));

    await request(app).post("/api/auth/reset-password").send({ token: issueResetToken(p.id), password: NEW_PASSWORD });
    for (const token of [p.refresh, beforeReset]) {
      expect((await freshAgent(app).post("/api/auth/refresh").set("Cookie", `isp_refresh=${token}`)).status).toBe(401);
    }
    expect(accountsStore.accounts[p.id].refreshTokens).toEqual([]);
  });

  it("tells the owner by email that the password changed", async () => {
    const { app } = await getApp();
    const p = await player(app);
    clearTestOutbox();
    await request(app).post("/api/auth/reset-password").send({ token: issueResetToken(p.id), password: NEW_PASSWORD });
    const mails = mailsTo(p.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/password was changed/i);
    expect(mails[0].text).not.toContain(NEW_PASSWORD);
  });

  it("enforces the password rules, and a refused password does not spend the token", async () => {
    const { app } = await getApp();
    const p = await player(app);
    const raw = issueResetToken(p.id);
    for (const password of ["x".repeat(PASSWORD_MIN_LENGTH - 1), "x".repeat(PASSWORD_MAX_LENGTH + 1), 12345678901, { x: 1 }, undefined]) {
      const r = await request(app).post("/api/auth/reset-password").send({ token: raw, password });
      expect(r.status, JSON.stringify(password)).toBe(400);
      expect(r.body, JSON.stringify(password)).toEqual({ error: `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`, field: "password" });
    }
    expect((await request(app).post("/api/auth/reset-password").send({ token: raw, password: NEW_PASSWORD })).status).toBe(200);
  });
});

describe("what is never logged (AB#988)", () => {
  it("neither the email address nor the new password", async () => {
    const { app } = await getApp();
    const p = await player(app);
    const lines = [];
    for (const level of ["log", "info", "warn", "error"]) vi.spyOn(console, level).mockImplementation((...a) => lines.push(a.join(" ")));
    clearTestOutbox();
    await request(app).post("/api/auth/forgot-password").send({ email: p.email });
    await request(app).post("/api/auth/reset-password").send({ token: tokenIn(mailsTo(p.email)[0].text), password: NEW_PASSWORD });
    const all = lines.join("\n");
    expect(all).not.toContain(p.email);
    expect(all).not.toContain(NEW_PASSWORD);
  });
});

describe("the request is rate-limited per address and per client (AB#988)", () => {
  async function limited(envName, value, bodies) {
    const saved = process.env[envName];
    process.env[envName] = value;
    vi.resetModules();
    try {
      const { forgotPasswordIpLimiter, forgotPasswordAccountLimiter } = await import("../../server/rateLimiters.js");
      const express = (await import("express")).default;
      const mini = express();
      mini.use(express.json());
      mini.post("/f", forgotPasswordIpLimiter, forgotPasswordAccountLimiter, (_req, res) => res.status(202).json({ ok: true }));
      const statuses = [];
      for (const body of bodies) statuses.push((await request(mini).post("/f").send(body)).status);
      return statuses;
    } finally {
      if (saved === undefined) delete process.env[envName];
      else process.env[envName] = saved;
      vi.resetModules();
    }
  }

  it("per address: the third request for one address is refused, though another address still goes through", async () => {
    const one = { email: "one@example.com" };
    expect(await limited("ISP_RATE_LIMIT_FORGOT_ACCOUNT_MAX", "2", [one, one, one, { email: "two@example.com" }])).toEqual([202, 202, 429, 202]);
  });

  it("per client: the third request from one client is refused, whatever the address", async () => {
    expect(await limited("ISP_RATE_LIMIT_FORGOT_IP_MAX", "2", [{ email: "a@example.com" }, { email: "b@example.com" }, { email: "c@example.com" }])).toEqual([202, 202, 429]);
  });
});
