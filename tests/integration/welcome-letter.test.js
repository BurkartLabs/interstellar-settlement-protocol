import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";

// AB#585: the letter a new corporation actually receives, through the real register and messages routes.
describe("POST /api/auth/register welcome letter (AB#585)", () => {
  it("is signed by Elara Voss and names no Aria", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app, { corpName: "Orison Minerals" });
    const res = await authed(app, accessToken).get(`/api/accounts/${account.id}/messages`);
    expect(res.status).toBe(200);
    const letter = (res.body.messages || []).find((m) => /ISA Settlement Licence/.test(m.subject || ""));
    expect(letter).toBeTruthy();
    expect(letter.body).toContain("Elara Voss\nSenior Logistics Coordinator");
    expect(letter.body).toContain("To the registered CEO of Orison Minerals,");
    expect(letter.body).not.toMatch(/aria/i);
  });
});
