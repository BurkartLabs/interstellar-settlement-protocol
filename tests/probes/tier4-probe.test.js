import { describe, it, expect } from "vitest";
import { MARKETS, TIER4_PRODUCTS, allocation, formatReport, plan, contests, reachability, targets, timeToFirst } from "./tier4Probe.js";

// ISP-193 (AB#887): the Tier 4 probe. The ordinary suite plays 20 seeded market states per contest, enough to prove the
// planner runs and to print the table; TIER4_PROBE=1 (npm run probe:tier4) plays 200. Targets are printed, never
// asserted (AB#887: misses are reported and filed), except reachability: an unreachable Tier 4 product fails.
// BOT NUMBERS (P-PROXY).
const FULL = process.env.TIER4_PROBE === "1";

describe("the Tier 4 probe (AB#887)", () => {
  it(FULL ? "plays 200 market states per contest" : "plays 20 market states per contest", () => {
    const reach = reachability();
    const firsts = TIER4_PRODUCTS.map((p) => timeToFirst(p));
    const alloc = Object.fromEntries(MARKETS.map((m) => [m.name, allocation(FULL ? 200 : 20, { busy: m.busy })]));
    console.log(`\n${formatReport({ reach, firsts, alloc })}\n`);
    expect(reach).toEqual([]); // every Tier 4 product is reachable (T-019)
    expect(firsts).toHaveLength(6);
    for (const f of firsts) expect(f.total, f.product).toBeGreaterThan(0); // never a green run of nothing
    for (const list of Object.values(alloc)) {
      expect(list.length).toBeGreaterThanOrEqual(6);
      for (const a of list) expect(a.runs).toBe(FULL ? 200 : 20);
    }
    expect(targets({ reach, alloc })).toHaveLength(1 + MARKETS.length);
  }, FULL ? 1_800_000 : 180_000);

  it("the planner reproduces the design's worked example: Coils and Emitters share an empty day, one batch each, net 607", () => {
    const array = contests().find((c) => c.name === "Synthesis Array hours");
    const two = { ...array, recipes: array.recipes.filter((c) => ["superconductor-chain", "field-emitter-chain"].includes(c.id)) };
    expect(plan(two, 24, {})).toEqual({ net: 607, batches: [1, 1] }); // docs/design/v0.11-tier4.md section 4
  });

  it("fails a product that cannot be reached", () => {
    expect(reachability(["Antimatter Drives", "Unobtainium Widgets"])).toEqual([{ product: "Unobtainium Widgets", why: ["no chain makes it", "no standing bid buys it"] }]);
  });
});
