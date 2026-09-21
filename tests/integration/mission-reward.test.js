import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #1009: complete-mission took the quota and paid the reward into corp.credits, which nothing reads, so the
// player's balance never rose. It now pays into finances.credits and books the reward as income.
async function contractor(completedInsights = []) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.inventory = { "earth-station-prime": { Silicates: 150 } };
    state.corp.finances.credits = 50000;
    state.corp.finances.incomeBySource = {};
    state.corp.completedInsights = completedInsights;
    state.corp.activeMissions = [{ id: "m-1009", title: "Silicate run", type: "delivery", agentId: "agent-test",
      reward: "12,000 Credits", quota: { resource: "Silicates", amount: 100 } }];
  });
  const api = authed(app, accessToken);
  return { id: account.id, complete: () => api.post(`/api/accounts/${account.id}/gameplay/complete-mission`).send({ missionId: "m-1009" }),
    corp: () => getAccountById(account.id).state.corp };
}

describe("POST /gameplay/complete-mission pays the reward (Bug #1009)", () => {
  it("adds the reward to the spendable balance and books it as mission income", async () => {
    const { complete, corp } = await contractor();
    const res = await complete();
    expect(res.status).toBe(200);
    const c = corp();
    expect(c.finances.credits).toBe(50000 + 12000);
    expect(c.finances.incomeBySource.missions).toBe(12000);
    expect(c.finances.dailyRevenue).toBeGreaterThanOrEqual(12000);
    expect(c.credits).toBeUndefined();
    expect(c.inventory["earth-station-prime"].Silicates).toBe(50);
  });

  it("pays 8% more with Contract Law Essentials", async () => {
    const { complete, corp } = await contractor(["ceo-negotiation-fundamentals", "ceo-contract-law"]);
    expect((await complete()).status).toBe(200);
    expect(corp().finances.credits).toBe(50000 + 12960);
  });

  it("pays nothing, and takes nothing, when the quota is short", async () => {
    const { id, complete, corp } = await contractor();
    mutateAccountState(id, (state) => { state.corp.inventory["earth-station-prime"].Silicates = 10; });
    const res = await complete();
    expect(res.status).toBe(400);
    expect(corp().finances.credits).toBe(50000);
    expect(corp().inventory["earth-station-prime"].Silicates).toBe(10);
  });
});
