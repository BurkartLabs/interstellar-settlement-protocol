// AB#734 (ISP-48): the shared per-account throttle on state-changing routes under /api/accounts/:accountId and
// /api/market. Env override set before server/index.js is imported gives this file its own small threshold
// (tests/helpers/app.js gives every file a fresh module instance); every other test file keeps the generous
// NODE_ENV=test default from server/rateLimiters.js.
import { describe, it, expect, beforeAll } from "vitest";
import { registerAccount, authed } from "../helpers/api.js";

process.env.ISP_RATE_LIMIT_ACCOUNT_ACTION_MAX = "3";

let app;

beforeAll(async () => {
  ({ app } = await import("../../server/index.js"));
});

describe("the shared per-account action limit (AB#734)", () => {
  it("trips at the configured limit on an /api/accounts/:accountId route and answers 429", async () => {
    const { account, accessToken } = await registerAccount(app);
    const auth = authed(app, accessToken);

    for (let i = 0; i < 3; i++) {
      const res = await auth.post(`/api/accounts/${account.id}/notifications/read-all`);
      expect(res.status).toBe(200);
    }

    const blocked = await auth.post(`/api/accounts/${account.id}/notifications/read-all`);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeTruthy();
  });

  it("does not limit a GET under the same account", async () => {
    const { account, accessToken } = await registerAccount(app);
    const auth = authed(app, accessToken);

    // Spend the whole state-changing budget, then confirm reads still work.
    for (let i = 0; i < 3; i++) {
      await auth.post(`/api/accounts/${account.id}/notifications/read-all`);
    }
    const stillTripped = await auth.post(`/api/accounts/${account.id}/notifications/read-all`);
    expect(stillTripped.status).toBe(429);

    const read = await auth.get(`/api/accounts/${account.id}`);
    expect(read.status).toBe(200);
  });

  it("shares one bucket across /api/accounts/:accountId and /api/market for the same account", async () => {
    const { account, accessToken } = await registerAccount(app);
    const auth = authed(app, accessToken);

    // Two on the accounts side, then the market side trips on its own next call — proving one shared counter,
    // not a separate budget per route family.
    await auth.post(`/api/accounts/${account.id}/notifications/read-all`);
    await auth.post(`/api/accounts/${account.id}/notifications/read-all`);
    // The order itself doesn't need to succeed - a fresh account has nothing to sell - only that the limiter
    // counts it, whatever the route later decides about the body.
    const thirdOnMarket = await auth.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 1, unitPrice: 1 });
    expect(thirdOnMarket.status).not.toBe(429);

    const blocked = await auth.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 1, unitPrice: 1 });
    expect(blocked.status).toBe(429);
  });

  it("leaves a different account's budget untouched", async () => {
    const tripped = await registerAccount(app);
    const other = await registerAccount(app);
    const trippedAuth = authed(app, tripped.accessToken);
    const otherAuth = authed(app, other.accessToken);

    for (let i = 0; i < 4; i++) {
      await trippedAuth.post(`/api/accounts/${tripped.account.id}/notifications/read-all`);
    }
    const stillBlocked = await trippedAuth.post(`/api/accounts/${tripped.account.id}/notifications/read-all`);
    expect(stillBlocked.status).toBe(429);

    const unaffected = await otherAuth.post(`/api/accounts/${other.account.id}/notifications/read-all`);
    expect(unaffected.status).toBe(200);
  });
});
