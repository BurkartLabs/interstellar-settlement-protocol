import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { operationCostPerHourFor, startupCostFor } from "../../server/economy.js";

// ISP-301 (AB#2284), ECONOMY.md "Sinks that scale with income" sink 1: every extractor yard after the corporation's
// first pays 41.67 an hour of upkeep while it runs, charged with its running cost. The startup stays priced on the
// running cost without it. Chosen, not derived: the Board has not seen the number (AB#778).
async function corpWithTwoYards() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const leaseId = "lease-2284";
  const idle = (n) => ({
    id: `ext-basic-${n}`, name: `Basic Extractor Yard #${n}`, tier: 1, active: false, startedAt: null, lastTickAt: null, endsAt: null,
    throughputPerHour: 40, operationCostPerHour: 0, totalMined: 0, minedThisCycle: 0, totalSpent: 0, leaseId, body: "Earth"
  });
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    const now = Date.now();
    corp.offices = [{ stationId: "earth-station-prime", rentedAt: now, rentedUntil: now + 7 * 86_400_000, durationDays: 7 }];
    corp.employeeCount = 5;
    corp.miningLeases = [{ id: leaseId, body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: ["ext-basic-1", "ext-basic-2"] }];
    corp.buildings = [...(corp.buildings || []), { name: "Basic Extractor Yard", tier: 1, status: "Operational" }, { name: "Basic Extractor Yard", tier: 1, status: "Operational" }];
    corp.mining.silicateExtractors = [idle(1), idle(2)];
  });
  const api = authed(app, accessToken);
  const start = (extractorId, amount) => api.post(`/api/accounts/${account.id}/gameplay/lease/${leaseId}/start-mining`).send({ hours: 1, amount, extractorId });
  const extractor = (i) => getAccountById(account.id).state.corp.mining.silicateExtractors[i];
  const credits = () => getAccountById(account.id).state.corp.finances.credits;
  return { start, extractor, credits };
}

describe("yard upkeep (AB#2284)", () => {
  for (const rate of [10, 146, 250]) {
    it(`at ${rate} t/h the first yard runs at the old cost and the second at exactly 41.67 an hour more, with the same startup`, async () => {
      const c = await corpWithTwoYards();
      const base = operationCostPerHourFor(rate);

      const before1 = c.credits();
      expect((await c.start("ext-basic-1", rate)).status).toBe(200);
      expect(c.extractor(0).operationCostPerHour).toBe(base);
      expect(before1 - c.credits()).toBe(startupCostFor(base));

      const before2 = c.credits();
      expect((await c.start("ext-basic-2", rate)).status).toBe(200);
      expect(c.extractor(1).operationCostPerHour - base).toBeCloseTo(41.67, 10);
      expect(before2 - c.credits()).toBe(startupCostFor(base));
    });
  }
});
