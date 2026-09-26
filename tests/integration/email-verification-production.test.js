// Before the server module loads (vitest gives each test file its own copy): production, with a public URL, and no
// real mail transport, which is the deployed beta until AB#989 wires one.
process.env.NODE_ENV = "production";
process.env.ISP_PUBLIC_URL = "https://isp.example";

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// AB#987: in production with no real transport, no link can be sent, so asking for one fails closed, the same for
// every address, and nothing was issued that could not be delivered.
describe("verification mail in production with no transport (AB#987)", () => {
  beforeAll(async () => { await getApp(); });

  it("registration answers 503 and creates nothing: the account could never be verified (AB#2288)", async () => {
    const { app } = await getApp();
    const { accountsStore } = await import("../../server/game/store.js");
    const before = Object.keys(accountsStore.accounts).length;
    const email = `prod-${Date.now()}@example.com`;
    const res = await request(app).post("/api/auth/register").send({ email, password: "a-fine-password", ceoName: "Prod CEO", corpName: `Prod Corp ${Date.now()}` });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("mail-unavailable");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(Object.keys(accountsStore.accounts)).toHaveLength(before);
    expect(Object.values(accountsStore.accounts).some((a) => a.email === email)).toBe(false);
  });

  it("asking for a link answers 503, identically for any address", async () => {
    const { app } = await getApp();
    const answers = [];
    for (const email of ["someone@example.com", `nobody-${Date.now()}@example.com`, "not an address"]) {
      const res = await request(app).post("/api/auth/resend-verification").send({ email });
      answers.push([res.status, res.body]);
    }
    expect(answers[0][0]).toBe(503);
    expect(answers[0][1]).toEqual({ error: "Email is not available on this server yet, so no link can be sent." });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("asking for a password-reset link answers 503, identically for any address (AB#988)", async () => {
    const { app } = await getApp();
    const answers = [];
    for (const email of ["someone@example.com", `nobody-${Date.now()}@example.com`, "not an address"]) {
      const res = await request(app).post("/api/auth/forgot-password").send({ email });
      answers.push([res.status, res.body]);
    }
    expect(answers[0][0]).toBe(503);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });
});
