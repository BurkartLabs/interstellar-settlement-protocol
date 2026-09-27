import { describe, it, expect, beforeAll, afterAll } from "vitest";

// AB#910: the per-sender limits from docs/design/messaging.md trip and say when to try again. They are server limits:
// the count is per sender and per window, and nothing about the message or its recipient changes it. This file's own
// module instance gets small limits (the production defaults are 30 a minute, 600 an hour, 60 new conversations an hour).
process.env.ISP_RATE_LIMIT_MESSAGE_MINUTE_MAX = "3";
process.env.ISP_RATE_LIMIT_NEW_CONVERSATION_MAX = "2";
const { getApp } = await import("../helpers/app.js");
const { registerAccount, authed } = await import("../helpers/api.js");
const { getAccountById } = await import("../../server/gameState.js");

let app, server;
beforeAll(async () => ({ app, server } = await getApp()));
afterAll(async () => new Promise((resolve) => server.close(resolve)));

async function player() {
  const { account, accessToken } = await registerAccount(app);
  return { id: account.id, publicId: getAccountById(account.id).state.corp.publicId, api: authed(app, accessToken), base: `/api/accounts/${account.id}` };
}
const send = (from, to, body = "hello") => from.api.post(`${from.base}/conversations/send`).send({ toCorpId: to.publicId, body });

describe("per-sender rate limits (AB#910)", () => {
  it("trips at the per-minute limit with 429 and Retry-After, for this sender only", async () => {
    const a = await player(), b = await player(), c = await player();
    for (let i = 0; i < 3; i++) expect((await send(a, b, `m${i}`)).status).toBe(201);
    const over = await send(a, b, "one too many");
    expect(over.status).toBe(429);
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
    expect(over.body.error).toMatch(/try again/i);
    expect((await send(c, b, "someone else")).status).toBe(201); // another sender has their own count
  });

  it("limits first messages to new corporations, not replies in a conversation that exists", async () => {
    const a = await player(), b = await player(), c = await player(), d = await player();
    expect((await send(a, b)).status).toBe(201);
    expect((await send(a, c)).status).toBe(201);
    const third = await send(a, d);
    expect(third.status).toBe(429);
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
  });
});
