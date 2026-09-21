import { describe, it, expect } from "vitest";
import { missionRewardCredits } from "../../public/scripts/ceoEffects.js";

// Bug #1009: what a completed mission pays, the one rule the server credits and the client reports.
describe("missionRewardCredits (Bug #1009)", () => {
  it("reads the credits out of a mission's reward text", () => {
    expect(missionRewardCredits("12,000 Credits", [])).toBe(12000);
    expect(missionRewardCredits("8,000 Credits")).toBe(8000);
    expect(missionRewardCredits(35000, [])).toBe(35000);
  });

  it("pays 8% more, rounded to whole credits, with Contract Law Essentials", () => {
    expect(missionRewardCredits("12,000 Credits", ["ceo-contract-law"])).toBe(12960);
    expect(missionRewardCredits("10,001 Credits", ["ceo-contract-law"])).toBe(10801);
  });

  it("pays nothing for a reward with no number in it", () => {
    expect(missionRewardCredits("Reputation only", ["ceo-contract-law"])).toBe(0);
    expect(missionRewardCredits(undefined, [])).toBe(0);
  });
});
