import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";

// Bug #589's repro, inverted: a token signed with the old literal fallback does not open anyone's account.
describe("a token signed with the old public fallback secret is refused (Bug #589)", () => {
  it("answers 401 for another account's state", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const forged = jwt.sign({ sub: account.id, kind: "access" }, "isp-dev-insecure-secret-change-me");
    const res = await authed(app, forged).get(`/api/accounts/${account.id}`);
    expect(res.status).toBe(401);
  });
});
