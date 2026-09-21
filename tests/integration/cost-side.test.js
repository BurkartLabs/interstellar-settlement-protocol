import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, applyMiningOperations } from "../../server/gameState.js";
import { buildSnapshot } from "../../server/finances.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// Bug #1022: the cost side of Net Daily Flow was the payroll rate alone; the costs a player actually pays never reached it.
describe("Net Daily Flow's cost side (Bug #1022)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("an hour of mining moves the cost side by the mining-ops booked", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no downtime roll
    const start = 1_700_000_000_000;
    const corp = makeCorp({
      finances: { credits: 1_000_000, dailyRevenue: 0, dailyCosts: 750 },
      miningLeases: [{ id: "lease-1", body: "Earth" }],
      mining: { silicateExtractors: [makeExtractor({ startedAt: start, lastTickAt: start, endsAt: start + 2 * 3_600_000, throughputPerHour: 600, operationCostPerHour: 9600, leaseId: "lease-1" })] }
    });
    applyMiningOperations(corp, start + 3_600_000);
    expect(corp.finances.expensesByCategory["mining-ops"]).toBe(9600);
    expect(corp.finances.dailyExpenses).toBe(9600);
    const snap = buildSnapshot(corp, start + 3_600_000);
    expect(snap.netFlow).toBe(-9600);
  });

  it("renting an office books its rent as a cost the day it is paid", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const res = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/rent-office`).send({ durationDays: 28 });
    expect(res.status).toBe(200);
    const finances = getAccountById(account.id).state.corp.finances;
    expect(finances.expensesByCategory["office-rent"]).toBe(28_000);
    expect(finances.dailyExpenses).toBe(28_000);
  });
});
