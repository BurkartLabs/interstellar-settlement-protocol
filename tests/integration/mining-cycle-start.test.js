import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// AB#575: both routes that start a mining cycle must zero the per-cycle count, not only the helper they call.
async function corpAfterOneCycle() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const leaseId = "lease-575";
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    const now = Date.now();
    corp.offices = [{ stationId: "earth-station-prime", rentedAt: now, rentedUntil: now + 7 * 86_400_000, durationDays: 7 }];
    corp.employeeCount = 5;
    corp.miningLeases = [{ id: leaseId, body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: ["ext-basic-1"] }];
    corp.buildings = [...(corp.buildings || []), { name: "Basic Extractor Yard", tier: 1, status: "Operational" }];
    corp.mining.silicateExtractors = [{
      id: "ext-basic-1", name: "Basic Extractor Yard #1", tier: 1, active: false, startedAt: null, lastTickAt: null, endsAt: null,
      throughputPerHour: 250, operationCostPerHour: 4000, totalMined: 600, minedThisCycle: 600, totalSpent: 0, leaseId, body: "Earth"
    }];
  });
  const api = authed(app, accessToken);
  const extractor = () => getAccountById(account.id).state.corp.mining.silicateExtractors[0];
  return { api, id: account.id, leaseId, extractor };
}

describe("starting a second mining cycle (AB#575)", () => {
  it("POST /gameplay/lease/:leaseId/start-mining zeroes minedThisCycle and keeps totalMined", async () => {
    const c = await corpAfterOneCycle();
    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/${c.leaseId}/start-mining`).send({ hours: 1 });
    expect(res.status).toBe(200);
    expect(c.extractor()).toMatchObject({ active: true, minedThisCycle: 0, totalMined: 600 });
  });

  it("POST /gameplay/mine zeroes minedThisCycle and keeps totalMined", async () => {
    const c = await corpAfterOneCycle();
    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/mine`).send({ amount: 250, hours: 1, extractorId: "ext-basic-1" });
    expect(res.status).toBe(200);
    expect(c.extractor()).toMatchObject({ active: true, minedThisCycle: 0, totalMined: 600 });
  });
});
