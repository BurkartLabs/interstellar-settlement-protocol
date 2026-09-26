import { describe, it, expect } from "vitest";
import {
  REFINERY_CHAINS,
  CEO_INSIGHT_LIBRARY,
  MISSION_TEMPLATES,
  SYSTEMS_BY_ID,
  BELT_KEYS,
  beltComposition,
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

  // AB#1051: a template is a range now (data/missions.json), not a fixed reward and quota — materializeOffer
  // (server/game/corporation.js) rolls one instance of it per refresh. See tests/unit/missionVariance.test.js
  // for the roll itself; this just guards the template's own shape.
  it("MISSION_TEMPLATES entries have id, type, resource and a valid quota/reward range", () => {
    expect(Array.isArray(MISSION_TEMPLATES)).toBe(true);
    expect(MISSION_TEMPLATES.length).toBeGreaterThan(0);
    for (const m of MISSION_TEMPLATES) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.type).toBe("string");
      expect(typeof m.resource).toBe("string");
      expect(typeof m.quotaMin).toBe("number");
      expect(typeof m.quotaMax).toBe("number");
      expect(m.quotaMax, m.id).toBeGreaterThanOrEqual(m.quotaMin);
      expect(typeof m.rewardMin).toBe("number");
      expect(typeof m.rewardMax).toBe("number");
      expect(m.rewardMax, m.id).toBeGreaterThanOrEqual(m.rewardMin);
    }
    const ids = MISSION_TEMPLATES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length); // unique ids
  });

  it("the systems catalog includes sol with bodies array", () => {
    expect(SYSTEMS_BY_ID.get("sol")).toBeDefined();
    expect(Array.isArray(SYSTEMS_BY_ID.get("sol").bodies)).toBe(true);
    expect(SYSTEMS_BY_ID.get("sol").bodies.length).toBeGreaterThan(0);
  });

  it("each belt's composition percentages sum near 100", () => {
    expect(BELT_KEYS.length).toBeGreaterThan(0);
    for (const [beltKey, comp] of BELT_KEYS.map((k) => [k, beltComposition(k)])) {
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
