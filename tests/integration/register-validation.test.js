// ISP-66 (AB#755, DESIGN's authentication review): createAccount checked password length and duplicate email
// only. Each new rule rejects with a 400 naming the field it is about (register-page.js shows it beside that
// field), and the accepted boundary values are exactly as wide as the acceptance line says.

import { describe, expect, it } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { storedAccountByEmail, verifyEmailFor } from "../helpers/api.js";
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
    const body = good({ ceoName: "  Alex   Rivera  " });
    const spaced = await request(app).post("/api/auth/register").send(body);
    expect(spaced.status).toBe(201);
    expect((await storedAccountByEmail(body.email)).account.state.corp.ceo).toBe("Alex Rivera");
  });

  it("never echoes the password back, in a rejection or otherwise", async () => {
    const { app } = await getApp();
    const password = "x".repeat(PASSWORD_MIN_LENGTH - 1);
    const res = await request(app).post("/api/auth/register").send(good({ password }));
    expect(JSON.stringify(res.body)).not.toContain(password);
  });

  it("only email, password hash and names are stored — no other field a hostile body adds is written", async () => {
    const { app } = await getApp();
    const body = { ...good(), admin: true, level: 99, credits: 1_000_000 };
    const res = await request(app).post("/api/auth/register").send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ verificationSent: true }); // AB#2288: nothing of the account comes back
    const { account, raw } = await storedAccountByEmail(body.email);
    for (const field of ["admin", "level", "credits"]) {
      expect(account).not.toHaveProperty(field);
      expect(raw).not.toHaveProperty(field);
    }
    expect(account.state.corp.level).toBe(0);
    expect(account.state.corp.finances.credits).not.toBe(1_000_000);
  });
});

// Bug #2050: every field was read through String() before any rule ran, so a password of {"x":1} became the password
// "[object Object]", which anyone can guess, and ["Type Corp Four"] a corporation name. A value that is not a string is
// refused with its field's own message, no account is made, and nothing sent comes back.
describe("POST /api/auth/register refuses a field that is not a string (Bug #2050)", () => {
  const WRONG_TYPES = [{ x: 1 }, {}, [], ["Sup3rSecret-Echo-Me"], ["Alex Rivera"], 12345, true, null];

  for (const field of ["email", "password", "ceoName", "corpName"]) {
    it(`${field}: an object, an array, a number, a boolean or null is a 400 naming ${field}, and makes no account`, async () => {
      const { app } = await getApp();
      for (const value of WRONG_TYPES) {
        const body = good({ [field]: value });
        const what = `${field} = ${JSON.stringify(value)}`;
        const res = await request(app).post("/api/auth/register").send(body);
        expect(res.status, what).toBe(400);
        expect(res.body.field, what).toBe(field);
        expect(res.body.account, what).toBeUndefined();
        expect(JSON.stringify(res.body), what).not.toContain("Sup3rSecret");
        if (field !== "email") {
          // Nothing was made under that email: it registers once every field is a string.
          const again = await request(app).post("/api/auth/register").send({ ...body, [field]: good()[field] });
          expect(again.status, `${what}, then sent properly`).toBe(201);
        }
      }
    });
  }

  it('a password of {"x":1} makes no account that "[object Object]" signs in to', async () => {
    const { app } = await getApp();
    const body = good({ password: { x: 1 } });
    expect((await request(app).post("/api/auth/register").send(body)).status).toBe(400);
    const login = await request(app).post("/api/auth/login").send({ email: body.email, password: "[object Object]" });
    expect(login.status).toBe(401);
  });
});

describe("POST /api/auth/login compares strings only (Bug #2050)", () => {
  it('a password that is not a string is a 401, even for an account whose password really is "[object Object]"', async () => {
    const { app } = await getApp();
    const body = good({ password: "[object Object]" }); // 15 characters, a legitimate password typed as text
    expect((await request(app).post("/api/auth/register").send(body)).status).toBe(201);
    await verifyEmailFor(app, body.email); // AB#2288: a new account logs in once verified
    expect((await request(app).post("/api/auth/login").send({ email: body.email, password: "[object Object]" })).status).toBe(200);
    for (const password of [{ x: 1 }, {}, ["[object Object]"], 12345, true]) {
      const res = await request(app).post("/api/auth/login").send({ email: body.email, password });
      expect(res.status, JSON.stringify(password)).toBe(401);
    }
    for (const email of [[body.email], { email: body.email }]) {
      const res = await request(app).post("/api/auth/login").send({ email, password: "[object Object]" });
      expect(res.status, JSON.stringify(email)).toBe(401);
    }
  });
});
