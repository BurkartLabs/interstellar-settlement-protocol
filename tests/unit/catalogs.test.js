import { describe, it, expect } from "vitest";
import {
  REFINERY_CHAINS,
  CEO_INSIGHT_LIBRARY,
  MISSION_TEMPLATES,
  SYSTEM_DETAILS,
  BELT_COMPOSITIONS,
  EXPEDITION_DURATIONS,
  EXPEDITION_LAUNCH_COST,
  PROBE_BUILD_COST,
  PROBE_ASSET_VALUE,
  PROBE_FABRICATION_MS,
  BASE_MAX_PROBES,
  BASE_MAX_DEPLOYMENTS
} from "../../server/gameState.js";

describe("Exported game constants", () => {
  it("EXPEDITION_LAUNCH_COST is 3000", () => {
    expect(EXPEDITION_LAUNCH_COST).toBe(3000);
  });
  it("PROBE_BUILD_COST is 8000", () => {
    expect(PROBE_BUILD_COST).toBe(8000);
  });
  it("PROBE_ASSET_VALUE is 5000", () => {
    expect(PROBE_ASSET_VALUE).toBe(5000);
  });
  it("PROBE_FABRICATION_MS is positive number", () => {
    expect(PROBE_FABRICATION_MS).toBeGreaterThan(0);
  });
  it("BASE_MAX_PROBES is 2", () => {
    expect(BASE_MAX_PROBES).toBe(2);
  });
  it("BASE_MAX_DEPLOYMENTS is 1", () => {
    expect(BASE_MAX_DEPLOYMENTS).toBe(1);
  });
});

describe("Catalog libraries", () => {
  it("REFINERY_CHAINS is a non-empty object keyed by chain id", () => {
    const ids = Object.keys(REFINERY_CHAINS);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const chain = REFINERY_CHAINS[id];
      expect(chain.id).toBe(id);
      expect(typeof chain.cycleDurationHours).toBe("number");
      expect(Array.isArray(chain.outputs)).toBe(true);
      expect(chain.outputs.length).toBeGreaterThan(0);
      for (const out of chain.outputs) {
        expect(typeof out.item).toBe("string");
        expect(typeof out.quantityPerCycle).toBe("number");
        expect(out.quantityPerCycle).toBeGreaterThan(0);
      }
    }
  });

  it("CEO_INSIGHT_LIBRARY entries all have required fields", () => {
    const ids = Object.keys(CEO_INSIGHT_LIBRARY);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const p = CEO_INSIGHT_LIBRARY[id];
      expect(p.id).toBe(id);
      expect(typeof p.name).toBe("string");
      expect(typeof p.durationHours).toBe("number");
      expect(typeof p.costCredits).toBe("number");
    }
  });

  it("MISSION_TEMPLATES entries have id, type, reward, quota.resource and quota.amount", () => {
    expect(Array.isArray(MISSION_TEMPLATES)).toBe(true);
    expect(MISSION_TEMPLATES.length).toBeGreaterThan(0);
    for (const m of MISSION_TEMPLATES) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.type).toBe("string");
      expect(m.reward).toBeDefined();
      expect(m.quota).toBeDefined();
      expect(typeof m.quota.resource).toBe("string");
      expect(typeof m.quota.amount).toBe("number");
    }
    const ids = MISSION_TEMPLATES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length); // unique ids
  });

  it("SYSTEM_DETAILS includes sol with bodies array", () => {
    expect(SYSTEM_DETAILS.sol).toBeDefined();
    expect(Array.isArray(SYSTEM_DETAILS.sol.bodies)).toBe(true);
    expect(SYSTEM_DETAILS.sol.bodies.length).toBeGreaterThan(0);
  });

  it("BELT_COMPOSITIONS percentages sum near 100 for each belt", () => {
    for (const [beltKey, comp] of Object.entries(BELT_COMPOSITIONS)) {
      const sum = Object.values(comp).reduce((a, b) => a + b, 0);
      expect(sum, `belt ${beltKey} sum`).toBeGreaterThanOrEqual(95);
      expect(sum, `belt ${beltKey} sum`).toBeLessThanOrEqual(105);
    }
  });

  it("EXPEDITION_DURATIONS has short, standard, extended", () => {
    for (const key of ["short", "standard", "extended"]) {
      expect(EXPEDITION_DURATIONS[key]).toBeDefined();
      expect(EXPEDITION_DURATIONS[key].ms).toBeGreaterThan(0);
      expect(EXPEDITION_DURATIONS[key].tickYieldMultiplier).toBeGreaterThan(0);
    }
  });
});
