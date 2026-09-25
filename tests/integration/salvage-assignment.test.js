import { describe, it, expect, vi, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, refreshContractOfferings, SALVAGE_ASSIGNMENT_ID } from "../../server/gameState.js";

// ISP-297 (AB#1789, AB#1741, ECONOMY.md "The way back from broke"): a corporation with 0 credits and no ore has no
// move that changes anything — start-mining needs startup credits it does not have. The Salvage Assignment is the
// way out: a Bureau contract paid in 4 hours served, not delivered resources, flat 3,000 credits, offered only
// while the corporation is actually stuck (under 3,000 credits, no active mining cycle).
async function corporation({ credits = 0, activeCycle = false } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentStationId = "earth-station-prime";
    state.corp.finances.credits = credits;
    state.corp.finances.expensesByCategory = {};
    state.corp.finances.incomeBySource = {};
    state.corp.mining.silicateExtractors = activeCycle
      ? [{
          id: "ext-1", name: "Basic Extractor Yard #1", tier: 1, active: true,
          startedAt: Date.now(), lastTickAt: Date.now(), endsAt: Date.now() + 3_600_000,
          throughputPerHour: 40, operationCostPerHour: 600, totalMined: 0, totalSpent: 0, lastCompletedAt: null
        }]
      : [];
  });
  const api = authed(app, accessToken);
  return {
    id: account.id,
    api,
    corp: () => getAccountById(account.id).state.corp,
    offerings: () => refreshContractOfferings(getAccountById(account.id).state.corp),
    accept: () => api.post(`/api/accounts/${account.id}/gameplay/accept-mission`).send({ missionId: SALVAGE_ASSIGNMENT_ID }),
    complete: () => api.post(`/api/accounts/${account.id}/gameplay/complete-mission`).send({ missionId: SALVAGE_ASSIGNMENT_ID })
  };
}

const offersSalvage = (corp) => refreshContractOfferings(corp).missions.some((m) => m.id === SALVAGE_ASSIGNMENT_ID);

describe("the Salvage Assignment is offered only while actually needed (ISP-297)", () => {
  it("offers it to a broke, idle corporation", async () => {
    const { corp } = await corporation({ credits: 0 });
    expect(offersSalvage(corp())).toBe(true);
  });

  it("does not offer it at or above the 3,000-credit threshold", async () => {
    const { corp } = await corporation({ credits: 3000 });
    expect(offersSalvage(corp())).toBe(false);
  });

  it("does not offer it while a mining cycle is active, even when broke", async () => {
    // 500 credits: below the 3,000 threshold (broke), but enough to cover the extractor's running cost for the
    // instant this test takes, so applyMiningOperations does not auto-stop the cycle as unaffordable first.
    const { corp } = await corporation({ credits: 500, activeCycle: true });
    expect(offersSalvage(corp())).toBe(false);
  });

  it("appears and disappears the moment the threshold is crossed, not on a timer", async () => {
    const { id, corp } = await corporation({ credits: 2999 });
    expect(offersSalvage(corp())).toBe(true);
    mutateAccountState(id, (state) => { state.corp.finances.credits = 3000; });
    expect(offersSalvage(corp())).toBe(false);
    mutateAccountState(id, (state) => { state.corp.finances.credits = 2999; });
    expect(offersSalvage(corp())).toBe(true);
  });
});

describe("accepting and completing the Salvage Assignment (ISP-297)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("refuses completion before 4 hours, saying how long is left", async () => {
    const { accept, complete, corp } = await corporation({ credits: 0 });
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    expect((await accept()).status).toBe(200);
    expect(corp().activeMissions.find((m) => m.id === SALVAGE_ASSIGNMENT_ID)).toBeTruthy();

    vi.setSystemTime(start + 3 * 60 * 60 * 1000); // 3 of 4 hours
    const early = await complete();
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/1 hour/);
    expect(corp().finances.credits).toBe(0);
  });

  it("pays exactly 3,000 once 4 hours have elapsed, and refuses a second completion", async () => {
    const { accept, complete, corp } = await corporation({ credits: 0 });
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    expect((await accept()).status).toBe(200);

    vi.setSystemTime(start + 4 * 60 * 60 * 1000);
    const res = await complete();
    expect(res.status).toBe(200);
    expect(corp().finances.credits).toBe(3000);
    expect(corp().finances.incomeBySource.salvage).toBe(3000);
    expect(corp().activeMissions.find((m) => m.id === SALVAGE_ASSIGNMENT_ID)).toBeUndefined();

    const again = await complete();
    expect(again.status).toBe(400);
    expect(corp().finances.credits).toBe(3000); // unchanged: no double payout
  });

  it("is not offered again during the 8-hour cooldown after completion, even though credits are still low", async () => {
    const { id, accept, complete, corp } = await corporation({ credits: 0 });
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    await accept();
    vi.setSystemTime(start + 4 * 60 * 60 * 1000);
    await complete();
    // Spend the payout back down: credits alone would qualify again, so only the cooldown should still block it.
    mutateAccountState(id, (state) => { state.corp.finances.credits = 0; });

    vi.setSystemTime(start + 4 * 60 * 60 * 1000 + 7 * 60 * 60 * 1000); // 7h after completion: within the 8h cooldown
    expect(offersSalvage(corp())).toBe(false);

    vi.setSystemTime(start + 4 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000); // 9h after completion: past the cooldown
    expect(offersSalvage(corp())).toBe(true);
  });

  it("pays the flat amount unmodified by Contract Law Essentials (T-018: nothing a player sets changes what it pays)", async () => {
    const { id, accept, complete, corp } = await corporation({ credits: 0 });
    mutateAccountState(id, (state) => { state.corp.completedInsights = ["ceo-negotiation-fundamentals", "ceo-contract-law"]; });
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    await accept();
    vi.setSystemTime(start + 4 * 60 * 60 * 1000);
    await complete();
    expect(corp().finances.credits).toBe(3000); // not 3,240 (the 8% Contract Law bonus other missions get)
  });
});
