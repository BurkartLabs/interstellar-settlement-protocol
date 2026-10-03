import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { deskFaucet, DESK_PACKETS_PER_HOUR } from "../../scripts/economy-model.mjs";

// AB#4689 slice 11: the Desk in the economy model, computed from data/economy.json (docs/design/desk-work.md section 7).

describe("the Desk faucet in the economy model", () => {
  it("prices a day at the design's section 7 figures today: 800, 1,200 and 2,200 at tier 1; 3,200, 4,800 and 8,800 at tier 3", () => {
    const { table } = deskFaucet(ECONOMY);
    const at = (tier, h) => table.find((r) => r.tier === tier && r.hoursPerDay === h).credits;
    expect([at(1, 1), at(1, 3), at(1, 8)]).toEqual([800, 1200, 2200]);
    expect([at(3, 1), at(3, 3), at(3, 8)]).toEqual([3200, 4800, 8800]);
    expect(DESK_PACKETS_PER_HOUR).toBe(20);
  });

  it("follows the data, not typed numbers: the fee, the cap and the over-cap share all move the day", () => {
    const changed = { ...ECONOMY, desk: { ...ECONOMY.desk, payByTier: [50, 80, 160], paidAssignmentsPerDay: 10, overCapPayPct: 50 } };
    const day = deskFaucet(changed).table.find((r) => r.tier === 1 && r.hoursPerDay === 3);
    expect(day.credits).toBe(10 * 50 + 50 * 25);
  });

  it("names both ways back from broke from the data: the Salvage Assignment's hours and payout, the packets that pay a cycle's startup", () => {
    const f = deskFaucet(ECONOMY);
    expect(f.salvage).toEqual({ hours: ECONOMY.salvage.hoursRequired, credits: ECONOMY.salvage.payoutCredits });
    expect(f.desk.packets).toBe(Math.ceil(ECONOMY.operations.minStartupCost / ECONOMY.desk.payByTier[0]));
    expect(f.desk.credits).toBeGreaterThanOrEqual(ECONOMY.operations.minStartupCost);
    expect(f.desk.minutes).toBe((f.desk.packets * 60) / DESK_PACKETS_PER_HOUR);
  });

  it("prices a day of office rent through the cap: 20 packets at full fee, then the rest at the over-cap share", () => {
    const f = deskFaucet(ECONOMY);
    const fee = ECONOMY.desk.payByTier[0];
    const over = Math.round((fee * ECONOMY.desk.overCapPayPct) / 100);
    const earned = Math.min(f.rent.packets, ECONOMY.desk.paidAssignmentsPerDay) * fee + Math.max(0, f.rent.packets - ECONOMY.desk.paidAssignmentsPerDay) * over;
    expect(earned).toBeGreaterThanOrEqual(ECONOMY.office.rentPerDay);
    expect(earned - (f.rent.packets > ECONOMY.desk.paidAssignmentsPerDay ? over : fee)).toBeLessThan(ECONOMY.office.rentPerDay);
  });
});
