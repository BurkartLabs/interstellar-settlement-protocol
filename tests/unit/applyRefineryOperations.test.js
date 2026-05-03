import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyRefineryOperations,
  REFINERY_CHAINS,
  getStationInventory
} from "../../server/gameState.js";
import { makeCorp } from "../fixtures/makeCorp.js";

function pickFirstChainId() {
  return Object.keys(REFINERY_CHAINS)[0];
}

function makeRefinery(overrides = {}) {
  return {
    id: "ref-1",
    name: "Refinery #1",
    tier: 1,
    active: true,
    chainId: null,
    startedAt: null,
    lastTickAt: null,
    endsAt: null,
    cyclesCompleted: 0,
    totalInputConsumed: 0,
    totalOutputProduced: 0,
    ...overrides
  };
}

describe("applyRefineryOperations", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does nothing when refinery is inactive", () => {
    const corp = makeCorp({ refineries: [makeRefinery({ active: false })] });
    applyRefineryOperations(corp, Date.now());
    expect(corp.refineries[0].cyclesCompleted).toBe(0);
  });

  it("does nothing when chainId is missing", () => {
    const corp = makeCorp({ refineries: [makeRefinery({ chainId: null })] });
    applyRefineryOperations(corp, Date.now());
    expect(corp.refineries[0].cyclesCompleted).toBe(0);
  });

  it("deactivates refinery when chainId references unknown chain", () => {
    const start = 1_700_000_000_000;
    const corp = makeCorp({
      refineries: [
        makeRefinery({
          chainId: "chain-does-not-exist",
          startedAt: start,
          endsAt: start + 1000
        })
      ]
    });
    applyRefineryOperations(corp, start + 2000);
    expect(corp.refineries[0].active).toBe(false);
  });

  it("does not complete the cycle before endsAt", () => {
    const start = 1_700_000_000_000;
    const chainId = pickFirstChainId();
    const corp = makeCorp({
      refineries: [
        makeRefinery({
          chainId,
          startedAt: start,
          endsAt: start + 60_000
        })
      ]
    });
    applyRefineryOperations(corp, start + 30_000);
    const ref = corp.refineries[0];
    expect(ref.active).toBe(true);
    expect(ref.cyclesCompleted).toBe(0);
  });

  it("at endsAt produces every output to the current station inventory", () => {
    const start = 1_700_000_000_000;
    const chainId = pickFirstChainId();
    const chain = REFINERY_CHAINS[chainId];
    const corp = makeCorp({
      currentStationId: "earth-station-prime",
      refineries: [
        makeRefinery({
          chainId,
          startedAt: start,
          endsAt: start + 60_000
        })
      ]
    });

    applyRefineryOperations(corp, start + 60_001);

    const inv = getStationInventory(corp, "earth-station-prime");
    let producedTotal = 0;
    for (const out of chain.outputs) {
      expect(inv[out.item] || 0).toBeGreaterThanOrEqual(out.quantityPerCycle);
      producedTotal += out.quantityPerCycle;
    }

    const ref = corp.refineries[0];
    expect(ref.cyclesCompleted).toBe(1);
    expect(ref.active).toBe(false);
    expect(ref.chainId).toBeNull();
    expect(ref.startedAt).toBeNull();
    expect(ref.endsAt).toBeNull();
    expect(ref.totalOutputProduced).toBe(producedTotal);
  });
});
