import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, RESEARCH_LIBRARY } from "../../server/gameState.js";

// AB#861: Capital Hull Engineering and Siege Ordnance unlock destroyers and siege engines, and nothing builds ships
// until v0.10's shipyard (ISP-170, ISP-171). A planned node is shown and refused, so nobody pays 16,000 credits for an
// unlock no route honours (P-INERT-FEATURE), however many prerequisites they have.
describe("planned research (AB#861)", () => {
  it("refuses to queue a planned node, takes no credits, and says why", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const all = Object.keys(RESEARCH_LIBRARY).filter((id) => RESEARCH_LIBRARY[id].status !== "planned");
    mutateAccountState(account.id, (state) => {
      state.corp.unlockedTech = all;
      state.corp.level = 40;
      state.corp.finances.credits = 1_000_000;
    });
    const before = getAccountById(account.id).state.corp.finances.credits;
    for (const techId of ["tt-capital-hulls", "tt-siege-ordnance"]) {
      const res = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/queue-rnd`).send({ techId });
      expect(res.status, techId).toBe(400);
      expect(res.body.error).toMatch(/is not available yet: what it unlocks is planned for a later version/);
    }
    const corp = getAccountById(account.id).state.corp;
    expect(corp.finances.credits).toBe(before);
    expect((getAccountById(account.id).state.queues.corporateRnD || []).map((q) => q.techId)).not.toContain("tt-capital-hulls");
  });
});
