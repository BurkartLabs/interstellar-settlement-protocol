import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// AB#4689 slice 4: a completed contract adds Bureau Standing points, and the completion receipt (AB#744) still names
// the grade. Set up as mission-reward.test.js sets up a contract.
async function contractor({ completedInsights = [], agentReputation } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const give = () => mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "earth-station-prime": { Silicates: 150 } };
    state.corp.completedInsights = completedInsights;
    state.corp.activeMissions = [{ id: "m-4689", title: "Silicate run", type: "delivery", agentId: "elara-voss",
      reward: "12,000 Credits", quota: { resource: "Silicates", amount: 100 } }];
  });
  give();
  if (agentReputation) mutateAccountState(account.id, (state) => { state.corp.agentReputation = agentReputation; });
  const api = authed(app, accessToken);
  return {
    give,
    complete: () => api.post(`/api/accounts/${account.id}/gameplay/complete-mission`).send({ missionId: "m-4689" }),
    rep: () => getAccountById(account.id).state.corp.agentReputation["elara-voss"]
  };
}
const standingLine = (res) => res.body.receipt.grants.find((g) => g.label === "Standing with the agent")?.value;

describe("completing a contract earns Bureau Standing points (AB#4689)", () => {
  it("adds exactly 10 points, and the receipt names the grade it reached", async () => {
    const { complete, rep } = await contractor();
    const res = await complete();
    expect(res.status).toBe(200);
    expect(rep().points).toBe(10);
    expect(standingLine(res)).toBe("Registered (Level 1), raised by this contract");
  });

  it("adds 11 then 12 with Bureaucratic Persuasion", async () => {
    const { give, complete, rep } = await contractor({ completedInsights: ["ceo-bureaucratic-persuasion"] });
    expect((await complete()).status).toBe(200);
    expect(rep().points).toBe(11);
    give();
    expect((await complete()).status).toBe(200);
    expect(rep().points).toBe(23);
  });

  it("carries a save from before points: completedCount 7 is Reliable at 70, and one more contract makes 80", async () => {
    const { complete, rep } = await contractor({ agentReputation: { "elara-voss": { completedCount: 7 } } });
    const res = await complete();
    expect(res.status).toBe(200);
    expect(rep().points).toBe(80);
    expect(rep().completedCount).toBe(8);
    expect(standingLine(res)).toBe("Reliable (Level 3)");
  });
});
