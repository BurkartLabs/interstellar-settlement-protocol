// ISP-64: the per-account login lockout. Keyed on the normalized email, not the address, and only failed
// attempts count. Env overrides set before server/index.js is imported give this file its own small threshold
// (tests/helpers/app.js gives every file a fresh module instance); every other test file keeps the generous
// NODE_ENV=test defaults from server/rateLimiters.js.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

process.env.ISP_RATE_LIMIT_LOGIN_IP_MAX = "1000";
process.env.ISP_RATE_LIMIT_LOGIN_ACCOUNT_MAX = "3";
process.env.ISP_RATE_LIMIT_REGISTER_MAX = "1000";
process.env.ISP_RATE_LIMIT_REFRESH_MAX = "1000";

let app;

beforeAll(async () => {
  ({ app } = await import("../../server/index.js"));
});

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function register(email) {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "supersecret123",
    ceoName: "Lockout CEO",
    corpName: `LockoutCorp-${unique()}`
  });
  expect(res.status).toBe(201);
}

describe("per-account login lockout (ISP-64)", () => {
  it("blocks the 4th failed login for one account in the window with 429, Retry-After and copy", async () => {
    const email = `lockout-a-${unique()}@example.com`;
    await register(email);

    for (let i = 0; i < 3; i++) {
      // Each attempt claims a different address, proving the lockout tracks the account, not the caller's IP.
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `192.0.2.${i}`)
        .send({ email, password: "wrong-password" });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "192.0.2.99")
      .send({ email, password: "wrong-password" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeTruthy();
    expect(blocked.body.error).toMatch(/try again/i);
    // AB#2043: the account lockout is 15 minutes, and the body says the same number the header does.
    const seconds = Number(blocked.headers["retry-after"]);
    expect(seconds).toBeGreaterThan(14 * 60);
    expect(seconds).toBeLessThanOrEqual(15 * 60);
    expect(blocked.body.error).toMatch(new RegExp(`try again in ${Math.ceil(seconds / 60)} minutes`));

    // The lockout follows the account: even the correct password is refused while it holds.
    const correctButLocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "192.0.2.50")
      .send({ email, password: "supersecret123" });
    expect(correctButLocked.status).toBe(429);
  });

  it("does not count a successful login against the failure budget", async () => {
    const email = `lockout-b-${unique()}@example.com`;
    await register(email);

    const fail1 = await request(app).post("/api/auth/login").send({ email, password: "wrong-1" });
    const fail2 = await request(app).post("/api/auth/login").send({ email, password: "wrong-2" });
    const success = await request(app).post("/api/auth/login").send({ email, password: "supersecret123" });
    // Three real failures total (fail1, fail2, this one) — still at the limit, not over it.
    const fail3 = await request(app).post("/api/auth/login").send({ email, password: "wrong-3" });

    expect(fail1.status).toBe(401);
    expect(fail2.status).toBe(401);
    expect(success.status).toBe(200);
    expect(fail3.status).toBe(401);

    // The 4th real failure is the one that trips it.
    const fail4 = await request(app).post("/api/auth/login").send({ email, password: "wrong-4" });
    expect(fail4.status).toBe(429);
  });

  it("locking one account out leaves a different account's login unaffected", async () => {
    const lockedEmail = `lockout-c-${unique()}@example.com`;
    const otherEmail = `lockout-d-${unique()}@example.com`;
    await register(lockedEmail);
    await register(otherEmail);

    for (let i = 0; i < 4; i++) {
      await request(app).post("/api/auth/login").send({ email: lockedEmail, password: "wrong" });
    }
    const stillLocked = await request(app).post("/api/auth/login").send({ email: lockedEmail, password: "wrong" });
    expect(stillLocked.status).toBe(429);

    const otherAccount = await request(app)
      .post("/api/auth/login")
      .send({ email: otherEmail, password: "supersecret123" });
    expect(otherAccount.status).toBe(200);
  });
});
