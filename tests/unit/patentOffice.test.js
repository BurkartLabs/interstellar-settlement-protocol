import { describe, it, expect } from "vitest";
import { patentOfficeHtml } from "../../public/scripts/patentOffice.js";
import { basePricesOf, chainRunRoyalty, patentToPay, researchRoyalty, royaltyOn } from "../../public/scripts/patentRoyalty.js";
import { runRoyaltyQuote } from "../../public/scripts/refineryRoyalty.js";

// ISP-237 (AB#932): the patent office at Corporate Registry & Charters, as HTML from the server's office and register,
// and the royalty a patented chain's run will pay (WARFARE.md, "Patents").
const H = 3_600_000, DAY = 24 * H;
const T = Date.UTC(2026, 9, 1, 12, 0);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const TERMS = { filingFee: 5_000, filingWindowHours: 72, termDays: 28, royaltyMaxPct: 25, chainRoyaltyMaxPct: 5 };
const PV = { kind: "chain", subjectId: "pressure-vessel-chain", subjectName: "pressure-vessel-chain", holder: "Kestrel Mining", ratePct: 4, filedAt: T - DAY, endsAt: T + 27 * DAY, active: true };
const CHAINS = [{ id: "pressure-vessel-chain", inputs: [{ item: "Nickel-Iron Alloy", quantityPerCycle: 80 }], outputs: [{ item: "Pressure Vessels", quantityPerCycle: 25 }] }];
const BASES = { "Pressure Vessels": 129 };
const ctx = {
  now: T, chains: CHAINS, basePrices: BASES, researchCost: (id) => ({ "tt-actinide-handling": 30_000 })[id],
  nameOf: (kind, id) => ({ "tt-actinide-handling": "Actinide Handling", "pressure-vessel-chain": "Nickel-Iron Alloy Refining" })[id]
};
const OFFICE = {
  terms: TERMS,
  filable: [{ kind: "research", subjectId: "tt-actinide-handling", subjectName: "Actinide Handling", maxPct: 25, completedAt: T - 5 * H, windowEndsAt: T + 67 * H }],
  mine: [{ id: "pat-1", kind: "research", subjectId: "tt-deep-core-extraction", subjectName: "Deep-Core Extraction", holder: "Nova Freight", ratePct: 12, filedAt: T - 2 * DAY, endsAt: T + 26 * DAY, active: true }],
  paying: [{ id: "pat-2", ...PV }],
  royalties: { received: 9_000, paid: 1_290 }
};

describe("the patent office (AB#932)", () => {
  it("lists what may be filed with its window and a rate select in its bound, and a button that names the fee", () => {
    const html = patentOfficeHtml({ office: OFFICE, register: [] }, ctx);
    const t = text(html);
    for (const s of ["Filing costs 5,000 credits", "within 72 hours", "runs 28 days and is never renewed", "Actinide Handling", "The window closes 2147-10-04 07:00 UTC (67 hours left)", "File patent (5,000 credits)"]) expect(t).toContain(s);
    expect(html).toMatch(/data-role="patent-file" data-kind="research" data-subject-id="tt-actinide-handling"/);
    expect(html.match(/<option/g)).toHaveLength(26); // 0 to 25%
  });

  it("says why there is nothing to file", () => {
    expect(text(patentOfficeHtml({ office: { ...OFFICE, filable: [] }, register: [] }, ctx))).toContain("Nothing to file now. Complete a research node of tier 3 or above");
  });

  it("shows the corporation's patents and royalties received, and what each patent it pays on costs it", () => {
    const t = text(patentOfficeHtml({ office: OFFICE, register: [] }, ctx));
    for (const s of ["Royalties received: 9,000 credits", "Deep-Core Extraction", "Royalty 12%", "Royalties paid: 1,290 credits", "Nickel-Iron Alloy Refining", "Holder Kestrel Mining", "4% of each run's output at the standing bid: 129 credits a batch"]) expect(t).toContain(s);
  });

  it("draws the public register: holder, subject, rate and term end", () => {
    const t = text(patentOfficeHtml({ office: OFFICE, register: [{ id: "pat-2", ...PV }, { ...OFFICE.mine[0], active: false, endsAt: T - DAY }] }, ctx));
    expect(t).toContain("Nickel-Iron Alloy Refining Refinery chain In force Holder Kestrel Mining Royalty 4% Ends 2147-10-28 12:00 UTC");
    expect(t).toContain("Deep-Core Extraction Research node Expired Holder Nova Freight Royalty 12% Ended 2147-09-30 12:00 UTC");
  });
});

describe("a patent's royalty (AB#932)", () => {
  it("is the rate of the run's outputs at the standing bids' base, rounded; a research node's is the rate of its cost", () => {
    expect(royaltyOn(3_225, 4)).toBe(129);
    expect(chainRunRoyalty([{ item: "Pressure Vessels", quantity: 250 }], 4, BASES)).toEqual({ value: 32_250, royalty: 1_290 });
    expect(chainRunRoyalty([{ item: "Pressure Vessels", quantity: 250 }], 0, BASES).royalty).toBe(0);
    expect(researchRoyalty(30_000, 12)).toBe(3_600);
    expect(basePricesOf([{ item: "Pressure Vessels", basePrice: 129, unitPrice: 100 }, { item: "X" }])).toEqual({ "Pressure Vessels": 129 });
  });

  it("is quoted for the run's own output: its batches and its refinery's tier", () => {
    const q = runRoyaltyQuote({ patent: PV, chain: CHAINS[0], batches: 10, tier: 2, multiplier: 1.5, basePrices: BASES });
    expect(q.outputs).toEqual([{ item: "Pressure Vessels", quantity: 375 }]);
    expect(q).toMatchObject({ value: 48_375, royalty: 1_935 });
    expect(text(q.rows.map((r) => `${r.label} ${r.value}`).join(" "))).toContain("Royalty 1,935 credits: 4% of the output's 48,375 at the standing bid, charged when the run delivers");
  });

  it("is paid on another corporation's patent in force, never on the caller's own or an expired one", () => {
    expect(patentToPay([PV], "chain", "pressure-vessel-chain", "Nova Freight", T)).toBe(PV);
    expect(patentToPay([PV], "chain", "pressure-vessel-chain", "Kestrel Mining", T)).toBeNull();
    expect(patentToPay([PV], "chain", "pressure-vessel-chain", "Nova Freight", PV.endsAt)).toBeNull();
    expect(patentToPay([PV], "chain", "al-li-chain", "Nova Freight", T)).toBeNull();
  });
});
