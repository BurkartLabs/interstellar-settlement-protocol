import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #689: POST /api/investments took the investor's credits and paid nobody, stored any strings as given, and a
// negative amount minted credits. It was a prototype of the v0.9 equity system and is removed until that exists.
describe("POST /api/investments is gone (Bug #689)", () => {
  for (const [label, amount] of [["a negative amount", -5000], ["a positive amount", 50000]]) {
    it(`answers 404 to ${label} and leaves the caller's credits and investments alone`, async () => {
      const { app } = await getApp();
      const { account, accessToken } = await registerAccount(app);
      mutateAccountState(account.id, (state) => {
        state.corp.level = 5;
        state.corp.finances.credits = 100000;
      });
      const res = await authed(app, accessToken).post("/api/investments")
        .send({ targetCorp: "x".repeat(10000), amount, instrument: "equity" });
      expect(res.status).toBe(404);
      const corp = getAccountById(account.id).state.corp;
      expect(corp.finances.credits).toBe(100000);
      expect(corp.investments || []).toEqual([]);
    });
  }
});
