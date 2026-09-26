import { describe, it, expect } from "vitest";
import {
  ECONOMY, bestThroughputFor, npcBidFor, operationCostPerHourFor, startupCostFor, yardTierFor, yardUpgradeTo, yardUpkeepPerHourFor
} from "../../server/economy.js";
import { MILESTONE_LEVELS } from "../../server/game/catalog.js";

// ISP-101 (AB#793): the probe docs/design/upgrades.md (AB#791) names. Two headless bots play the same seven days from
// the same start; one follows the design's rule, the other always upgrades first. BOT NUMBERS (P-PROXY): they measure a
// policy against these prices, not what a player does.
//
// Every price is the game's own function: the running cost at the yard's tier (operationCostPerHourFor), the upkeep
// (AB#2284), the startup, the tier table and the upgrade prices, and the NPC bid (npcBidFor), sold into once a day at
// the day's opening bid (a sale is priced at the bid before it, server/routes/market.js). Uptime is the model's
// expected 81.6% (ECONOMY.md); downtime is not rolled, so there is no seed.
//
// Start: the model's first session (ECONOMY.md): 163,000 credits after an office, five hires, the Earth lease and one
// tier-1 yard, with the lease's second slot free, at Level 2, whose maxUpgradeTier the milestones give.

const UPTIME = 0.816;
const PRICE = ECONOMY.npcBuyers.find((b) => b.item === "Silicates").unitPrice;
const TAX = ECONOMY.exchange.salesTaxPct;
const LEVEL = 2;
const MAX_TIER = Math.max(...MILESTONE_LEVELS.filter((l) => l.level <= LEVEL).map((l) => l.unlocks.maxUpgradeTier || 1));
const PAYROLL_PER_LEASE = 5 * ECONOMY.employees.payrollPerDay;
const LEASES = [{ body: "Mars", cost: 25_000 }, { body: "Luna", cost: 30_000 }]; // data/systems.json, after Earth
const HORIZON_DAYS = 30;

const best = (tier) => bestThroughputFor({ unitPrice: PRICE, taxPct: TAX, tier });
const costPerHour = (yard, index) => operationCostPerHourFor(best(yard.tier).throughput, undefined, { tier: yard.tier }) + yardUpkeepPerHourFor(index);
/** One expected day of running cost for these yards: the float the rule keeps. */
const float = (yards) => yards.reduce((sum, y, i) => sum + costPerHour(y, i) * 24 * UPTIME, 0);
const expectedProfitPerDay = (tier) => best(tier).profitPerHour * 24 * UPTIME;

function play(policy) {
  const s = { credits: 163_000, spent: 0, earned: 0, leases: 1, freeSlots: 1, yards: [{ tier: 1, offlineUntil: 0 }], moves: [] };
  const pay = (n) => { s.credits -= n; s.spent += n; };

  const buildMove = () => {
    if (s.freeSlots > 0) return { kind: "build", cost: ECONOMY.buildings.extractorYardCost, lease: null };
    const lease = LEASES[s.leases - 1];
    return lease ? { kind: "build", cost: lease.cost + 5 * ECONOMY.employees.hireCost + ECONOMY.buildings.extractorYardCost, lease } : null;
  };
  const upgradeMove = (hour) => {
    const idle = s.yards.map((y, i) => ({ y, i })).filter(({ y }) => y.tier < MAX_TIER && y.offlineUntil <= hour).sort((a, b) => a.y.tier - b.y.tier)[0];
    if (!idle) return null;
    const row = yardUpgradeTo(idle.y.tier + 1);
    const gain = expectedProfitPerDay(idle.y.tier + 1) - expectedProfitPerDay(idle.y.tier);
    const payback = (row.upgradeCost + row.offlineHours * best(idle.y.tier).profitPerHour * UPTIME) / gain;
    return { kind: "upgrade", cost: row.upgradeCost, index: idle.i, row, payback };
  };
  const after = (move) => {
    if (move.kind === "build") return [...s.yards, { tier: 1, offlineUntil: 0 }];
    return s.yards.map((y, i) => (i === move.index ? { ...y, tier: y.tier + 1 } : y));
  };

  const decide = (hour) => {
    for (;;) {
      const build = buildMove();
      const upgrade = upgradeMove(hour);
      const ruleUpgrade = upgrade && upgrade.payback <= HORIZON_DAYS ? upgrade : null;
      const move = policy === "rule" ? (build || ruleUpgrade) : (upgrade || build);
      if (!move || s.credits - move.cost < float(after(move))) return; // wait
      pay(move.cost);
      if (move.kind === "build") {
        if (move.lease) { s.leases += 1; s.freeSlots = 1; } else { s.freeSlots -= 1; }
        s.yards.push({ tier: 1, offlineUntil: hour });
      } else {
        s.yards[move.index].tier += 1;
        s.yards[move.index].offlineUntil = hour + move.row.offlineHours;
      }
      s.moves.push(`${move.kind}@${hour / 24}d`);
    }
  };

  let ore = 0;
  for (let hour = 0; hour < 7 * 24; hour += 1) {
    if (hour % 24 === 0) {
      decide(hour);
      pay(s.leases * PAYROLL_PER_LEASE + ECONOMY.office.rentPerDay);
      // Each running yard starts a 24-hour cycle: the startup is priced on the cost without upkeep (AB#2284).
      s.yards.forEach((y) => { if (y.offlineUntil <= hour) pay(startupCostFor(operationCostPerHourFor(best(y.tier).throughput, undefined, { tier: y.tier }))); });
    }
    s.yards.forEach((y, i) => {
      if (y.offlineUntil > hour) return;
      ore += best(y.tier).throughput * UPTIME;
      pay(costPerHour(y, i) * UPTIME);
    });
    if (hour % 24 === 23) {
      // One sale a day at the opening bid, up to the day's quota; the rest waits for tomorrow.
      const lot = Math.min(Math.floor(ore), ECONOMY.npcBid.quotaPerDay);
      const proceeds = lot * npcBidFor(PRICE, 0) * (1 - TAX / 100);
      s.credits += proceeds; s.earned += proceeds; ore -= lot;
    }
  }
  return { credits: Math.round(s.credits), net: Math.round(s.earned - s.spent), moves: s.moves, tiers: s.yards.map((y) => y.tier) };
}

describe("upgrading first is worse than the design's rule (AB#791's probe target, bot numbers)", () => {
  const rule = play("rule");
  const upgradeFirst = play("upgrade-first");

  it("the two bots made different moves, so the comparison means something", () => {
    expect(MAX_TIER).toBe(2);
    expect(rule.moves).not.toEqual(upgradeFirst.moves);
  });

  it("the always-upgrade bot ends day 7 with at least 10% fewer credits than the rule bot", () => {
    console.log(`[probe AB#793, bot numbers] day 7 credits: rule ${rule.credits.toLocaleString()} (${rule.moves.join(", ")}; tiers ${rule.tiers}), upgrade-first ${upgradeFirst.credits.toLocaleString()} (${upgradeFirst.moves.join(", ")}; tiers ${upgradeFirst.tiers}); net cash generated: rule ${rule.net.toLocaleString()}, upgrade-first ${upgradeFirst.net.toLocaleString()}`);
    // The design reads the target on net cash generated if both end under 10,000 credits (they end near zero today).
    const [a, b] = rule.credits < 10_000 && upgradeFirst.credits < 10_000 ? [rule.net, upgradeFirst.net] : [rule.credits, upgradeFirst.credits];
    expect(b).toBeLessThanOrEqual(a * 0.9);
  });

  it("each tier's settings are the table's (ECONOMY.md, docs/design/upgrades.md)", () => {
    expect([1, 2, 3, 4, 5].map((t) => yardTierFor(t).throughputCap)).toEqual([250, 313, 391, 488, 610]);
    expect([1, 2, 3].map((t) => best(t).throughput)).toEqual([146, 182, 232]);
    expect([1, 2, 3].map((t) => best(t).profitPerHour)).toEqual([606, 757, 947]);
  });
});
