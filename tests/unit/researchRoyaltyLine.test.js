import { describe, it, expect } from "vitest";
import { patentToPay, researchRoyalty, researchRoyaltyLine } from "../../public/scripts/patentRoyalty.js";
import { utcDate } from "../../public/scripts/timeFormat.js";

// Bug #4857: a research card named no royalty on a node another corporation had patented, so the 1% of Fusion Fuel
// Cycle's 12,000 in AB#940's playthrough was taken at completion unannounced. The card now says who, how much and when.
const NOW = Date.UTC(2147, 8, 29, 12);
const patent = { kind: "research", subjectId: "tt-fusion-fuel-cycle", holder: "Orion Holdings", ratePct: 1, filedAt: NOW - 3_600_000, endsAt: NOW + 14 * 86_400_000 };

describe("the research card's royalty line (Bug #4857)", () => {
  it("names the holder, the rate and the credits, and when they are charged", () => {
    expect(researchRoyaltyLine(patent, 12_000)).toBe(`Patented by Orion Holdings: 1% royalty, 120 credits, charged when the research completes (patent in force until ${utcDate(patent.endsAt)})`);
    expect(researchRoyalty(60_000, 25)).toBe(15_000); // the most a royalty can be: patents.royaltyMaxPct of a 60,000 node
  });

  it("says nothing on an unpatented node, the holder's own, or once the patent has ended", () => {
    expect(researchRoyaltyLine(null, 12_000)).toBeNull();
    expect(researchRoyaltyLine(patentToPay([patent], "research", "tt-fusion-fuel-cycle", "Orion Holdings", NOW), 12_000)).toBeNull();
    expect(researchRoyaltyLine(patentToPay([patent], "research", "tt-fusion-fuel-cycle", "Bright Logistics", patent.endsAt), 12_000)).toBeNull();
    expect(researchRoyaltyLine(patentToPay([patent], "research", "tt-fusion-fuel-cycle", "Bright Logistics", NOW), 12_000)).toContain("120 credits");
  });
});
