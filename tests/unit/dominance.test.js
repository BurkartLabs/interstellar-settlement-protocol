import { describe, it, expect } from "vitest";
import { computeDominance, roundToSteps } from "../../server/game/dominance.js";
import { dayKeyOf, recordExtraction, recordSale, sameConglomerate, systemOfBody } from "../../server/game/dominanceCounters.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-217 (AB#912): the dominance metric (docs/design/CONGLOMERATES.md, "The dominance metric"), on a fixture world
// whose shares are worked by hand below, and the daily counters it reads.
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 28, 0, 1); // the first minute of 28 September: the window is 21 to 27 September
const DAY_IN = dayKeyOf(NOW) - 2 * DAY; // 26 September, inside the window
const DAY_OUT = dayKeyOf(NOW) - 8 * DAY; // 20 September, outside it
const TODAY = dayKeyOf(NOW); // 28 September: not yet a full day, not counted

const account = (publicId, name, { leases = [], extraction = {}, sales = {} } = {}) => ({
  id: `acc-${publicId}`,
  state: { corp: { publicId, corporationName: name, miningLeases: leases.map((body, i) => ({ id: `${publicId}-l${i}`, body })), dominance: { extraction, sales } } }
});

/**
 * Sol, worked by hand:
 *   leases:      A 2 (Earth, Mars), B 1 (Venus)                      of 3   -> L: A 2/3, B 1/3, C 0
 *   extraction:  A 600 t, B 400 t (26 Sep; A's 900 t on 20 Sep and 50 t today are outside the window)  of 1,000 -> X: A 0.6, B 0.4
 *   sales:       A 3,000 at Earth Station Prime, B 1,000 at Luna Gateway, C 6,000 at Mars Orbital Dock   of 10,000 -> S: A 0.3, B 0.1, C 0.6
 *   D(A) = 0.4 x 2/3 + 0.4 x 0.6 + 0.2 x 0.3 = 0.26667 + 0.24 + 0.06 = 0.56667
 *   D(B) = 0.4 x 1/3 + 0.4 x 0.4 + 0.2 x 0.1 = 0.13333 + 0.16 + 0.02 = 0.31333
 *   D(C) = 0         + 0         + 0.2 x 0.6 = 0.12                        (the three sum to 1)
 * Published in 5% steps (20 units) by largest remainder: A 11.33, B 6.27, C 2.40 -> 11, 6, 2 = 19; the 20th goes to the
 * largest remainder, C's 0.40 -> A 55%, B 30%, C 15%.
 * A and C are one conglomerate, "Halcyon Accord": 0.56667 + 0.12 = 0.68667 -> 13.73 units; B 0.31333 -> 6.27;
 * 13 + 6 = 19, the 20th to the Accord's 0.73 -> Halcyon Accord 70%, B 30%.
 * Alpha Centauri: nothing at all -> no activity. Barnard's Star, in the next test: only a sale by B at Ironwell Depot ->
 * S alone, its weight scaled to 1 -> B 100%.
 */
function world() {
  const A = account("corp-a", "Alder Mining", {
    leases: ["Earth", "Mars"],
    extraction: { [DAY_IN]: { sol: 600 }, [DAY_OUT]: { sol: 900 }, [TODAY]: { sol: 50 } },
    sales: { [DAY_IN]: { "earth-station-prime": 3_000 } }
  });
  const B = account("corp-b", "Birch Freight", {
    leases: ["Venus"],
    extraction: { [DAY_IN]: { sol: 400 } },
    sales: { [DAY_IN]: { "luna-gateway": 1_000 } }
  });
  const Cc = account("corp-c", "Cedar Trading", { sales: { [DAY_IN]: { "mars-orbital-dock": 6_000 } } });
  const conglomerates = [{ id: "cgl-1", name: "Halcyon Accord", members: [{ corp: "corp-a", role: "founder" }, { corp: "corp-c", role: "member" }] }];
  return { accounts: [A, B, Cc], conglomerates };
}

describe("the dominance metric on a hand-worked world (AB#912)", () => {
  const out = computeDominance(world(), NOW);

  it("matches the hand-worked shares, by corporation and by conglomerate", () => {
    expect(out.systems.sol.byCorporation).toEqual({ leaders: [{ name: "Alder Mining", share: 55 }, { name: "Birch Freight", share: 30 }, { name: "Cedar Trading", share: 15 }], others: 0 });
    expect(out.systems.sol.byConglomerate).toEqual({ leaders: [{ name: "Halcyon Accord", share: 70 }, { name: "Birch Freight", share: 30 }], others: 0 });
    expect(out.private["corp-a"].sol.dominance).toBeCloseTo(0.56667, 4);
    expect(out.private["corp-b"].sol.dominance).toBeCloseTo(0.31333, 4);
    expect(out.private["corp-c"].sol.dominance).toBeCloseTo(0.12, 4);
    expect(out.private["corp-a"].sol).toMatchObject({ leases: 2 / 3, extraction: 0.6, sales: 0.3 });
    expect(out.private["corp-c"].sol.conglomerate.dominance).toBeCloseTo(0.68667, 4); // a member sees its conglomerate summed
    expect(out.window).toEqual({ from: TODAY - 7 * DAY, to: TODAY });
  });

  it("gives a system with no activity an empty leader list, not an error", () => {
    expect(out.systems["alpha-centauri"]).toEqual({ activity: false, byCorporation: { leaders: [], others: 0 }, byConglomerate: { leaders: [], others: 0 } });
  });

  it("leaves out a component nobody has, and scales the others up", () => {
    const w = world();
    w.accounts[1].state.corp.dominance.sales[DAY_IN]["ironwell-depot"] = 500; // Barnard's Star
    const r = computeDominance(w, NOW);
    expect(r.systems["barnards-star"]).toEqual({ activity: true, byCorporation: { leaders: [{ name: "Birch Freight", share: 100 }], others: 0 }, byConglomerate: { leaders: [{ name: "Birch Freight", share: 100 }], others: 0 } });
    expect(r.private["corp-b"]["barnards-star"]).toEqual({ leases: 0, extraction: 0, sales: 1, dominance: 1 });
  });

  it("sums to exactly 100 in every active system, both views, with the fourth and later holders as others", () => {
    const many = { accounts: Array.from({ length: 7 }, (_, i) => account(`corp-${i}`, `Corp ${i}`, { extraction: { [DAY_IN]: { sol: 100 + i * 37 } } })), conglomerates: [] };
    const r = computeDominance(many, NOW).systems.sol.byCorporation;
    expect(r.leaders).toHaveLength(3);
    expect(r.leaders.reduce((s, l) => s + l.share, 0) + r.others).toBe(100);
    expect(r.others).toBeGreaterThan(0);
    for (const s of Object.values(computeDominance(world(), NOW).systems).filter((x) => x.activity)) {
      for (const v of [s.byCorporation, s.byConglomerate]) expect(v.leaders.reduce((a, l) => a + l.share, 0) + v.others).toBe(100);
    }
    for (const l of r.leaders) expect(l.share % C.dominancePublicRoundPct).toBe(0);
  });

  it("rounds by largest remainder so the steps always make 100", () => {
    expect(roundToSteps([{ name: "a", share: 1 / 3 }, { name: "b", share: 1 / 3 }, { name: "c", share: 1 / 3 }]).map((x) => x.share)).toEqual([35, 35, 30]);
    expect(roundToSteps([{ name: "a", share: 0.5 }, { name: "b", share: 0.5 }]).map((x) => x.share)).toEqual([50, 50]);
  });

  it("names holders and shares only: no ids, counts, tonnes or credits in the public part", () => {
    const text = JSON.stringify(out.systems);
    expect(text).not.toMatch(/corp-[abc]|acc-|600|400|3000|6000/);
    for (const s of Object.values(out.systems)) {
      expect(Object.keys(s).sort()).toEqual(["activity", "byConglomerate", "byCorporation"]);
      for (const v of [s.byCorporation, s.byConglomerate]) {
        expect(Object.keys(v).sort()).toEqual(["leaders", "others"]);
        for (const l of v.leaders) expect(Object.keys(l).sort()).toEqual(["name", "share"]);
      }
    }
  });

  it(`computes 1,000 corporations in well under a second`, () => {
    const systems = ["sol", "alpha-centauri", "barnards-star", "tau-ceti", "sirius"];
    const accounts = Array.from({ length: 1_000 }, (_, i) => account(`corp-k${i}`, `Corp ${i}`, {
      leases: ["Earth", "Mars", "Venus"].slice(0, 1 + (i % 3)),
      extraction: Object.fromEntries(Array.from({ length: 7 }, (_, d) => [dayKeyOf(NOW) - (d + 1) * DAY, { [systems[i % 5]]: 100 + i, sol: 10 + d }])),
      sales: Object.fromEntries(Array.from({ length: 7 }, (_, d) => [dayKeyOf(NOW) - (d + 1) * DAY, { "earth-station-prime": 1_000 + i, "luna-gateway": 50 }]))
    }));
    const conglomerates = Array.from({ length: 50 }, (_, k) => ({ id: `cgl-k${k}`, name: `Group ${k}`, members: Array.from({ length: 10 }, (_, j) => ({ corp: `corp-k${k * 10 + j}` })) }));
    const started = performance.now();
    const r = computeDominance({ accounts, conglomerates }, NOW);
    const ms = performance.now() - started;
    process.stderr.write(`[dominance] 1,000 corporations, 50 conglomerates, 7 days: ${ms.toFixed(1)} ms
`);
    expect(r.systems.sol.activity).toBe(true);
    expect(ms).toBeLessThan(1_000);
  });
});

describe("the daily counters (AB#912)", () => {
  it("count extraction per system and sales per station per UTC day, and keep 7 days", () => {
    const corp = {};
    recordExtraction(corp, "sol", 120, NOW);
    recordExtraction(corp, "sol", 30, NOW + 60_000);
    recordSale(corp, "earth-station-prime", 900, NOW);
    expect(corp.dominance.extraction[TODAY]).toEqual({ sol: 150 });
    expect(corp.dominance.sales[TODAY]).toEqual({ "earth-station-prime": 900 });
    recordExtraction(corp, "sol", 1, NOW + (C.dominanceWindowDays + 1) * DAY);
    expect(corp.dominance.extraction[TODAY]).toBeUndefined(); // older than the window: gone
    recordExtraction(corp, "sol", -5, NOW); recordSale(corp, null, 10, NOW);
    expect(Object.keys(corp.dominance.sales)).toHaveLength(0);
  });

  it("map a lease's body to its system, and know conglomerate partners", () => {
    expect([systemOfBody("Earth"), systemOfBody("mars"), systemOfBody("Nowhere")]).toEqual(["sol", "sol", null]);
    expect(sameConglomerate({ conglomerateId: "cgl-1" }, { conglomerateId: "cgl-1" })).toBe(true);
    expect(sameConglomerate({ conglomerateId: "cgl-1" }, { conglomerateId: null })).toBe(false);
    expect(sameConglomerate({}, {})).toBe(false);
  });
});
