// AB#1052: a player who started a long cycle by mistake, or needs the extractor for something else, could
// previously only wait it out. POST /lease/:leaseId/stop-mining ends it now, keeping what has been mined and
// charging for the time actually used — settled through mutateAccountState's own before-mutator sweep
// (AB#1448), not recomputed here, so it can never disagree with what a normal tick would have charged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

async function corpWithActiveExtractor({ startedAt, hours = 24, throughputPerHour = 600, operationCostPerHour = 0, extractorId = "ext-basic-1", leaseId = "lease-1052" }) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.offices = [{ stationId: "earth-station-prime", rentedAt: startedAt, rentedUntil: startedAt + 30 * 86_400_000, durationDays: 30 }];
    corp.employeeCount = 5;
    corp.miningLeases = [{ id: leaseId, body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [extractorId] }];
    corp.mining.silicateExtractors = [{
      id: extractorId, name: "Basic Extractor Yard #1", tier: 1, active: true,
      startedAt, lastTickAt: startedAt, endsAt: startedAt + hours * 60 * 60 * 1000,
      throughputPerHour, operationCostPerHour, totalMined: 0, minedThisCycle: 0, totalSpent: 0,
      leaseId, body: "Earth"
    }];
    corp.finances.credits = 1_000_000;
  });
  return { api: authed(app, accessToken), id: account.id, leaseId, extractorId };
}

describe("POST /lease/:leaseId/stop-mining (AB#1052)", () => {
  // applyMiningOperations rolls a random downtime chance on every settle (server/game/mining.js); pinned high so
  // these tests assert the stop-mining math deterministically rather than flaking on an unlucky breakdown roll.
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("settles and stops a running cycle: mined and charged match the elapsed time, not the full cycle", async () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const c = await corpWithActiveExtractor({ startedAt: start, hours: 24, throughputPerHour: 600, operationCostPerHour: 300 });

    // getAccountById itself settles mining as a side effect (Bug #1260), so the credits baseline is read before
    // advancing the clock — reading it after would already reflect this test's own charge and hide the bug.
    const before = 1_000_000;
    vi.setSystemTime(start + 30 * 60 * 1000); // 0.5h in, of a 24h cycle

    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/${c.leaseId}/stop-mining`).send({ extractorId: c.extractorId });
    expect(res.status).toBe(200);

    const extractor = getAccountById(c.id).state.corp.mining.silicateExtractors[0];
    // 0.5h * 600 t/h = 300 t mined, 0.5h * 300/h = 150 credits spent — half the cycle, not the whole thing.
    expect(extractor.active).toBe(false);
    expect(extractor.minedThisCycle).toBe(300);
    expect(extractor.totalMined).toBe(300);
    const after = getAccountById(c.id).state.corp.finances.credits;
    expect(before - after).toBe(150);
  });

  it("keeps what was mined before the stop (totalMined survives, minedThisCycle reflects the halted cycle)", async () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const c = await corpWithActiveExtractor({ startedAt: start, hours: 10, throughputPerHour: 100 });
    mutateAccountState(c.id, (state) => {
      state.corp.mining.silicateExtractors[0].totalMined = 5000; // lifetime total from earlier cycles
    });

    vi.setSystemTime(start + 60 * 60 * 1000); // 1h in

    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/${c.leaseId}/stop-mining`).send({ extractorId: c.extractorId });
    expect(res.status).toBe(200);
    const extractor = getAccountById(c.id).state.corp.mining.silicateExtractors[0];
    expect(extractor.minedThisCycle).toBe(100);
    expect(extractor.totalMined).toBe(5100); // lifetime total plus this cycle's 100
  });

  it("refuses to stop a cycle that is not running", async () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const c = await corpWithActiveExtractor({ startedAt: start, hours: 1, throughputPerHour: 10 });
    mutateAccountState(c.id, (state) => { state.corp.mining.silicateExtractors[0].active = false; });

    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/${c.leaseId}/stop-mining`).send({ extractorId: c.extractorId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no mining cycle running/i);
  });

  it("refuses a second stop on the same cycle (idempotent, not a double-charge)", async () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const c = await corpWithActiveExtractor({ startedAt: start, hours: 24, throughputPerHour: 600, operationCostPerHour: 300 });
    vi.setSystemTime(start + 30 * 60 * 1000);

    const first = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/${c.leaseId}/stop-mining`).send({ extractorId: c.extractorId });
    expect(first.status).toBe(200);
    const minedAfterFirst = getAccountById(c.id).state.corp.mining.silicateExtractors[0].minedThisCycle;

    vi.setSystemTime(start + 60 * 60 * 1000); // more time passes, cycle already stopped
    const second = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/${c.leaseId}/stop-mining`).send({ extractorId: c.extractorId });
    expect(second.status).toBe(400);

    const extractor = getAccountById(c.id).state.corp.mining.silicateExtractors[0];
    expect(extractor.minedThisCycle).toBe(minedAfterFirst); // nothing accrued after the stop
  });

  it("a cycle that runs its full course before the stop request settles the whole cycle, not more", async () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const c = await corpWithActiveExtractor({ startedAt: start, hours: 1, throughputPerHour: 100 });

    vi.setSystemTime(start + 2 * 60 * 60 * 1000); // 2h later, the 1h cycle already ended naturally

    const res = await c.api.post(`/api/accounts/${c.id}/gameplay/lease/${c.leaseId}/stop-mining`).send({ extractorId: c.extractorId });
    // mutateAccountState's pre-settle already ended the cycle naturally before this route's mutator ran.
    expect(res.status).toBe(400);
    const extractor = getAccountById(c.id).state.corp.mining.silicateExtractors[0];
    expect(extractor.minedThisCycle).toBe(100); // exactly the 1h cycle's yield, not 2h worth
  });

  it("404s for an account that does not exist", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    const res = await api.post(`/api/accounts/does-not-exist/gameplay/lease/lease-x/stop-mining`).send({ extractorId: "ext-basic-1" });
    expect([401, 403, 404]).toContain(res.status); // ownership check refuses before the account lookup would 404
  });
});
