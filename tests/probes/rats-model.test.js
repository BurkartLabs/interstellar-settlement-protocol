import { describe, it, expect } from "vitest";
import { ESCORTS, RATS, belts, best, encounterChance, launch, meanHaulLost, ratGroup } from "../../scripts/rats-model.mjs";

// AB#819: the probe target docs/design/rats.md names, a bot number (the optimising bot in scripts/rats-model.mjs over an
// escort menu, one probe in one slot), not a measure of players. If the Rats' numbers change so that one launch setting
// is best everywhere, the choice T-018 asks for has collapsed, and this fails.
const all = belts();
const bySystem = (id) => all.find((b) => b.system.id === id);
const key = (t) => `${t.length} / ${t.escort}`;

describe("Rats: no single launch setting wins (AB#819, T-018)", () => {
  it("finds at least four distinct best settings across the belts, none best in more than half", () => {
    const counts = {};
    for (const b of all) { const k = key(best(b)); counts[k] = (counts[k] || 0) + 1; }
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(Math.floor(all.length / 2));
  });

  it("gives Sol and Wolf 359 different best lengths and escorts, as the design works through", () => {
    expect(key(best(bySystem("sol")))).toBe("extended / none");
    const wolf = bySystem("wolf-359");
    expect(key(best(wolf))).toBe("extended / 6 DS + 6 AT");
    // without a fleet, Wolf 359's best length is shorter than Sol's
    const unescorted = Object.keys(RATS.lengthsHours).map((len) => [len, launch(wolf, len, "none").perHour]).sort((a, b) => b[1] - a[1]);
    expect(unescorted[0][0]).toBe("standard");
  });
});

describe("Rats: the formula's promises (AB#819)", () => {
  it("rises with density and length, an escort lowers it, and the loss table averages 22%", () => {
    expect(encounterChance(31, 2)).toBeGreaterThan(encounterChance(11, 2));
    expect(encounterChance(31, 2)).toBeGreaterThan(encounterChance(31, 1));
    expect(encounterChance(31, 2, ESCORTS["6 DS + 6 AT"])).toBeLessThan(encounterChance(31, 2));
    expect(meanHaulLost).toBeCloseTo(0.22, 10);
    expect(ratGroup(31)).toEqual({ lf: 10, ds: 3 });
    // the rate rises through an expedition: twice as long is more than twice the expected encounters
    const mu = (T) => -Math.log(1 - encounterChance(20, T));
    expect(mu(2)).toBeGreaterThan(2 * mu(1));
  });
});
