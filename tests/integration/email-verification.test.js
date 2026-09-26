// AB#987 (ISP-280), slice 1: verification tokens, the verify and resend routes, and the dev outbox. Tokens are 32 random
// bytes, stored only as a hash, single-use, and expire after 24 hours. Resend is rate-limited and answers the same
// whether or not the address has an account. Registration and login are not wired to it yet (slice 2).

import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerUnverified } from "../helpers/api.js";

// AB#2288: registerAccount now verifies as it goes, so these tests start from an account that has not verified yet.
const registerAccount = async (app) => {
  const r = await registerUnverified(app);
  return { account: { id: r.id }, body: { email: r.email } };
};
import { clearTestOutbox, testOutbox } from "../../server/mail.js";
import { accountsStore } from "../../server/game/store.js";
import { issueVerificationToken, isEmailVerified, TOKEN_TTL_MS, verifyEmailToken } from "../../server/emailVerification.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const tokenIn = (text) => text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
const lastMailTo = (email) => testOutbox().filter((m) => m.to === email).at(-1);

describe("verification tokens (AB#987)", () => {
  it("are 32 random bytes, stored only as a hash", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const raw = issueVerificationToken(account.id);
    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    const stored = JSON.stringify(accountsStore.accounts[account.id]);
    expect(stored).not.toContain(raw);
    expect(accountsStore.accounts[account.id].emailVerification.tokenHash).toBe(crypto.createHash("sha256").update(raw).digest("hex"));
  });

  it("verify the account once; a reused token verifies nothing", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const raw = issueVerificationToken(account.id);
    expect(isEmailVerified(account.id)).toBe(false);
    expect(verifyEmailToken(raw)).toBe(account.id);
    expect(isEmailVerified(account.id)).toBe(true);
    expect(verifyEmailToken(raw)).toBeNull();
  });

  it("expire after 24 hours", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const now = Date.now();
    const raw = issueVerificationToken(account.id, now);
    expect(verifyEmailToken(raw, now + TOKEN_TTL_MS + 1)).toBeNull();
    expect(isEmailVerified(account.id)).toBe(false);
    expect(TOKEN_TTL_MS).toBe(24 * 60 * 60_000);
    const fresh = issueVerificationToken(account.id, now);
    expect(verifyEmailToken(fresh, now + TOKEN_TTL_MS - 1)).toBe(account.id);
  });

  it("a new token replaces the old one, and a token verifies only its own account", async () => {
    const { app } = await getApp();
    const a = (await registerAccount(app)).account;
    const b = (await registerAccount(app)).account;
    const first = issueVerificationToken(a.id);
    const second = issueVerificationToken(a.id);
    issueVerificationToken(b.id);
    expect(verifyEmailToken(first)).toBeNull();
    expect(verifyEmailToken(second)).toBe(a.id);
    expect(isEmailVerified(b.id)).toBe(false);
  });

  it("nonsense verifies nothing", () => {
    for (const t of [undefined, null, "", "short", "x".repeat(5000), { token: "x" }]) expect(verifyEmailToken(t)).toBeNull();
  });
});

describe("POST /api/auth/resend-verification and POST /api/auth/verify-email (AB#987)", () => {
  it("sends one link to the test outbox, and following it verifies the account", async () => {
    const { app } = await getApp();
    const { account, body: { email } } = await registerAccount(app);
    clearTestOutbox();
    const resend = await request(app).post("/api/auth/resend-verification").send({ email });
    expect(resend.status).toBe(202);
    const mails = testOutbox().filter((m) => m.to === email);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toMatch(/^.*https?:\/\/[^\s]+\/verify-email\.html#token=[A-Za-z0-9_-]{43}$/m);

    const verify = await request(app).post("/api/auth/verify-email").send({ token: tokenIn(mails[0].text) });
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({ verified: true });
    expect(isEmailVerified(account.id)).toBe(true);

    const again = await request(app).post("/api/auth/verify-email").send({ token: tokenIn(mails[0].text) });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("This link has expired or was already used. Ask for a new one.");
  });

  it("answers identically whether or not the address has an account, and sends only to one that does", async () => {
    const { app } = await getApp();
    const { body: { email } } = await registerAccount(app);
    clearTestOutbox();
    const known = await request(app).post("/api/auth/resend-verification").send({ email });
    const unknown = await request(app).post("/api/auth/resend-verification").send({ email: `nobody-${Date.now()}@example.com` });
    const malformed = await request(app).post("/api/auth/resend-verification").send({ email: { $ne: "" } });
    for (const r of [unknown, malformed]) {
      expect(r.status).toBe(known.status);
      expect(r.body).toEqual(known.body);
    }
    expect(testOutbox()).toHaveLength(1);
  });

  it("sends nothing to an account that is already verified, and still answers the same", async () => {
    const { app } = await getApp();
    const { account, body: { email } } = await registerAccount(app);
    verifyEmailToken(issueVerificationToken(account.id));
    clearTestOutbox();
    const r = await request(app).post("/api/auth/resend-verification").send({ email });
    expect(r.status).toBe(202);
    expect(testOutbox()).toHaveLength(0);
  });

  it("never logs the email address", async () => {
    const { app } = await getApp();
    const { body: { email } } = await registerAccount(app);
    const lines = [];
    for (const level of ["log", "info", "warn", "error"]) vi.spyOn(console, level).mockImplementation((...a) => lines.push(a.join(" ")));
    await request(app).post("/api/auth/resend-verification").send({ email });
    await request(app).post("/api/auth/verify-email").send({ token: tokenIn(lastMailTo(email).text) });
    await request(app).post("/api/auth/verify-email").send({ token: "not-a-token" });
    expect(lines.join("\n")).not.toContain(email);
  });
});

describe("resend is rate-limited (AB#987)", () => {
  it("refuses past its limit with a 429", async () => {
    const saved = process.env.ISP_RATE_LIMIT_RESEND_MAX;
    process.env.ISP_RATE_LIMIT_RESEND_MAX = "2";
    vi.resetModules();
    try {
      const { resendVerificationLimiter } = await import("../../server/rateLimiters.js");
      const express = (await import("express")).default;
      const mini = express();
      mini.use(express.json());
      mini.post("/r", resendVerificationLimiter, (_req, res) => res.status(202).json({ ok: true }));
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await request(mini).post("/r").send({ email: "a@example.com" })).status);
      expect(statuses).toEqual([202, 202, 429]);
    } finally {
      if (saved === undefined) delete process.env.ISP_RATE_LIMIT_RESEND_MAX;
      else process.env.ISP_RATE_LIMIT_RESEND_MAX = saved;
      vi.resetModules();
    }
  });
});
