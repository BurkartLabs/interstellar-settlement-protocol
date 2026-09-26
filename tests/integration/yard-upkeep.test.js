import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { operationCostPerHourFor, startupCostFor } from "../../server/economy.js";

// ISP-301 (AB#2284), ECONOMY.md "Sinks that scale with income" sink 1: an extractor yard past the free ones pays 41.67
// an hour of upkeep while it runs, charged with its running cost. The startup stays priced on the running cost without
// it. ISP-308 (AB#2304, the Director's ruling on AB#2287): the free yards are the first two, a lease's starting kit,
// not only the first. Chosen, not derived: the Board has seen neither the number nor the line (AB#778, AB#2287).
async function corpWithThreeYards() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const leaseId = "lease-2304";
  const idle = (n) => ({
    id: `ext-basic-${n}`, name: `Basic Extractor Yard #${n}`, tier: 1, active: false, startedAt: null, lastTickAt: null, endsAt: null,
    throughputPerHour: 40, operationCostPerHour: 0, totalMined: 0, minedThisCycle: 0, totalSpent: 0, leaseId, body: "Earth"
  });
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    const now = Date.now();
    corp.offices = [{ stationId: "earth-station-prime", rentedAt: now, rentedUntil: now + 7 * 86_400_000, durationDays: 7 }];
    corp.employeeCount = 5;
    corp.buildingSlots = 3;
    corp.miningLeases = [{ id: leaseId, body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 3, extractorIds: ["ext-basic-1", "ext-basic-2", "ext-basic-3"] }];
    const yard = { name: "Basic Extractor Yard", tier: 1, status: "Operational" };
    corp.buildings = [...(corp.buildings || []), yard, { ...yard }, { ...yard }];
    corp.mining.silicateExtractors = [idle(1), idle(2), idle(3)];
  });
  const api = authed(app, accessToken);
  const start = (extractorId, amount) => api.post(`/api/accounts/${account.id}/gameplay/lease/${leaseId}/start-mining`).send({ hours: 1, amount, extractorId });
  const extractor = (i) => getAccountById(account.id).state.corp.mining.silicateExtractors[i];
  const credits = () => getAccountById(account.id).state.corp.finances.credits;
  return { start, extractor, credits };
}

describe("yard upkeep (AB#2284, AB#2304)", () => {
  for (const rate of [10, 146, 250]) {
    it(`at ${rate} t/h the first two yards run at the old cost and the third at exactly 41.67 an hour more, with the same startup`, async () => {
      const c = await corpWithThreeYards();
      const base = operationCostPerHourFor(rate);

      for (const [i, id] of [[0, "ext-basic-1"], [1, "ext-basic-2"]]) {
        const before = c.credits();
        expect((await c.start(id, rate)).status).toBe(200);
        expect(c.extractor(i).operationCostPerHour, `yard ${i + 1}, the starting kit`).toBe(base);
        expect(c.extractor(i).upkeepPerHour || 0, `yard ${i + 1}, the starting kit`).toBe(0);
        expect(before - c.credits()).toBe(startupCostFor(base));
      }

      const before3 = c.credits();
      expect((await c.start("ext-basic-3", rate)).status).toBe(200);
      expect(c.extractor(2).operationCostPerHour - base).toBeCloseTo(41.67, 10);
      expect(before3 - c.credits()).toBe(startupCostFor(base));
    });
  }
});
