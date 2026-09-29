import { describe, it, expect, vi, beforeAll } from "vitest";

// Bug #4848: every call to mutateAccountState is counted, to see which accounts each ticker touches.
vi.mock("../../server/gameState.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, mutateAccountState: vi.fn(real.mutateAccountState) };
});

import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// The 5- and 10-second tickers used to mutate every account on every run; now each skips an account with nothing
// due for it, and still does its work for one that has. miningTick is not among them: it settles every account.
let mod;
beforeAll(async () => { mod = await getApp(); });

const touched = () => mutateAccountState.mock.calls.map((c) => c[0]);
async function corp(set = () => {}) {
  const { account } = await registerAccount(mod.app);
  mutateAccountState(account.id, set, { sanitize: false, settleMining: false });
  return account.id;
}

describe("the tickers skip an account with nothing due (Bug #4848)", () => {
  it("an idle corporation is touched by none of the seven tickers; miningTick still settles it", async () => {
    const idle = await corp();
    const tickers = ["travelTick", "shipmentTick", "processRndCompletions", "processCeoInsightCompletions", "fabricationTick", "refineryTick", "asteroidExpeditionTick"];
    for (const name of tickers) {
      mutateAccountState.mockClear();
      mod[name]();
      expect(touched(), name).not.toContain(idle);
    }
    mutateAccountState.mockClear();
    mod.miningTick();
    expect(touched()).toContain(idle);
  });

  it("a journey that has arrived is settled, and only that corporation is touched", async () => {
    const idle = await corp();
    const traveller = await corp((s) => { s.corp.currentStationId = null; s.corp.travel = { travelType: "local", toStationId: "mars-orbital-dock", arrivesAt: Date.now() - 1 }; });
    mutateAccountState.mockClear();
    mod.travelTick();
    expect(touched()).toContain(traveller);
    expect(touched()).not.toContain(idle);
    expect(getAccountById(traveller).state.corp).toMatchObject({ currentStationId: "mars-orbital-dock", travel: null });
  });

  it("research that has finished is unlocked; one still running is left alone and its corporation not touched", async () => {
    const now = Date.now();
    const done = await corp((s) => { s.queues.corporateRnD = [{ id: "r1", techId: "tt-basic-extraction", name: "Basic Extraction Analytics", startedAt: now - 3 * 3_600_000, durationHours: 2 }]; });
    const running = await corp((s) => { s.queues.corporateRnD = [{ id: "r2", techId: "tt-basic-extraction", name: "Basic Extraction Analytics", startedAt: now - 3_600_000, durationHours: 2 }]; });
    mutateAccountState.mockClear();
    mod.processRndCompletions();
    expect(touched()).toContain(done);
    expect(touched()).not.toContain(running);
    expect(getAccountById(done).state.corp.unlockedTech).toContain("tt-basic-extraction");
    expect(getAccountById(running).state.queues.corporateRnD).toHaveLength(1);
  });

  it("a shipment that has arrived is delivered, and a CEO programme that has run its hours completes", async () => {
    const now = Date.now();
    const shipper = await corp((s) => {
      s.corp.shipments = [{ id: "sh-1", status: "in-transit", fromStationId: "mars-orbital-dock", toStationId: "earth-station-prime", lines: [{ item: "Silicates", quantity: 5 }], fee: 0, arrivesAt: now - 1 }];
    });
    const thinker = await corp((s) => { s.queues.ceoInsight = [{ id: "c1", programId: "p1", name: "A programme", startedAt: now - 3 * 3_600_000, durationHours: 1 }]; });
    mutateAccountState.mockClear();
    mod.shipmentTick();
    mod.processCeoInsightCompletions();
    expect(touched()).toEqual(expect.arrayContaining([shipper, thinker]));
    expect(getAccountById(shipper).state.corp.shipments).toEqual([]);
    expect(getAccountById(thinker).state.corp.completedInsights).toContain("p1");
  });
});
