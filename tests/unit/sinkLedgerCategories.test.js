import { describe, it, expect, afterEach, vi } from "vitest";
import { applyMiningOperations } from "../../server/gameState.js";
import { CREDIT_CATEGORIES } from "../../server/finances.js";
import { ECONOMY } from "../../server/economy.js";
import { playerBuilding } from "../../server/playerBuildings.js";
import { construct } from "../../server/construction.js";
import { startExtractorCycle } from "../../server/game/mining.js";
import { nextYardPrice } from "../../public/scripts/yardPrice.js";
import { makeCorp, makeExtractor } from "../fixtures/makeCorp.js";

// ISP-307 (AB#2299): yard upkeep (ISP-301) and the rising yard price (ISP-303) booked under ledger categories of their
// own, so ISP-304's probe can read each sink apart. The totals a corporation pays are unchanged; only the lines split.

const YARD = playerBuilding("basic-extractor-yard");
const lease = (id = "lease-earth", body = "Earth") => ({ id, body, leaseType: "Silicate Extraction", buildingSlots: 9, extractorIds: [] });
const spent = (corp) => corp.finances.expensesByCategory || {};

afterEach(() => vi.restoreAllMocks());

describe("the sinks' own ledger categories (ISP-307)", () => {
  it("are expense categories the ledger accepts", () => {
    expect(CREDIT_CATEGORIES.expense).toEqual(expect.arrayContaining(["yard-upkeep", "yard-price-growth"]));
  });

  it("a yard's price is booked as the first yard's price under construction and the rest as yard-price-growth", () => {
    for (const tech of [[], ["tt-supply-forecast"]]) {
      const corp = makeCorp({ unlockedTech: tech, buildingSlots: 9, buildings: [], finances: { credits: 1_000_000 }, miningLeases: [lease()] });
      const sf = tech.length > 0;
      const first = nextYardPrice(0, ECONOMY.buildings, sf);
      for (let owned = 0; owned < 3; owned += 1) {
        const before = { credits: corp.finances.credits, construction: spent(corp).construction || 0, growth: spent(corp)["yard-price-growth"] || 0 };
        const price = nextYardPrice(owned, ECONOMY.buildings, sf);
        expect(construct(corp, YARD, "lease-earth")).toMatchObject({ outcome: "ok", cost: price });
        expect(corp.finances.credits, `yard ${owned + 1}, ${tech}`).toBe(before.credits - price); // the total is unchanged
        expect((spent(corp).construction || 0) - before.construction).toBe(first);
        expect((spent(corp)["yard-price-growth"] || 0) - before.growth).toBe(price - first);
      }
    }
  });

  it("another building's price is all construction", () => {
    const corp = makeCorp({ unlockedTech: ["tt-assembly-fabrication"], buildingSlots: 9, buildings: [], finances: { credits: 1_000_000 } });
    construct(corp, playerBuilding("assembly-facility"), null);
    expect(spent(corp)).toMatchObject({ construction: playerBuilding("assembly-facility").cost });
    expect(spent(corp)["yard-price-growth"]).toBeUndefined();
  });

  it("an hour's running cost books its upkeep share as yard-upkeep and the rest as mining-ops, to the credit", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // no breakdown
    const start = 1_700_000_000_000;
    const ex = makeExtractor({ leaseId: "lease-earth" });
    startExtractorCycle(ex, { now: start, hours: 2, throughputPerHour: 40, operationCostPerHour: 700, upkeepPerHour: 100, startupCost: 0 });
    const corp = makeCorp({ finances: { credits: 1_000_000 }, miningLeases: [lease()], mining: { silicateExtractors: [ex] } });
    applyMiningOperations(corp, start + 3_600_000);
    expect(spent(corp)["mining-ops"]).toBe(600);
    expect(spent(corp)["yard-upkeep"]).toBe(100);
    expect(corp.finances.credits).toBe(1_000_000 - 700);
    expect(corp.mining.silicateExtractors[0].totalSpent).toBe(700);
  });

  it("a cycle started before the split (no upkeepPerHour on it) books as it did, all mining-ops", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const start = 1_700_000_000_000;
    const ex = makeExtractor({ leaseId: "lease-earth", active: true, startedAt: start, lastTickAt: start, endsAt: start + 7_200_000, throughputPerHour: 40, operationCostPerHour: 700 });
    const corp = makeCorp({ finances: { credits: 1_000_000 }, miningLeases: [lease()], mining: { silicateExtractors: [ex] } });
    applyMiningOperations(corp, start + 3_600_000);
    expect(spent(corp)["mining-ops"]).toBe(700);
    expect(spent(corp)["yard-upkeep"]).toBeUndefined();
  });
});
