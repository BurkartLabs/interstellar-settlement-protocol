// Test fixture builder for a minimal corp object compatible with
// server/gameState.js pure functions (mining, refinery, etc.).
//
// Use overrides to customise individual tests:
//   makeCorp({ finances: { credits: 5000 } })

export function makeCorp(overrides = {}) {
  const base = {
    name: "Test Corp",
    currentStationId: "earth-station-prime",
    finances: {
      credits: 1_000_000,
      dailyRevenue: 0
    },
    inventory: {},
    stationInventories: {},
    unlockedTech: [],
    miningLeases: [],
    mining: {
      silicateExtractors: []
    }
  };
  return deepMerge(base, overrides);
}

export function makeExtractor(overrides = {}) {
  const now = Date.now();
  return {
    id: "ext-test-1",
    leaseId: "lease-test-1",
    active: true,
    startedAt: now,
    lastTickAt: now,
    endsAt: now + 60 * 60 * 1000, // 1 hour cycle
    throughputPerHour: 600,        // 10 / minute
    operationCostPerHour: 0,       // free by default for clean math
    totalMined: 0,
    totalSpent: 0,
    minedRemainder: 0,
    downtimeActive: false,
    downtimeStartedAt: null,
    downtimeRecoveredAt: null,
    ...overrides
  };
}

function deepMerge(target, source) {
  if (Array.isArray(source)) return source.slice();
  if (source && typeof source === "object") {
    const out = { ...target };
    for (const key of Object.keys(source)) {
      out[key] = deepMerge(target?.[key], source[key]);
    }
    return out;
  }
  return source === undefined ? target : source;
}
