// ISP-302 (AB#2285), ECONOMY.md "Sinks that scale with income" sink 2: the ISA lease royalty. The Exchange's sales tax
// rises with leases held (1 point at 2, 2 at 3, 3 at 5 or more), the Negotiation Fundamentals discount still applies,
// and the rate never goes below 0. Chosen, not derived: the Board has not seen these numbers.

import { describe, expect, it } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { exchangeTaxBreakdown, getEffectiveExchangeTaxRate } from "../../server/game/progression.js";
import { royaltyPointsFor, taxOnSale } from "../../public/scripts/exchangeTax.js";

const state = (leases, negotiationLevels = 0) => ({
  corp: {
    miningLeases: Array.from({ length: leases }, (_, i) => ({ id: `lease-${i}`, body: "Earth" })),
    completedInsights: Array.from({ length: negotiationLevels }, () => "ceo-negotiation-fundamentals")
  }
});

describe("the lease royalty (AB#2285)", () => {
  it("reads its table from data/economy.json", () => {
    expect(ECONOMY.leases.royaltyPointsByLeasesHeld).toEqual({ 2: 1, 3: 2, 5: 3 });
  });

  it("is 8% at 0 and 1 lease, 9% at 2, 10% at 3 and 4, 11% at 5 and 6", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => getEffectiveExchangeTaxRate(state(n)))).toEqual([8, 8, 9, 10, 10, 11, 11]);
  });

  it("each less the Negotiation Fundamentals discount, 2 points a level up to 3, never below 0", () => {
    for (let level = 0; level <= 4; level += 1) {
      const off = Math.min(level, 3) * 2;
      expect([0, 1, 2, 3, 4, 5, 6].map((n) => getEffectiveExchangeTaxRate(state(n, level))), `level ${level}`)
        .toEqual([8, 8, 9, 10, 10, 11, 11].map((r) => Math.max(0, r - off)));
    }
  });

  it("the breakdown's parts add up to the rate, and the discount comes off the base tax first", () => {
    const b = exchangeTaxBreakdown(state(3, 3)); // 8 + 2 - 6
    expect(b).toMatchObject({ leasesHeld: 3, royaltyPoints: 2, discountPoints: 6, ratePct: 4, royaltyPct: 2, salesTaxPct: 2 });
    for (let n = 0; n <= 6; n += 1) for (let level = 0; level <= 3; level += 1) {
      const x = exchangeTaxBreakdown(state(n, level));
      expect(x.salesTaxPct + x.royaltyPct).toBe(x.ratePct);
      expect(x.royaltyPct).toBeGreaterThanOrEqual(0);
      expect(x.salesTaxPct).toBeGreaterThanOrEqual(0);
    }
  });

  it("a one-lease corporation pays no royalty on any sale", () => {
    for (const gross of [1, 24, 999, 24_000, 1_000_000]) expect(taxOnSale(gross, exchangeTaxBreakdown(state(1))).royalty).toBe(0);
  });

  it("splits a sale into the sales tax and the royalty, which add up to the whole tax", () => {
    const sale = taxOnSale(10_000, exchangeTaxBreakdown(state(5)));
    expect(sale).toEqual({ tax: 1100, royalty: 300, salesTax: 800, proceeds: 8900 });
    for (const gross of [1, 7, 99, 1234, 55_555]) {
      const s = taxOnSale(gross, exchangeTaxBreakdown(state(4, 1)));
      expect(s.royalty + s.salesTax).toBe(s.tax);
      expect(s.royalty).toBeLessThanOrEqual(s.tax);
    }
  });

  it("takes the entry for the largest lease count at or below the one held", () => {
    const table = { 2: 1, 3: 2, 5: 3 };
    expect([0, 1, 2, 3, 4, 5, 9, 100].map((n) => royaltyPointsFor(n, table))).toEqual([0, 0, 1, 2, 2, 3, 3, 3]);
  });
});
