import { describe, it, expect, afterEach, vi } from "vitest";
import { applyMiningOperations } from "../../server/gameState.js";
import { ensureCorpMiningModel, shareByProfile } from "../../server/game/mining.js";
import { bodyResourceProfile, SYSTEMS_DATA } from "../../server/game/catalog.js";
import { resolveMetric } from "../../server/game/progression.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// AB#828: an extractor yields its lease body's resources (data/systems.json resourceProfile, AB#826), in the profile's
// proportions, and each mined item counts towards totalMined:<item>.
afterEach(() => vi.restoreAllMocks());
const START = 1_700_000_000_000;
const HOUR = 3_600_000;

function yardOn(body, { throughputPerHour = 600, hours = 10, extractor = {} } = {}) {
  vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdown
  return makeCorp({
    currentStationId: "earth-station-prime",
    miningLeases: [{ id: "lease-1", body }],
    mining: { silicateExtractors: [makeExtractor({ startedAt: START, lastTickAt: START, endsAt: START + hours * HOUR, throughputPerHour, operationCostPerHour: 0, leaseId: "lease-1", ...extractor })] }
  });
}
const held = (corp) => Object.values(corp.inventory || {}).reduce((sum, inv) => {
  for (const [item, n] of Object.entries(inv)) sum[item] = (sum[item] || 0) + n;
  return sum;
}, {});

describe("sharing mined units by a body's profile (AB#828)", () => {
  it("a two-item profile comes out in its proportions, whole units, nothing lost", () => {
    const profile = [{ item: "Iron Ore", concentration: 0.7 }, { item: "Bauxite", concentration: 0.3 }];
    const carry = {};
    const total = {};
    for (let i = 0; i < 100; i += 1) for (const [item, n] of Object.entries(shareByProfile(7, profile, carry))) total[item] = (total[item] || 0) + n;
    expect(total).toEqual({ "Iron Ore": 490, Bauxite: 210 });
  });

  it("comes to the same totals however the span is sliced", () => {
    const profile = [{ item: "Iron Ore", concentration: 0.7 }, { item: "Bauxite", concentration: 0.3 }];
    const once = shareByProfile(700, profile, {});
    const carry = {};
    const sliced = {};
    for (let i = 0; i < 700; i += 1) for (const [item, n] of Object.entries(shareByProfile(1, profile, carry))) sliced[item] = (sliced[item] || 0) + n;
    expect(sliced).toEqual(once);
  });
});

describe("an extractor on a body yields that body's resources (AB#828)", () => {
  it("on Venus (four items), a cycle's output is the profile's proportions, deposited and counted", () => {
    const corp = yardOn("Venus");
    applyMiningOperations(corp, START + 10 * HOUR); // 6,000 units
    const profile = bodyResourceProfile("Venus");
    expect(profile.length).toBe(4);
    const got = held(corp);
    for (const { item, concentration } of profile) expect(Math.abs(got[item] - 6000 * concentration), item).toBeLessThanOrEqual(1);
    const ext = corp.mining.silicateExtractors[0];
    expect(ext.totalMined).toBe(Object.values(got).reduce((a, b) => a + b, 0));
    expect(ext.minedByItem).toEqual(got);
  });

  it("on Mars, the same Silicates an hour as before, and nothing else", () => {
    const corp = yardOn("Mars", { throughputPerHour: 146, hours: 3 });
    applyMiningOperations(corp, START + 3 * HOUR);
    expect(held(corp)).toEqual({ Silicates: 438 });
    expect(corp.mining.silicateExtractors[0].totalMined).toBe(438);
  });

  it("on a body the catalog no longer has (a lease Bug #691 kept), Silicates, as every lease mined", () => {
    const corp = yardOn("Atlantis", { throughputPerHour: 100, hours: 1 });
    applyMiningOperations(corp, START + HOUR);
    expect(held(corp)).toEqual({ Silicates: 100 });
  });
});

describe("totalMined:<item> (AB#828)", () => {
  it("resolves for every item any body yields, and counts what the yards mined", () => {
    const corp = yardOn("Venus");
    applyMiningOperations(corp, START + 10 * HOUR);
    const got = held(corp);
    for (const [item, n] of Object.entries(got)) {
      if (item === "Silicates") continue; // totalMined:silicate is the yards' own metric, below
      expect(resolveMetric(`totalMined:${item.toLowerCase()}`, corp), item).toBe(n);
    }
    expect(resolveMetric("totalMined:silicate", corp)).toBe(got.Silicates);
    const everyItem = new Set(SYSTEMS_DATA.flatMap((s) => s.bodies.flatMap((b) => (b.resourceProfile || []).map((p) => p.item))));
    for (const item of everyItem) expect(() => resolveMetric(`totalMined:${item.toLowerCase()}`, makeCorp({})), item).not.toThrow();
  });

  it("a yard saved before AB#828 keeps its lifetime Silicates, and adds to them", () => {
    const corp = yardOn("Earth", { throughputPerHour: 40, hours: 1, extractor: { totalMined: 1000 } });
    ensureCorpMiningModel(corp);
    expect(corp.mining.silicateExtractors[0].minedByItem).toEqual({ Silicates: 1000 });
    expect(resolveMetric("totalMined:silicate", corp)).toBe(1000);
    applyMiningOperations(corp, START + HOUR);
    expect(resolveMetric("totalMined:silicate", corp)).toBe(1040);
  });
});
