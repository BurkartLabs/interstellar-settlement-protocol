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
    expect(again.body).toEqual({ error: "An account with this email already exists.", code: "email-taken" });
  });

  it("other refusals carry no code: the page shows the server's reason", async () => {
    const { app } = await getApp();
    const res = await request(app).post("/api/auth/register").send({ ...account(), corpName: "" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A corporation name is required." });
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
