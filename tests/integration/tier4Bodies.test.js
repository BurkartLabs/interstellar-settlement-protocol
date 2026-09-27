import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { applyMiningOperations, applyAsteroidExpeditions } from "../../server/gameState.js";
import { normalizeStateShape } from "../../server/game/shape.js";
import { ITEM_RESEARCH_GATES } from "../../server/game/researchGates.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// ISP-188 (AB#882): docs/design/v0.11-tier4.md section 1 says where each extracted Tier 4 resource is found. Its table
// is read here against data/systems.json, both ways: every belt and body it names carries the item at its share, and
// nothing else does. The gate itself (server/game/researchGates.js) came with AB#880; here each resource is mined on
// both paths, expeditions and extractors, from the data's own bodies.
const DOC = readFileSync(new URL("../../docs/design/v0.11-tier4.md", import.meta.url), "utf8");
const SYSTEMS = JSON.parse(readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8"));
const BODIES = SYSTEMS.flatMap((s) => s.bodies.map((b) => ({ system: s, body: b })));
const section1 = DOC.split(/^## /m).find((s) => s.startsWith("1.")).split("**What the gate does.**")[0];
const ROWS = Object.fromEntries(section1.split("\n").filter((l) => /^\| `[a-z-]+` \|/.test(l))
  .map((l) => l.split("|").slice(1, -1).map((c) => c.trim())).map(([, name, , , , where]) => [name, where]));

const START = 1_700_000_000_000;
const MIN = 60_000;
afterEach(() => vi.restoreAllMocks());

describe("ISP-188 where the Tier 4 resources are, the design against the data", () => {
  it("Uranium and Exotic Matter: exactly the belts section 1 names, at its percentages", () => {
    for (const item of ["Uranium", "Exotic Matter"]) {
      const designed = Object.fromEntries([...ROWS[item].matchAll(/([a-z0-9]+-[a-z0-9-]+) (\d+)%/g)].map((m) => [m[1], Number(m[2])]));
      expect(Object.keys(designed).length, item).toBeGreaterThanOrEqual(7);
      const inData = Object.fromEntries(BODIES.filter(({ body }) => body.composition?.[item]).map(({ body }) => [body.id, body.composition[item]]));
      expect(inData, item).toEqual(designed);
    }
  });

  it("Platinum-Group Metals and Metallic Hydrogen: exactly the bodies section 1 names, each 10 points taken from its source", () => {
    for (const [item, source] of [["Platinum-Group Metals", "Iron Ore"], ["Metallic Hydrogen", "Hydrogen"]]) {
      const named = ROWS[item].match(/\(([a-z0-9]+-[^)]+)\)/)[1].split(",").map((s) => s.trim()); // the id list, not "(bands)"
      expect(ROWS[item]).toContain(`10 of the body's ${source} share`);
      const carriers = BODIES.filter(({ body }) => body.resourceProfile?.some((p) => p.item === item));
      expect(carriers.map(({ body }) => body.id).sort(), item).toEqual([...named].sort());
      for (const { system, body } of carriers) {
        expect(system.rarity, body.id).toBe("exotic");
        expect(body.resourceProfile.find((p) => p.item === item).concentration, body.id).toBe(0.1);
        expect(body.resourceProfile.find((p) => p.item === source)?.concentration, `${body.id} keeps some ${source}`).toBeGreaterThan(0);
      }
    }
  });
});

/** An extractor on `body` for ten hours, for a corporation with `research`: what it deposits. */
function extract(body, research) {
  vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdown
  const corp = makeCorp({ currentStationId: "earth-station-prime", unlockedTech: research, miningLeases: [{ id: "lease-1", body }],
    mining: { silicateExtractors: [makeExtractor({ startedAt: START, lastTickAt: START, endsAt: START + 600 * MIN, throughputPerHour: 600, operationCostPerHour: 0, leaseId: "lease-1" })] } });
  applyMiningOperations(corp, START + 600 * MIN);
  return Object.values(corp.inventory).reduce((sum, inv) => ({ ...sum, ...inv }), {});
}

describe("ISP-188 each resource on each path: nothing without its research, its share with it", () => {
  // Uranium and Exotic Matter are belt items; the new two are body items. Each is mined where the data puts it.
  for (const [item, body] of [["Uranium", "Crown Belt"], ["Exotic Matter", "Crown Belt"], ["Platinum-Group Metals", "Kestrel"], ["Metallic Hydrogen", "Orion Reach"]]) {
    it(`an extractor on ${body}: ${item}`, () => {
      const node = ITEM_RESEARCH_GATES[item];
      expect(node).toBeTruthy();
      expect(extract(body, [])[item]).toBeUndefined();
      const got = extract(body, [node]);
      const total = Object.values(got).reduce((a, b) => a + b, 0);
      expect(got[item] / total, item).toBeGreaterThan(0.05);
    });
  }

  for (const [item, beltKey] of [["Uranium", "kapteyns-star:kap-drift"], ["Exotic Matter", "van-maanens-star:vm-field"]]) {
    it(`an expedition to ${beltKey}: ${item}`, () => {
      const run = (research) => {
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        const corp = makeCorp({ currentStationId: "earth-station-prime", unlockedTech: research, inventory: {},
          asteroidMining: { probeCount: 0, maxProbes: 2, completedExpeditions: [], activeExpeditions: [{ id: "exp-882", status: "active", beltKey,
            systemId: beltKey.split(":")[0], duration: "long", deployedAt: START, lastTickAt: START, completesAt: START + 24 * 60 * MIN, yields: {} }] } });
        for (let t = 1; t <= 12; t += 1) applyAsteroidExpeditions(corp, START + t * 60 * MIN);
        return corp.asteroidMining.activeExpeditions[0].yields;
      };
      expect(run([])[item]).toBeUndefined();
      expect(run([ITEM_RESEARCH_GATES[item]])[item]).toBeGreaterThan(0);
    });
  }
});

describe("ISP-188 a save from before the gate keeps what it holds (P-FRESH-STATE-ONLY)", () => {
  it("loads with its Uranium and Exotic Matter, and settling its Kestrel extractor without the research takes none of them", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const held = { Uranium: 120, "Exotic Matter": 9, "Iron Ore": 300 };
    const save = { world: { systems: [] }, corp: makeCorp({ currentStationId: "earth-station-prime", unlockedTech: [], inventory: { "earth-station-prime": { ...held } },
      miningLeases: [{ id: "lease-1", body: "Kestrel" }],
      mining: { silicateExtractors: [makeExtractor({ startedAt: START, lastTickAt: START, endsAt: START + 60 * MIN, throughputPerHour: 600, operationCostPerHour: 0, leaseId: "lease-1" })] } }) };
    const loaded = normalizeStateShape(save);
    applyMiningOperations(loaded.corp, START + 60 * MIN);
    const after = Object.values(loaded.corp.inventory).reduce((sum, inv) => {
      for (const [k, v] of Object.entries(inv)) sum[k] = (sum[k] || 0) + v;
      return sum;
    }, {});
    expect(after.Uranium).toBe(120);
    expect(after["Exotic Matter"]).toBe(9);
    expect(after["Iron Ore"]).toBeGreaterThan(300);
    expect(after["Platinum-Group Metals"]).toBeUndefined();
  });
});
