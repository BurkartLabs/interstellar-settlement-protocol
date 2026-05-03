// Supertest helpers for ISP routes.
// Usage:
//   import { freshAgent, registerAccount } from "../helpers/api.js";
//   const { app } = await import("../../server/index.js");
//   const { agent, account, accessToken } = await registerAccount(app);

import request from "supertest";

let registerSeq = 0;

export function freshAgent(app) {
  return request(app);
}

/**
 * Register a brand-new account through the live HTTP route and return the
 * resulting account + tokens. Each call uses a unique email so multiple
 * accounts can coexist in the same test run.
 */
export async function registerAccount(app, overrides = {}) {
  registerSeq += 1;
  const unique = `${Date.now()}-${registerSeq}-${Math.random().toString(36).slice(2, 6)}`;
  const body = {
    email: `tester+${unique}@example.com`,
    password: "supersecret123",
    ceoName: "Test CEO",
    corpName: `TestCorp-${unique}`,
    ...overrides
  };
  const res = await request(app).post("/api/auth/register").send(body);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `registerAccount failed: ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return {
    body,
    account: res.body.account,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    accessTokenExpiresAt: res.body.accessTokenExpiresAt,
    refreshTokenExpiresAt: res.body.refreshTokenExpiresAt
  };
}

/**
 * Returns a function that wraps supertest with the Authorization header
 * already set, so callers can write `auth.get(path)` / `auth.post(path)`.
 */
export function authed(app, accessToken) {
  const agent = request(app);
  const wrap = (method) => (path) =>
    agent[method](path).set("Authorization", `Bearer ${accessToken}`);
  return {
    get: wrap("get"),
    post: wrap("post"),
    put: wrap("put"),
    delete: wrap("delete"),
    patch: wrap("patch")
  };
}
