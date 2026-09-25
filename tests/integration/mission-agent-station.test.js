import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, MISSION_AGENTS_DATA } from "../../server/gameState.js";

// AB#1203: the page completes a contract only while docked at the agent's station, and the route used to complete it
// wherever the quota sat. The route now holds the page's rule.
const AGENT = MISSION_AGENTS_DATA[0];

async function contractorAt(stationId) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = stationId;
    state.corp.inventory = { [stationId]: { Silicates: 150 } };
    state.corp.finances.credits = 50000;
    state.corp.activeMissions = [{ id: "m-1203", title: "Silicate run", type: "delivery", agentId: AGENT.id,
      reward: "12,000 Credits", quota: { resource: "Silicates", amount: 100 } }];
  });
  const api = authed(app, accessToken);
  return {
    complete: () => api.post(`/api/accounts/${account.id}/gameplay/complete-mission`).send({ missionId: "m-1203" }),
    corp: () => getAccountById(account.id).state.corp
  };
}

describe("complete-mission only at the agent's station (AB#1203)", () => {
  it("the agent has a station to check against", () => {
    expect(AGENT.stationId).toBe("earth-station-prime");
  });

  it("refuses away from the agent's station, takes nothing and pays nothing", async () => {
    const { complete, corp } = await contractorAt("mars-orbital-dock");
    const res = await complete();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^You must be docked at Earth Station Prime to complete this contract\./);
    expect(res.body.error).toMatch(/Mars Orbital Dock/);
    expect(corp().finances.credits).toBe(50000);
    expect(corp().inventory["mars-orbital-dock"].Silicates).toBe(150);
    expect(corp().activeMissions.map((m) => m.id)).toEqual(["m-1203"]);
  });

  it("completes at the agent's station", async () => {
    const { complete, corp } = await contractorAt("earth-station-prime");
    expect((await complete()).status).toBe(200);
    expect(corp().inventory["earth-station-prime"].Silicates).toBe(50);
  });
});
