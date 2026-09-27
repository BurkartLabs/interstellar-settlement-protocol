import { describe, it, expect } from "vitest";
import { isMemberStation, memberOfficeCost, transferFeeWaived } from "../../public/scripts/memberRates.js";
import { planTransfer } from "../../public/scripts/logistics.js";

// ISP-212 (AB#907): the member rates, shared by the server's charge and the page's quote.
const MINE = { id: "cg-haven", officeRentPct: 50 };

describe("member rates (ISP-212, AB#907)", () => {
  it("halve an office's cost at the member's own station only", () => {
    expect(isMemberStation(MINE, "cg-haven")).toBe(true);
    expect(memberOfficeCost(7_000, MINE, "cg-haven")).toBe(3_500);
    expect(memberOfficeCost(7_001, MINE, "cg-haven")).toBe(3_501);
    expect(memberOfficeCost(7_000, MINE, "earth-station-prime")).toBe(7_000);
    expect(memberOfficeCost(7_000, null, "cg-haven")).toBe(7_000);
  });

  it("waive a transfer's fee only within the system, to or from the member's station", () => {
    expect(transferFeeWaived("cg-haven", "haven-dock", "cg-haven", 0)).toBe(true);
    expect(transferFeeWaived("cg-haven", "cg-haven", "haven-dock", 0)).toBe(true);
    expect(transferFeeWaived("cg-haven", "earth-station-prime", "cg-haven", 2)).toBe(false);
    expect(transferFeeWaived("cg-haven", "a", "b", 0)).toBe(false);
    expect(transferFeeWaived(null, "haven-dock", "cg-haven", 0)).toBe(false);
  });

  it("reach planTransfer, which the page and the server both call", () => {
    const stations = { "cg-haven": { id: "cg-haven", name: "Haven Hold", systemId: "x" }, "haven-dock": { id: "haven-dock", name: "Haven Dock", systemId: "x" } };
    const nav = { systemHops: (a, b) => (a === b ? 0 : null) };
    const args = { fromStationId: "haven-dock", toStationId: "cg-haven", lines: [{ item: "Silicates", quantity: 10 }], inventory: { "haven-dock": { Silicates: 10 } }, credits: 1_000, stations, rates: { sameSystemFeePerUnit: 2, perJumpFeePerUnit: 3 }, navigation: nav };
    expect(planTransfer(args)).toMatchObject({ ok: true, fee: 20, waived: false });
    expect(planTransfer({ ...args, memberStationId: "cg-haven" })).toMatchObject({ ok: true, fee: 0, waived: true });
    expect(planTransfer({ ...args, memberStationId: "cg-haven", credits: 0 })).toMatchObject({ ok: true, fee: 0 }); // free needs no credits
  });
});
