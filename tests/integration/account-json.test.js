import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore, sanitizeAccount, settledAccount } from "../../server/game/store.js";
import { accountJson } from "../../server/accountJson.js";

// Bug #4849: GET /api/accounts/:id sends accountJson(settledAccount(id)), the account's JSON made from the store
// without the deep copy sanitizeAccount makes. It must be exactly what JSON.stringify(sanitizeAccount(account)) was.
describe("an account's JSON without a copy (Bug #4849)", () => {
  it("is the same string JSON.stringify(sanitizeAccount(...)) gives, for a new account and an old save", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const held = settledAccount(account.id);
    expect(accountJson(held)).toBe(JSON.stringify(sanitizeAccount(held)));

    // an old save: a world of its own, statements inside, no last login, no walkthrough flag
    const old = { ...held, lastLoginAt: undefined, walkthroughCompleted: undefined, state: { ...held.state, world: { systems: [{ id: "x" }] }, statements: [{ day: "2026-09-01" }] } };
    expect(accountJson(old)).toBe(JSON.stringify(sanitizeAccount(old)));
    const parsed = JSON.parse(accountJson(old));
    expect(parsed.state.statements).toBeUndefined();
    expect(parsed.state.world.systems.length).toBeGreaterThan(1); // the public world, not the old save's own
    expect(accountJson({ id: "a", state: {} })).toBe(JSON.stringify(sanitizeAccount({ id: "a", state: {} })));
  });

  it("GET /api/accounts/:id answers with it, and changing the answer cannot change the store", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const res = await authed(app, accessToken).get(`/api/accounts/${account.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(sanitizeAccount(settledAccount(account.id)))));
    res.body.state.corp.corporationName = "changed by the page";
    expect(accountsStore.accounts[account.id].state.corp.corporationName).not.toBe("changed by the page");
  });
});
