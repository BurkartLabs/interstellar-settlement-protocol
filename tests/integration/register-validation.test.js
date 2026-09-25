// ISP-66 (AB#755, DESIGN's authentication review): createAccount checked password length and duplicate email
// only. Each new rule rejects with a 400 naming the field it is about (register-page.js shows it beside that
// field), and the accepted boundary values are exactly as wide as the acceptance line says.

import { describe, expect, it } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, CEO_NAME_MAX_LENGTH, CEO_NAME_MIN_LENGTH } from "../../server/game/store.js";

let seq = 0;
function good(overrides = {}) {
  seq += 1;
  return {
    email: `validate-${Date.now()}-${seq}@example.com`,
    password: "a-fine-password",
    ceoName: "Alex Rivera",
    corpName: `Validate Corp ${Date.now()}-${seq}`,
    ...overrides
  };
}

describe("POST /api/auth/register field validation (ISP-66)", () => {
  it("rejects a malformed or oversize email, naming the email field", async () => {
    const { app } = await getApp();
    for (const email of ["not-an-email", "no-domain@", "@no-local.com", "has spaces@example.com", "x".repeat(EMAIL_MAX_LENGTH) + "@example.com"]) {
      const res = await request(app).post("/api/auth/register").send(good({ email }));
      expect(res.status, email).toBe(400);
      expect(res.body.field, email).toBe("email");
    }
  });

  it("accepts an email at the length limit", async () => {
    const { app } = await getApp();
    const local = "a".repeat(EMAIL_MAX_LENGTH - "@example.com".length);
    const email = `${local}@example.com`;
    expect(email.length).toBe(EMAIL_MAX_LENGTH);
    const res = await request(app).post("/api/auth/register").send(good({ email }));
    expect(res.status).toBe(201);
  });

  it("rejects a password shorter than the minimum or longer than the maximum, naming the password field", async () => {
    const { app } = await getApp();
    for (const password of ["short8x", "x".repeat(PASSWORD_MIN_LENGTH - 1), "x".repeat(PASSWORD_MAX_LENGTH + 1)]) {
      const res = await request(app).post("/api/auth/register").send(good({ password }));
      expect(res.status, `len ${password.length}`).toBe(400);
      expect(res.body.field, `len ${password.length}`).toBe("password");
    }
  });

  it("accepts a password at each boundary", async () => {
    const { app } = await getApp();
    for (const password of ["x".repeat(PASSWORD_MIN_LENGTH), "x".repeat(PASSWORD_MAX_LENGTH)]) {
      const res = await request(app).post("/api/auth/register").send(good({ password }));
      expect(res.status, `len ${password.length}`).toBe(201);
    }
  });

  it("rejects a CEO name that is too short, too long, empty, or uses a disallowed character, naming the ceoName field", async () => {
    const { app } = await getApp();
    for (const ceoName of ["", "X", "x".repeat(CEO_NAME_MAX_LENGTH + 1), "Alex <Rivera>", "Alex_Rivera"]) {
      const res = await request(app).post("/api/auth/register").send(good({ ceoName }));
      expect(res.status, JSON.stringify(ceoName)).toBe(400);
      expect(res.body.field, JSON.stringify(ceoName)).toBe("ceoName");
    }
  });

  it("accepts a CEO name at each boundary, and trims and collapses spaces the way a corporation name does", async () => {
    const { app } = await getApp();
    for (const ceoName of ["Al", "x".repeat(CEO_NAME_MAX_LENGTH)]) {
      const res = await request(app).post("/api/auth/register").send(good({ ceoName }));
      expect(res.status, `len ${ceoName.length}`).toBe(201);
    }
    const spaced = await request(app).post("/api/auth/register").send(good({ ceoName: "  Alex   Rivera  " }));
    expect(spaced.status).toBe(201);
    expect(spaced.body.account.state.corp.ceo).toBe("Alex Rivera");
  });

  it("never echoes the password back, in a rejection or otherwise", async () => {
    const { app } = await getApp();
    const password = "x".repeat(PASSWORD_MIN_LENGTH - 1);
    const res = await request(app).post("/api/auth/register").send(good({ password }));
    expect(JSON.stringify(res.body)).not.toContain(password);
  });

  it("only email, password hash and names are stored — no other field a hostile body adds is written", async () => {
    const { app } = await getApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...good(), admin: true, level: 99, credits: 1_000_000 });
    expect(res.status).toBe(201);
    expect(res.body.account).not.toHaveProperty("admin");
    expect(res.body.account.state.corp.level).toBe(0);
    expect(res.body.account.state.corp.finances.credits).not.toBe(1_000_000);
  });
});
