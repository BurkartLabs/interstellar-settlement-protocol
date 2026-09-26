import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { refineMinimum, refineQuantityCheck, refineQuantityFieldValue } from "../../public/scripts/refineQuantity.js";

// AB#1255: a cleared Quantity field came back as the minimum on the next refresh (max(min, Number(""))), and Start Run
// spent it. The field now keeps what was typed, and Start Run checks it with this rule, which the route uses too.
const CHAINS = Object.fromEntries(
  JSON.parse(readFileSync(new URL("../../data/refinery-chains.json", import.meta.url), "utf8")).chains
    .filter((c) => c.inputs.length === 1) // AB#832: the one-input chains; Rare Earths also feeds magnet-chain now
    .map((c) => [c.inputs[0].item, c.inputs[0].quantityPerCycle])
);
const silicates = { perCycle: CHAINS.Silicates, input: "Silicates" };
const carbon = { perCycle: CHAINS.Carbon, input: "Carbon" };

describe("the Quantity field keeps what was typed (AB#1255)", () => {
  it("a cleared field stays blank after a re-render", () => {
    expect(refineQuantityFieldValue("", 100)).toBe("");
  });
  it("a small or odd entry stays as typed", () => {
    expect(refineQuantityFieldValue("5", 100)).toBe("5");
    expect(refineQuantityFieldValue("-5", 100)).toBe("-5");
    expect(refineQuantityFieldValue("2.5", 100)).toBe("2.5");
  });
  it("untouched, it suggests the amount", () => {
    expect(refineQuantityFieldValue(undefined, 400)).toBe("400");
  });
});

describe("the smallest run", () => {
  it("is whole batches of at least 100 units, for every chain", () => {
    expect(refineMinimum(CHAINS.Silicates)).toBe(100); // 100 a batch
    expect(refineMinimum(CHAINS["Helium-3"])).toBe(100); // 2 x 50
    expect(refineMinimum(CHAINS.Nickel)).toBe(120); // 1 x 120
    expect(refineMinimum(CHAINS.Titanium)).toBe(160); // 2 x 80
    expect(refineMinimum(CHAINS.Carbon)).toBe(200); // 1 x 200
    expect(refineMinimum(CHAINS["Rare Earths"])).toBe(120); // 3 x 40
  });
});

describe("Start Run refuses, it does not substitute (AB#1255)", () => {
  const refused = (raw, chain, available) => refineQuantityCheck(raw, { ...chain, available });
  it("blank", () => expect(refused("", silicates, 400)).toEqual({ ok: false, reason: "Enter how much Silicates to refine: at least 100." }));
  it("not a whole number", () => {
    for (const raw of ["abc", "2.5", "1e3", " "]) expect(refused(raw, silicates, 400).ok).toBe(false);
    expect(refused("2.5", silicates, 400).reason).toBe("Enter a whole number of Silicates: at least 100, in batches of 100.");
  });
  it("negative, zero and below the minimum", () => {
    expect(refused("-5", silicates, 400).reason).toBe("A run needs at least 100 Silicates.");
    expect(refused("0", silicates, 400).reason).toBe("A run needs at least 100 Silicates.");
    expect(refused("5", carbon, 450).reason).toBe("A run needs at least 200 Carbon.");
  });
  it("not whole batches, with the two nearest that are", () => {
    expect(refused("150", silicates, 400).reason).toBe("Runs use whole batches of 100 Silicates: enter 100 or 200.");
  });
  it("more than is at hand", () => {
    expect(refused("500", silicates, 400).reason).toBe("You have 400 Silicates here, not 500.");
  });
  it("accepts whole batches at or above the minimum, exactly as typed", () => {
    expect(refineQuantityCheck("200", { ...carbon, available: 450 })).toEqual({ ok: true, quantity: 200, batches: 1 });
    expect(refineQuantityCheck("300", { ...silicates, available: 400 })).toEqual({ ok: true, quantity: 300, batches: 3 });
    expect(refineQuantityCheck(100, silicates)).toEqual({ ok: true, quantity: 100, batches: 1 }); // a request's number
  });
});
