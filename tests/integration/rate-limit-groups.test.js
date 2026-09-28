// AB#958 (ISP-262): one test per cost group that trips its limit, per account and per address. The named groups'
// limits are made small before server/index.js is imported (this file's own module instance); the default group keeps
// the generous NODE_ENV=test limit, so registering the test accounts is not throttled.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { groupEnvName } from "../../server/rateLimitConfig.js";
import { registerAccount, authed } from "../helpers/api.js";

const NAMED = ["trade", "chat", "filing", "construction"];
for (const g of NAMED) {
  process.env[groupEnvName(g, "account")] = "2";
  process.env[groupEnvName(g, "address")] = "3";
}

let app;
beforeAll(async () => {
  ({ app } = await import("../../server/index.js"));
});

/** One route per group, as a player's client calls it. */
const ROUTE = {
  trade: () => "/api/market/orders",
  chat: () => "/api/forums/threads",
  filing: (id) => `/api/accounts/${id}/arbitration/preview`,
  construction: (id) => `/api/accounts/${id}/gameplay/build`
};

let octet = 0;
const nextAddress = () => `198.18.${Math.floor(++octet / 250)}.${(octet % 250) + 1}`;

describe("each cost group trips its own limit (AB#958)", () => {
  for (const group of NAMED) {
    it(`${group}: the 3rd request from one account is refused, from any address, with a retry time`, async () => {
      const { account, accessToken } = await registerAccount(app);
      const api = authed(app, accessToken);
      for (let n = 0; n < 2; n++) {
        const res = await api.post(ROUTE[group](account.id)).set("X-Forwarded-For", nextAddress()).send({});
        expect(res.status, `${group} request ${n + 1}`).not.toBe(429);
      }
      const blocked = await api.post(ROUTE[group](account.id)).set("X-Forwarded-For", nextAddress()).send({});
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      expect(blocked.body.error).toMatch(/try again in \d+ minute/);
      // another account is not held back by this one's count
      const other = await registerAccount(app);
      const fresh = await authed(app, other.accessToken).post(ROUTE[group](other.account.id)).set("X-Forwarded-For", nextAddress()).send({});
      expect(fresh.status).not.toBe(429);
    });

    it(`${group}: the 4th request from one address is refused, signed in or not`, async () => {
      const address = nextAddress();
      for (let n = 0; n < 3; n++) {
        const res = await request(app).post(ROUTE[group]("someone")).set("X-Forwarded-For", address).send({});
        expect(res.status, `${group} request ${n + 1}`).not.toBe(429);
      }
      const blocked = await request(app).post(ROUTE[group]("someone")).set("X-Forwarded-For", address).send({});
      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBeTruthy();
    });
  }

  it("keeps the groups apart: an account at its trade limit can still write in the forums", async () => {
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    for (let n = 0; n < 3; n++) await api.post(ROUTE.trade()).set("X-Forwarded-For", nextAddress()).send({});
    expect((await api.post(ROUTE.trade()).set("X-Forwarded-For", nextAddress()).send({})).status).toBe(429);
    expect((await api.post(ROUTE.chat(account.id)).set("X-Forwarded-For", nextAddress()).send({})).status).not.toBe(429);
  });

  it("trusts one proxy hop: a spoofed X-Forwarded-For prefix does not give a fresh address", async () => {
    const real = nextAddress();
    for (let n = 0; n < 3; n++) {
      await request(app).post(ROUTE.filing("someone")).set("X-Forwarded-For", `6.6.6.${n}, ${real}`).send({});
    }
    const blocked = await request(app).post(ROUTE.filing("someone")).set("X-Forwarded-For", `7.7.7.7, ${real}`).send({});
    expect(blocked.status).toBe(429);
  });
});
