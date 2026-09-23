import { describe, it, expect, afterEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById } from "../../server/gameState.js";

// Bug #1138, tested the way it was found: two identical corporations run the same cycle; one is read every 2 seconds
// (as a polling client would), the other once at the end. Every read runs the mining step, and each 2-second slice
// used to round its 0.36 credits of running cost to 0, so the polled corporation mined for free. Both must pay the same.
async function corpMining(app) {
  const { account, accessToken } = await registerAccount(app);
  const api = authed(app, accessToken);
  const play = (path, body = {}) => api.post(`/api/accounts/${account.id}/gameplay/${path}`).send(body);
  expect((await play("rent-office", { stationId: "earth-station-prime", durationDays: 7 })).status).toBe(200);
  expect((await play("hire", { count: 5 })).status).toBe(200);
  expect((await play("purchase-lease", { body: "earth" })).status).toBe(200);
  const leaseId = getAccountById(account.id).state.corp.miningLeases[0].id;
  expect((await play(`lease/${leaseId}/build-extractor`)).status).toBe(200);
  const extractorId = getAccountById(account.id).state.corp.mining.silicateExtractors[0].id;
  const started = await play(`lease/${leaseId}/start-mining`, { amount: 40, hours: 1, extractorId });
  expect(started.status).toBe(200);
  const read = () => api.get(`/api/accounts/${account.id}`);
  const extractor = () => getAccountById(account.id).state.corp.mining.silicateExtractors[0];
  return { read, extractor };
}

describe("mining running costs do not depend on how often the account is read (Bug #1138)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a corporation read every 2 seconds pays what its twin read once pays", async () => {
    // Extractors break down at random, about 3% of the time over these ten minutes; a breakdown pauses one twin and
    // not the other. Pinned, as in tests/unit/applyMiningOperations.test.js (this failed 1 of 5 full runs unpinned).
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T18:00:00Z"));
    const { app } = await getApp();
    const polled = await corpMining(app);
    const quiet = await corpMining(app);
    const startupPolled = polled.extractor().totalSpent;
    const startupQuiet = quiet.extractor().totalSpent;

    for (let i = 0; i < 300; i += 1) {
      vi.advanceTimersByTime(2000);
      await polled.read();
    }
    await quiet.read();

    // ISP-86: the running cost curves, so 40 t/h costs 644 an hour rather than 640. Ten minutes of it is 107.33:
    // 107 paid, the fraction carried. What this test is about is that the two corporations pay the same.
    const feesPolled = polled.extractor().totalSpent - startupPolled;
    const feesQuiet = quiet.extractor().totalSpent - startupQuiet;
    expect({ polled: feesPolled, quiet: feesQuiet }).toEqual({ polled: 107, quiet: 107 });
    expect(polled.extractor().totalMined).toBe(quiet.extractor().totalMined);
  }, 60_000);
});
