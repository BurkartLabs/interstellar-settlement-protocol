// AB#2288 (ISP-305), slice 2 of email verification: registration sends the link, a new account cannot log in until it
// is followed (403 "Check your email to verify your account."), and an account from before this story is prompted to
// verify at its next login instead of being refused. The mechanism for the second: accounts carry verificationPolicy,
// "required" from createAccount and "prompt" set once, by a migration at load, on every account that lacked it.

import { describe, expect, it } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { verifyEmailFor } from "../helpers/api.js";
import { clearTestOutbox, testOutbox } from "../../server/mail.js";
import { accountsStore, listAccountNotifications } from "../../server/game/store.js";
import { backfillVerificationPolicy, loginBlockedByVerification } from "../../server/game/verificationPolicy.js";
import { issueResetToken } from "../../server/passwordReset.js";

let seq = 0;
function applicant() {
  seq += 1;
  const stamp = `${Date.now()}-${seq}`;
  return { email: `gate-${stamp}@example.com`, password: "a-fine-password", ceoName: "Gate CEO", corpName: `Gate Corp ${stamp}` };
}
const idOf = (email) => Object.values(accountsStore.accounts).find((a) => a.email === email)?.id;

describe("registration sends the verification link, and gives no session (AB#2288)", () => {
  it("201 with one link in the outbox, no tokens and no cookie", async () => {
    const { app } = await getApp();
    const who = applicant();
    clearTestOutbox();
    const res = await request(app).post("/api/auth/register").send(who);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ verificationSent: true });
    expect(res.headers["set-cookie"]).toBeUndefined();
    const mails = testOutbox().filter((m) => m.to === who.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toMatch(/\/verify-email\.html#token=/);
    expect(accountsStore.accounts[idOf(who.email)].verificationPolicy).toBe("required");
  });
});

describe("a new account cannot log in until its link is followed (AB#2288)", () => {
  it("403 'Check your email to verify your account.' before, a session after", async () => {
    const { app } = await getApp();
    const who = applicant();
    await request(app).post("/api/auth/register").send(who);
    const before = await request(app).post("/api/auth/login").send({ email: who.email, password: who.password });
    expect(before.status).toBe(403);
    expect(before.body).toEqual({ error: "Check your email to verify your account.", code: "email-unverified" });
    expect(before.headers["set-cookie"]).toBeUndefined();

    await verifyEmailFor(app, who.email);
    const after = await request(app).post("/api/auth/login").send({ email: who.email, password: who.password });
    expect(after.status).toBe(200);
    expect(after.body.accessToken).toBeTruthy();
  });

  it("a wrong password is 401 as before, so the 403 says nothing to someone without the password", async () => {
    const { app } = await getApp();
    const who = applicant();
    await request(app).post("/api/auth/register").send(who);
    const wrong = await request(app).post("/api/auth/login").send({ email: who.email, password: "not-the-password" });
    expect(wrong.status).toBe(401);
  });

  it("a refused login changes nothing on the account (no login time, no notification)", async () => {
    const { app } = await getApp();
    const who = applicant();
    await request(app).post("/api/auth/register").send(who);
    const id = idOf(who.email);
    const lastLogin = accountsStore.accounts[id].lastLoginAt;
    const notes = listAccountNotifications(id).notifications.length;
    await request(app).post("/api/auth/login").send({ email: who.email, password: who.password });
    expect(accountsStore.accounts[id].lastLoginAt).toBe(lastLogin);
    expect(listAccountNotifications(id).notifications).toHaveLength(notes);
  });
});

describe("an account from before this story is prompted, not refused (AB#2288)", () => {
  it("the migration sets 'prompt' once, on accounts that lack a policy, and leaves the rest", () => {
    const accounts = { a: { id: "a" }, b: { id: "b", verificationPolicy: "required" }, c: { id: "c", emailVerifiedAt: 1 } };
    expect(backfillVerificationPolicy(accounts)).toBe(2);
    expect(accounts.a.verificationPolicy).toBe("prompt");
    expect(accounts.b.verificationPolicy).toBe("required");
    expect(accounts.c.verificationPolicy).toBe("prompt");
    expect(backfillVerificationPolicy(accounts)).toBe(0);
  });

  it("an unknown or missing policy fails closed: the login is refused until verified", () => {
    expect(loginBlockedByVerification({})).toBe(true);
    expect(loginBlockedByVerification({ verificationPolicy: "anything" })).toBe(true);
    expect(loginBlockedByVerification({ verificationPolicy: "prompt" })).toBe(false);
    expect(loginBlockedByVerification({ verificationPolicy: "required", emailVerifiedAt: 1 })).toBe(false);
  });

  it("logs in, and finds a notification asking it to verify; once verified, the prompt stops", async () => {
    const { app } = await getApp();
    const who = applicant();
    await request(app).post("/api/auth/register").send(who);
    const id = idOf(who.email);
    accountsStore.accounts[id].verificationPolicy = "prompt"; // what the migration gives an account from before

    const login = await request(app).post("/api/auth/login").send({ email: who.email, password: who.password });
    expect(login.status).toBe(200);
    const prompts = () => listAccountNotifications(id).notifications.filter((n) => n.title === "Verify your email address");
    expect(prompts()).toHaveLength(1);
    expect(prompts()[0].body).toMatch(/check-email/);

    await verifyEmailFor(app, who.email);
    await request(app).post("/api/auth/login").send({ email: who.email, password: who.password });
    expect(prompts()).toHaveLength(1);
  });
});

describe("a password reset verifies the address it was mailed to (AB#2288)", () => {
  it("an unverified account that resets its password can log in with the new one", async () => {
    const { app } = await getApp();
    const who = applicant();
    await request(app).post("/api/auth/register").send(who);
    const reset = await request(app).post("/api/auth/reset-password").send({ token: issueResetToken(idOf(who.email)), password: "a-new-password-here" });
    expect(reset.status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: who.email, password: "a-new-password-here" })).status).toBe(200);
  });
});
