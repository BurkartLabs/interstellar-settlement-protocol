import { describe, it, expect } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// Bug #1059: what the auth routes answer when a new player gets something wrong; the pages turn it into a next step.
const account = () => ({ email: `auth-errors-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`, password: "supersecret123", ceoName: "Error CEO", corpName: `Error Corp ${Math.random().toString(36).slice(2, 8)}` });

describe("register and login errors (Bug #1059)", () => {
  it("an email already registered answers 400 with code email-taken, so the page can offer the login", async () => {
    const { app } = await getApp();
    const first = account();
    expect((await request(app).post("/api/auth/register").send(first)).status).toBe(201);
    const again = await request(app).post("/api/auth/register").send({ ...account(), email: first.email.toUpperCase() });
    expect(again.status).toBe(400);
    expect(again.body).toEqual({ error: "An account with this email already exists.", code: "email-taken", field: "email" });
  });

  it("a +tag or a Gmail dot is the same mailbox, so it is the same account (Bug #4798)", async () => {
    const { app } = await getApp();
    const register = (email) => request(app).post("/api/auth/register").send({ ...account(), email });
    const base = `alias${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    expect((await register(`${base}+1@example.com`)).status).toBe(201);
    for (const alias of [`${base}+2@example.com`, `${base}@example.com`, `${base.toUpperCase()}+x@Example.com`]) {
      const res = await register(alias);
      expect(res.status, alias).toBe(400);
      expect(res.body.code, alias).toBe("email-taken");
    }
    expect((await register(`${base}.two@example.com`)).status).toBe(201); // dots count everywhere but Gmail
    expect((await register(`${base}@gmail.com`)).status).toBe(201);
    for (const alias of [`${base.slice(0, 3)}.${base.slice(3)}@gmail.com`, `${base}+x@googlemail.com`]) {
      expect((await register(alias)).body.code, alias).toBe("email-taken");
    }
  });

  it("other refusals carry no code, but do name the field (ISP-66): the page shows the server's reason beside it", async () => {
    const { app } = await getApp();
    const res = await request(app).post("/api/auth/register").send({ ...account(), corpName: "" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A corporation name is required.", field: "corpName" });
  });

  it("a wrong password answers 401 and says nothing about which of the two was wrong", async () => {
    const { app } = await getApp();
    const a = account();
    await request(app).post("/api/auth/register").send(a);
    const wrong = await request(app).post("/api/auth/login").send({ email: a.email, password: "not-the-password" });
    const unknown = await request(app).post("/api/auth/login").send({ email: `nobody-${Date.now()}@example.com`, password: "not-the-password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(JSON.stringify(wrong.body)).not.toMatch(/dummy|demo|sandbox/i);
  });
});
