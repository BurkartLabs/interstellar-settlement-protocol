import { describe, it, expect, afterEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { yardUpkeepPerHourFor } from "../../server/economy.js";
import { miningTick } from "../../server/ticks.js";

// ISP-307 (AB#2299): through the real routes, a yard's price above the base is booked as yard-price-growth, and a cycle on
// a yard that pays upkeep books it as yard-upkeep when the server's mining tick charges it. Both start at the third yard
// since ISP-309 (AB#2305) and ISP-308 (AB#2304): the first two are the starting kit (extractorYardsInStartingKit).

afterEach(() => vi.restoreAllMocks());

describe("the sinks' own ledger lines through the routes (ISP-307)", () => {
  it("a third yard books its extra price and its cycle's upkeep apart; the starting kit's second books neither", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    const play = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
    mutateAccountState(account.id, (state) => { state.corp.finances.credits = 2_000_000; state.corp.buildingSlots = 6; });
    expect((await play("rent-office", { stationId: "earth-station-prime", durationDays: 7 })).status).toBe(200);
    expect((await play("hire", { count: 5 })).status).toBe(200);
    expect((await play("purchase-lease", { body: "earth" })).status).toBe(200);
    const corp = () => getAccountById(account.id).state.corp;
    const leaseId = corp().miningLeases[0].id;
    expect((await play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
    expect(corp().finances.expensesByCategory["yard-price-growth"] || 0).toBe(0);
    const second = await play(`lease/${leaseId}/build-extractor`);
    expect(second.status).toBe(200);
    // ISP-309 (AB#2305): the starting kit's second yard costs the base price; growth starts at the third.
    expect(corp().finances.expensesByCategory["yard-price-growth"] || 0).toBe(0);
    // A lease holds two yards; the third needs a slot a second lease would give, granted here to keep one lease.
    mutateAccountState(account.id, (state) => { state.corp.miningLeases[0].buildingSlots = 3; });
    const third = await play(`lease/${leaseId}/build-extractor`);
    expect(third.status, JSON.stringify(third.body.error)).toBe(200);
    expect(corp().finances.expensesByCategory["yard-price-growth"]).toBe(third.body.receipt.costCredits - 50_000);

    // ISP-308 (AB#2304): the starting kit, one lease and its two yards, pays no upkeep; the third yard does.
    const yards = () => corp().mining.silicateExtractors;
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdown
    const runAnHour = async (index) => {
      const started = await play(`lease/${leaseId}/start-mining`, { amount: 40, hours: 2, extractorId: yards()[index].id });
      expect(started.status, `yard ${index + 1} starts`).toBe(200);
      const opsBefore = corp().finances.expensesByCategory["mining-ops"] || 0;
      const upkeepBefore = corp().finances.expensesByCategory["yard-upkeep"] || 0;
      mutateAccountState(account.id, (state) => {
        const ex = state.corp.mining.silicateExtractors[index];
        ex.startedAt -= 3_600_000; ex.lastTickAt -= 3_600_000;
      }, { settleMining: false });
      miningTick();
      return {
        upkeep: (corp().finances.expensesByCategory["yard-upkeep"] || 0) - upkeepBefore,
        ops: corp().finances.expensesByCategory["mining-ops"] - opsBefore
      };
    };

    const secondHour = await runAnHour(1);
    expect(yards()[1].upkeepPerHour || 0).toBe(0);
    expect(secondHour.upkeep, "the second yard of the starting kit").toBe(0);
    expect(secondHour.ops).toBeGreaterThan(0);

    const thirdHour = await runAnHour(2);
    expect(yards()[2].upkeepPerHour).toBe(yardUpkeepPerHourFor(2));
    expect(thirdHour.upkeep, "the third yard").toBeGreaterThan(0);
    expect(thirdHour.upkeep / (thirdHour.upkeep + thirdHour.ops)).toBeCloseTo(yardUpkeepPerHourFor(2) / yards()[2].operationCostPerHour, 2);
  });
});
