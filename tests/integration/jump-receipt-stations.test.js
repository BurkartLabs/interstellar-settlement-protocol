import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState } from "../../server/gameState.js";

// AB#2333: a jump's receipt says what to do on arrival, truthfully (Bug #1058's rule). It named "a station in that
// system" even for AB#806's six new systems, which have none yet.
async function jumpTo(toSystemId) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => { state.corp.unlockedTech = ["tt-proxima-navigation", "tt-deep-star-navigation"]; });
  const res = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/travel`).send({ toSystemId });
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  return res.body.receipt;
}

describe("the jump receipt's next step (AB#2333)", () => {
  it("to a system with no station, says there is nowhere to dock and what can be done there", async () => {
    for (const system of ["lalande-21185", "sirius"]) {
      const receipt = await jumpTo(system);
      expect(receipt.next, system).toContain("There is no station in that system yet");
      expect(receipt.next, system).not.toContain("choose a station");
    }
  });

  it("to a system with a station, names it", async () => {
    const receipt = await jumpTo("alpha-centauri");
    expect(receipt.next).toBe("When you arrive, dock at Centauri Prime Orbital from the Starmap's system view.");
  });
});
