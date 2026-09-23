// ISP-87 (AB#777, Depth Critique #426 epic 3): the standing bid is a floor that drifts with volume, not a ceiling
// that absorbs everything. These tests are about the shape of the rule; the numbers live in data/economy.json and
// are meant to move in the balance pass (ISP-42).

import { describe, it, expect } from "vitest";
import { ECONOMY, npcBidFor, npcBidAfterRecovery } from "../../server/economy.js";
import { ensureBidShape, freshGlobalState } from "../../server/gameState.js";

const BASE = 24; // what the silicate buyer pays an untouched market
const { quotaPerDay, floorPct } = ECONOMY.npcBid;
const floor = Math.round(BASE * (floorPct / 100));

describe("the bid falls as the day's volume is sold into it (ISP-87)", () => {
  it("pays the base price to the first seller of the day", () => {
    expect(npcBidFor(BASE, 0)).toBe(BASE);
  });

  it("never rises, and falls the more that is sold", () => {
    let last = npcBidFor(BASE, 0);
    for (let sold = 0; sold <= quotaPerDay * 2; sold += Math.round(quotaPerDay / 20)) {
      const bid = npcBidFor(BASE, sold);
      expect(bid).toBeLessThanOrEqual(last);
      last = bid;
    }
    expect(npcBidFor(BASE, quotaPerDay)).toBeLessThan(BASE);
  });

  it("never goes below the floor, at any volume anyone could ever sell", () => {
    for (const sold of [quotaPerDay, quotaPerDay * 10, 1e6, 1e9, Number.MAX_SAFE_INTEGER]) {
      expect(npcBidFor(BASE, sold), `sold ${sold}`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("treats nonsense as nothing sold rather than as a free discount", () => {
    for (const bad of [undefined, null, NaN, -5, "lots"]) {
      expect(npcBidFor(BASE, bad), String(bad)).toBe(BASE);
    }
  });
});

describe("the bid recovers overnight (ISP-87)", () => {
  it("comes back towards the base price without reaching it in one night", () => {
    const glutted = npcBidFor(BASE, quotaPerDay);
    const tomorrow = npcBidAfterRecovery(BASE, glutted);
    expect(tomorrow).toBeGreaterThan(glutted);
    expect(tomorrow).toBeLessThan(BASE);
    // And keeps coming back on the days after.
    expect(npcBidAfterRecovery(BASE, tomorrow)).toBeGreaterThan(tomorrow);
  });

  it("leaves a bid nobody touched where it was", () => {
    expect(npcBidAfterRecovery(BASE, BASE)).toBe(BASE);
  });
});

describe("what a saved order carries (ISP-87)", () => {
  it("a fresh install starts at the base price with the day's quota untouched", () => {
    const silicates = freshGlobalState().market.npcBuyOrders.find((o) => o.item === "Silicates");
    expect(silicates).toMatchObject({ basePrice: BASE, unitPrice: BASE, soldToday: 0, totalQtyPerDay: quotaPerDay, remainingQty: quotaPerDay });
  });

  it("an order saved before this change is brought up to date rather than left on the old fixed bid", () => {
    const old = { id: "npc-buy-silicates-daily", item: "Silicates", unitPrice: 24, totalQtyPerDay: 1_000_000, remainingQty: 999_000, lastResetDate: "2026-09-20" };
    ensureBidShape(old);
    expect(old.basePrice).toBe(24);
    expect(old.soldToday).toBe(0);
    expect(old.totalQtyPerDay).toBe(quotaPerDay);
    expect(old.remainingQty).toBeLessThanOrEqual(quotaPerDay);
  });
});
