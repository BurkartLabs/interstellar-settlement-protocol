import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chainInputs, inputsLabel, maxBatches, minBatches, refineRunCheck, MAX_RUN_HOURS } from "../../public/scripts/refineryRun.js";
import { refineMinimum, refineQuantityCheck } from "../../public/scripts/refineQuantity.js";

// ISP-131 (AB#825): a chain takes `inputs`, one or several; a start takes every one in full or is refused whole.
const ALL_CHAINS = JSON.parse(readFileSync(new URL("../../data/refinery-chains.json", import.meta.url), "utf8")).chains;
// The one-input chains, which keep AB#1255's rule; AB#830's Fuel chains are the first in data with several inputs.
const CHAINS = ALL_CHAINS.filter((c) => c.inputs.length === 1);
const ALLOY = {
  id: "alloy",
  inputs: [{ item: "Iron Ore", quantityPerCycle: 150 }, { item: "Nickel", quantityPerCycle: 50 }],
  outputs: [{ item: "Nickel-Iron Alloy", quantityPerCycle: 80 }],
  cycleDurationHours: 5
};
const stock = (held) => (item) => held[item] ?? 0;

describe("a chain's inputs", () => {
  it("every chain in data has a list of one or more, each a whole quantity of a different item", () => {
    for (const c of ALL_CHAINS) {
      expect(chainInputs(c), c.id).toHaveLength(c.inputs.length);
      expect(new Set(c.inputs.map((i) => i.item)).size, c.id).toBe(c.inputs.length);
      expect(c.input, `${c.id} keeps no legacy field`).toBeUndefined();
      expect(c.inputQuantityPerCycle, c.id).toBeUndefined();
    }
    // AB#830: the Fuel track's two chains take two inputs each; AB#832: so does magnet-chain.
    expect(ALL_CHAINS.filter((c) => c.inputs.length > 1).map((c) => c.id).sort()).toEqual(["cryogenics-chain", "fusion-fuel-chain", "magnet-chain"]);
  });

  it("is null for anything the refinery cannot run, so the route fails closed", () => {
    for (const inputs of [undefined, null, [], "Nickel", [{ item: "Nickel" }], [{ item: "", quantityPerCycle: 5 }],
      [{ item: "Nickel", quantityPerCycle: 0 }], [{ item: "Nickel", quantityPerCycle: 2.5 }], [{ item: "Nickel", quantityPerCycle: "50" }],
      [{ item: "Nickel", quantityPerCycle: 5 }, { item: "Nickel", quantityPerCycle: 5 }]]) {
      expect(chainInputs({ inputs }), JSON.stringify(inputs)).toBeNull();
      expect(refineRunCheck({ inputs, cycleDurationHours: 4 }, { batches: 1 }).ok).toBe(false);
    }
  });

  it("labels a run as the receipt and the page show it", () => {
    expect(inputsLabel([{ item: "Iron Ore", quantity: 1500 }, { item: "Nickel", quantity: 500 }])).toBe("1,500 Iron Ore + 500 Nickel");
  });
});

describe("how long a run may be", () => {
  it("is a week of batches, at least one", () => {
    expect(MAX_RUN_HOURS).toBe(168);
    expect(maxBatches({ cycleDurationHours: 4 })).toBe(42);
    expect(maxBatches({ cycleDurationHours: 12 })).toBe(14);
    expect(maxBatches({ cycleDurationHours: 7 })).toBe(24);
    expect(maxBatches({ cycleDurationHours: 200 })).toBe(1);
    expect(maxBatches({})).toBe(1);
  });

  it("starts at the one-input chains' 100 units, and at one batch of several inputs", () => {
    for (const c of CHAINS) expect(minBatches(c) * c.inputs[0].quantityPerCycle, c.id).toBe(refineMinimum(c.inputs[0].quantityPerCycle));
    expect(minBatches(ALLOY)).toBe(1);
    for (const c of ALL_CHAINS.filter((x) => x.inputs.length > 1)) expect(minBatches(c), c.id).toBe(1);
  });
});

describe("a one-input chain runs exactly as before (AB#1255's rule)", () => {
  it("gives the same batches, debit and refusals as refineQuantityCheck, for every chain", () => {
    for (const c of CHAINS) {
      const { item, quantityPerCycle: per } = c.inputs[0];
      for (const q of [0, 5, per, refineMinimum(per), refineMinimum(per) + 1, refineMinimum(per) + per, "abc", "", -per]) {
        const before = refineQuantityCheck(q, { perCycle: per, input: item });
        const now = refineRunCheck(c, { inputQuantity: q });
        if (before.ok) {
          expect(now, `${c.id} ${q}`).toEqual({ ok: true, batches: before.batches, debits: [{ item, quantity: before.quantity }] });
        } else if (q === "") {
          expect(now.ok).toBe(false); // blank is "neither sent" now, still a refusal
        } else {
          expect(now, `${c.id} ${q}`).toEqual(before);
        }
      }
    }
  });

  it("refuses more than a week, naming the most it can take", () => {
    const silicates = CHAINS.find((c) => c.id === "silicates-chain");
    expect(refineRunCheck(silicates, { inputQuantity: 4200 }).ok).toBe(true);
    expect(refineRunCheck(silicates, { inputQuantity: 4300 })).toEqual({ ok: false, reason: "A run lasts at most a week: at most 42 batches of this chain (4,200 Silicates)." });
  });

  it("names what is short, in the words the route always used", () => {
    const carbon = CHAINS.find((c) => c.id === "carbon-chain");
    expect(refineRunCheck(carbon, { inputQuantity: 400 }, stock({ Carbon: 250 }))).toEqual({
      ok: false, reason: "Not enough Carbon at this station. Need 400 but only have 250.", missing: ["Carbon"]
    });
  });
});

describe("a chain of several inputs takes all of them or none", () => {
  it("debits every input, scaled by the batches", () => {
    expect(refineRunCheck(ALLOY, { batches: 3 }, stock({ "Iron Ore": 450, Nickel: 150 }))).toEqual({
      ok: true, batches: 3, debits: [{ item: "Iron Ore", quantity: 450 }, { item: "Nickel", quantity: 150 }]
    });
  });

  it("refuses when either input is short, naming only what is short", () => {
    const nickelShort = refineRunCheck(ALLOY, { batches: 3 }, stock({ "Iron Ore": 450, Nickel: 149 }));
    expect(nickelShort).toMatchObject({ ok: false, missing: ["Nickel"] });
    expect(nickelShort.reason).toBe("Not enough Nickel at this station. Need 150 but only have 149.");
    expect(refineRunCheck(ALLOY, { batches: 3 }, stock({ Nickel: 150 }))).toMatchObject({ ok: false, missing: ["Iron Ore"] });
    expect(refineRunCheck(ALLOY, { batches: 3 }, stock({})).missing).toEqual(["Iron Ore", "Nickel"]);
  });

  it("is asked for in batches: a quantity of one input, neither, both, or a bad number is refused", () => {
    const held = stock({ "Iron Ore": 1e6, Nickel: 1e6 });
    expect(refineRunCheck(ALLOY, { inputQuantity: 150 }, held)).toEqual({ ok: false, reason: "This chain takes Iron Ore and Nickel: enter a number of batches." });
    expect(refineRunCheck(ALLOY, {}, held)).toEqual({ ok: false, reason: "Enter a number of batches of Iron Ore and Nickel." });
    expect(refineRunCheck(ALLOY, { inputQuantity: 150, batches: 1 }, held).ok).toBe(false);
    for (const b of [0, -1, 2.5, "abc", "1e3", Number.NaN]) expect(refineRunCheck(ALLOY, { batches: b }, held).ok, String(b)).toBe(false);
    expect(refineRunCheck(ALLOY, { batches: 33 }, held).ok).toBe(true);
    expect(refineRunCheck(ALLOY, { batches: 34 }, held).reason).toBe("A run lasts at most a week: at most 33 batches of this chain (4,950 Iron Ore + 1,650 Nickel).");
  });
});
