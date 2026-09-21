import { describe, it, expect, vi, afterEach } from "vitest";
import { applyRefineryOperations, REFINERY_CHAINS, getStationInventory } from "../../server/gameState.js";
import { makeCorp } from "../fixtures/makeCorp.js";

// Bug #692: a refinery cycle delivered its outputs to wherever the corporation was when the cycle ended - free
// logistics after travelling, and Earth Station Prime when it ended in transit. The cycle now records the station
// its inputs came from, and delivers there.
const START = 1_700_000_000_000;
const CHAIN_ID = "silicates-chain";
const chain = REFINERY_CHAINS[CHAIN_ID];

function running(overrides = {}) {
  return {
    id: "ref-1",
    name: "Refinery #1",
    tier: 1,
    active: true,
    chainId: CHAIN_ID,
    cycleScale: 1,
    startedAt: START,
    lastTickAt: START,
    endsAt: START + 60_000,
    cyclesCompleted: 0,
    totalInputConsumed: 100,
    totalOutputProduced: 0,
    ...overrides
  };
}

const outputsAt = (corp, stationId) => {
  const inv = getStationInventory(corp, stationId);
  return Object.fromEntries(chain.outputs.map((o) => [o.item, inv[o.item] || 0]));
};
const oneCycle = Object.fromEntries(chain.outputs.map((o) => [o.item, o.quantityPerCycle]));
const nothing = Object.fromEntries(chain.outputs.map((o) => [o.item, 0]));

describe("refinery output station (Bug #692)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("delivers to the station the cycle started at, after the corporation travels elsewhere", () => {
    const corp = makeCorp({ currentStationId: "luna-gateway", refineries: [running({ stationId: "mars-orbital-dock" })] });
    applyRefineryOperations(corp, START + 60_001);
    expect(outputsAt(corp, "mars-orbital-dock")).toEqual(oneCycle);
    expect(outputsAt(corp, "luna-gateway")).toEqual(nothing);
  });

  it("delivers to the station the cycle started at when the cycle ends in transit, not to Earth Station Prime", () => {
    const corp = makeCorp({ currentStationId: null, refineries: [running({ stationId: "mars-orbital-dock" })] });
    applyRefineryOperations(corp, START + 60_001);
    expect(outputsAt(corp, "mars-orbital-dock")).toEqual(oneCycle);
    expect(outputsAt(corp, "earth-station-prime")).toEqual(nothing);
  });

  it("keeps the station on a running cycle across ticks, and clears it when the cycle completes", () => {
    const corp = makeCorp({ currentStationId: "mars-orbital-dock", refineries: [running({ stationId: "mars-orbital-dock" })] });
    applyRefineryOperations(corp, START + 30_000);
    expect(corp.refineries[0].stationId).toBe("mars-orbital-dock");
    corp.currentStationId = "luna-gateway";
    applyRefineryOperations(corp, START + 45_000);
    expect(corp.refineries[0].stationId).toBe("mars-orbital-dock");
    applyRefineryOperations(corp, START + 60_001);
    expect(corp.refineries[0].active).toBe(false);
    expect(corp.refineries[0].stationId).toBeNull();
  });

  it("pins a cycle already running at deploy, with no station, to the corporation's station at first touch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const corp = makeCorp({ currentStationId: "mars-orbital-dock", refineries: [running()] });
    applyRefineryOperations(corp, START + 30_000);
    expect(corp.refineries[0].stationId).toBe("mars-orbital-dock");
    expect(warn).toHaveBeenCalledTimes(1);
    corp.currentStationId = "luna-gateway";
    applyRefineryOperations(corp, START + 60_001);
    expect(outputsAt(corp, "mars-orbital-dock")).toEqual(oneCycle);
    expect(outputsAt(corp, "luna-gateway")).toEqual(nothing);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("pins a pre-deploy cycle found in transit to Earth Station Prime, so its outputs are never dropped", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const corp = makeCorp({ currentStationId: null, refineries: [running()] });
    applyRefineryOperations(corp, START + 60_001);
    expect(outputsAt(corp, "earth-station-prime")).toEqual(oneCycle);
  });

  it("gives an idle refinery no station", () => {
    const corp = makeCorp({ refineries: [running({ active: false, chainId: null, endsAt: null })] });
    applyRefineryOperations(corp, START);
    expect(corp.refineries[0].stationId).toBeNull();
  });
});
