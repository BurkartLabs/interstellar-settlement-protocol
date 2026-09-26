import { describe, it, expect, afterEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { yardUpkeepPerHourFor } from "../../server/economy.js";
import { miningTick } from "../../server/ticks.js";

// ISP-307 (AB#2299): through the real routes, the second yard's price above the first is booked as yard-price-growth,
// and a cycle on it books its upkeep as yard-upkeep when the server's mining tick charges it.

afterEach(() => vi.restoreAllMocks());

describe("the sinks' own ledger lines through the routes (ISP-307)", () => {
  it("a second yard books its extra price apart, and its cycle books its upkeep apart", async () => {
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
    expect(corp().finances.expensesByCategory["yard-price-growth"]).toBe(second.body.receipt.costCredits - 50_000);

    const extractorId = corp().mining.silicateExtractors[1].id;
    const started = await play(`lease/${leaseId}/start-mining`, { amount: 40, hours: 2, extractorId });
    expect(started.status).toBe(200);
    expect(corp().mining.silicateExtractors[1].upkeepPerHour).toBe(yardUpkeepPerHourFor(1));

    vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdown
    const opsBefore = corp().finances.expensesByCategory["mining-ops"] || 0;
    mutateAccountState(account.id, (state) => {
      const ex = state.corp.mining.silicateExtractors[1];
      ex.startedAt -= 3_600_000; ex.lastTickAt -= 3_600_000;
    }, { settleMining: false });
    miningTick();
    const upkeep = corp().finances.expensesByCategory["yard-upkeep"];
    const ops = corp().finances.expensesByCategory["mining-ops"] - opsBefore;
    expect(upkeep).toBeGreaterThan(0);
    expect(upkeep / (upkeep + ops)).toBeCloseTo(yardUpkeepPerHourFor(1) / corp().mining.silicateExtractors[1].operationCostPerHour, 2);
  });
});
