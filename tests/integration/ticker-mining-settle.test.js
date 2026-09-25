// AB#1448: the tickers used to run applyMiningOperations through mutateAccountState's built-in before/after hooks
// on every account, on every ticker, mining or not — three calls per account on miningTick alone, two wasted calls
// on each of the other seven. This proves the fix: mining settles when miningTick (or a real account read) runs it,
// not as a side effect of an unrelated ticker, and miningTick settles it exactly once per call.
import { describe, it, expect, vi, afterEach } from "vitest";
import * as mining from "../../server/game/mining.js";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

async function corpWithActiveExtractor(startedAt, extractorId) {
  const { app } = await getApp();
  const { account } = await registerAccount(app);
  const leaseId = `lease-${extractorId}`;
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.offices = [{ stationId: "earth-station-prime", rentedAt: startedAt, rentedUntil: startedAt + 30 * 86_400_000, durationDays: 30 }];
    corp.employeeCount = 5;
    corp.miningLeases = [{ id: leaseId, body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [extractorId] }];
    corp.mining.silicateExtractors = [{
      id: extractorId, name: "Basic Extractor Yard #1", tier: 1, active: true,
      startedAt, lastTickAt: startedAt, endsAt: startedAt + 60 * 60 * 1000,
      throughputPerHour: 600, operationCostPerHour: 0, totalMined: 0, minedThisCycle: 0, totalSpent: 0,
      leaseId, body: "Earth"
    }];
  });
  return account.id;
}

/** A read with the API this fix added: settleMining false, so it reflects exactly what the tickers left behind. */
function peekWithoutSettling(accountId) {
  return mutateAccountState(accountId, () => {}, { sanitize: true, settleMining: false });
}

describe("tickers and mining settlement (AB#1448)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a non-mining ticker (refineryTick) does not settle mining as a side effect", async () => {
    const { refineryTick } = await getApp();
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const id = await corpWithActiveExtractor(start, "ext-1448-a");

    vi.setSystemTime(start + 6 * 60 * 1000); // 6 minutes elapse, unsettled
    await refineryTick();

    const extractor = peekWithoutSettling(id).state.corp.mining.silicateExtractors[0];
    expect(extractor.totalMined).toBe(0);
    expect(extractor.lastTickAt).toBe(start);
  });

  it("miningTick settles mining exactly once per call, matching one direct applyMiningOperations call", async () => {
    const { miningTick } = await getApp();
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const id = await corpWithActiveExtractor(start, "ext-1448-b");
    const spy = vi.spyOn(mining, "applyMiningOperations");
    // AB#1767: settling 6 minutes rolls for extractor downtime once, at 1 - (1 - 0.00005)^360, about 1.8%; a hit pauses
    // the whole interval and mines 0. Pinned above the roll, as every other mining test does.
    vi.spyOn(Math, "random").mockReturnValue(0.999);

    vi.setSystemTime(start + 6 * 60 * 1000); // 0.1h → 60 silicates at 600/h
    await miningTick();

    // Filtered to this test's own corp: other accounts (the seed dummy, the other test's account) share the same
    // module instance and are settled by the same ticker call, so a raw call count would count their calls too.
    const ownCalls = spy.mock.calls.filter(([corp]) => corp?.mining?.silicateExtractors?.some((e) => e.id === "ext-1448-b"));
    expect(ownCalls).toHaveLength(1);

    const account = getAccountById(id);
    expect(account.state.corp.mining.silicateExtractors[0].totalMined).toBe(60);
  });
});
