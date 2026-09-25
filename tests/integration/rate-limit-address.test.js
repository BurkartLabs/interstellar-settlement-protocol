// ISP-64: per-address limits on login, register and refresh, plus the trust-proxy hop count. Overrides the
// production defaults with small numbers via env vars set before server/index.js is imported below — this file
// gets its own fresh module instance (tests/helpers/app.js), so the override is invisible to every other test
// file, which keeps running under the generous NODE_ENV=test defaults (server/rateLimiters.js).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

process.env.ISP_RATE_LIMIT_LOGIN_IP_MAX = "3";
process.env.ISP_RATE_LIMIT_LOGIN_ACCOUNT_MAX = "1000";
process.env.ISP_RATE_LIMIT_REGISTER_MAX = "3";
process.env.ISP_RATE_LIMIT_REFRESH_MAX = "3";

let app;

beforeAll(async () => {
  ({ app } = await import("../../server/index.js"));
});

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("per-address rate limits (ISP-64)", () => {
  it("blocks the 4th login attempt in a minute from the same address with 429, Retry-After and copy", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({ email: `nobody-${unique()}@example.com`, password: "whatever123" });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ email: `nobody-${unique()}@example.com`, password: "whatever123" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeTruthy();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.body.error).toMatch(/try again/i);
  });

  it("blocks the 4th registration in an hour from the same address with 429", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", "203.0.113.20")
        .send({
          email: `reg-${unique()}@example.com`,
          password: "supersecret123",
          ceoName: "Rate CEO",
          corpName: `RateCorp-${unique()}`
        });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", "203.0.113.20")
      .send({
        email: `reg-${unique()}@example.com`,
        password: "supersecret123",
        ceoName: "Rate CEO",
        corpName: `RateCorp-${unique()}`
      });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeTruthy();
  });

  it("blocks the 4th refresh in a minute from the same address with 429", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/auth/refresh")
        .set("X-Forwarded-For", "203.0.113.30")
        .set("Cookie", "isp_refresh=not-a-real-token");
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post("/api/auth/refresh")
      .set("X-Forwarded-For", "203.0.113.30")
      .set("Cookie", "isp_refresh=not-a-real-token");

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeTruthy();
  });

  it("trusts exactly one hop: a spoofed X-Forwarded-For prefix cannot reset the address key", async () => {
    // The real client address is the rightmost entry — the one the (one trusted) proxy appended. Everything a
    // client prepends ahead of it is untrusted and must not create a fresh bucket.
    const real = "198.51.100.77";
    for (let i = 0; i < 3; i++) {
      const spoofPrefix = `attacker-hop-${i}`;
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `${spoofPrefix}, ${real}`)
        .send({ email: `nobody-${unique()}@example.com`, password: "whatever123" });
      expect(res.status).toBe(401);
    }

    // A 4th request, with yet another spoofed prefix ahead of the same real address, is still the same client.
    const blocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", `yet-another-fake-hop, ${real}`)
      .send({ email: `nobody-${unique()}@example.com`, password: "whatever123" });
    expect(blocked.status).toBe(429);

    // A genuinely different rightmost address is a different client and is not affected.
    const distinctClient = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "198.51.100.200")
      .send({ email: `nobody-${unique()}@example.com`, password: "whatever123" });
    expect(distinctClient.status).toBe(401);
  });
});
