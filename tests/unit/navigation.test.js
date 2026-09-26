import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { navigationFor } from "../../public/scripts/navigation.js";

// ISP-112 (AB#804): the gate reads each system's accessResearch from data/systems.json.
const { researchForSystem, canReachSystem } = navigationFor(JSON.parse(fs.readFileSync(new URL("../../data/systems.json", import.meta.url), "utf8")));

// Bug #976: the travel gate treated every system that was not a near star as deep-star, Sol included, so a
// corporation with only Proxima navigation could jump to Alpha Centauri and never come home.
const PROXIMA = "tt-proxima-navigation";
const DEEP = "tt-deep-star-navigation";

describe("researchForSystem (Bug #976)", () => {
  it("needs nothing for Sol, Proxima navigation for the near stars and deep-star navigation beyond", () => {
    expect(researchForSystem("sol")).toBeNull();
    expect(researchForSystem("alpha-centauri")).toBe(PROXIMA);
    expect(researchForSystem("barnards-star")).toBe(PROXIMA);
    expect(researchForSystem("epsilon-eridani")).toBe(DEEP);
  });
});

describe("canReachSystem (Bug #976)", () => {
  it("lets a corporation at Alpha Centauri with only Proxima navigation go home to Sol", () => {
    expect(canReachSystem([PROXIMA], "alpha-centauri", "sol")).toBe(true);
  });

  it("still refuses that corporation a deep-star system, and accepts a Set or an array", () => {
    expect(canReachSystem([PROXIMA], "alpha-centauri", "epsilon-eridani")).toBe(false);
    expect(canReachSystem(new Set([PROXIMA]), "alpha-centauri", "barnards-star")).toBe(true);
    expect(canReachSystem(new Set([PROXIMA, DEEP]), "alpha-centauri", "epsilon-eridani")).toBe(true);
  });

  it("refuses a corporation with no research anything but Sol and where it already is", () => {
    expect(canReachSystem([], "sol", "alpha-centauri")).toBe(false);
    expect(canReachSystem(undefined, undefined, "sol")).toBe(true);
    expect(canReachSystem([], "epsilon-eridani", "epsilon-eridani")).toBe(true);
  });
});
