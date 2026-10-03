import { describe, it, expect } from "vitest";
import { ECONOMY } from "../../server/economy.js";
import { REPUTATION_TIERS_DATA, CONTRACTS_PER_AGENT, CONTRACT_REFRESH_MS, refreshContractOfferings } from "../../server/game/corporation.js";
import { corpCard } from "../../server/game/messaging.js";
import { deskState, drawEntry } from "../../server/game/deskDraws.js";
import { contractRefreshMsFor, contractsOfferedFor, deskTiersFor, gradeOf, hasPerk, priorityPrice } from "../../public/scripts/bureauStanding.js";

// AB#4689 slice 8: what a grade gives (docs/design/desk-work.md section 4, the perks table). Points per grade are the
// tiers' thresholds: Recognized 30, Trusted 150, Valued 300, Distinguished 600.

const T = REPUTATION_TIERS_DATA;
const at = (title) => T.thresholds[T.titles.indexOf(title)];
const corpWith = (points) => ({ agentReputation: { "elara-voss": { points } }, completedMissions: [], activeMissions: [], unlockedTech: [] });

describe("the grades the perks open at", () => {
  it("are the design's: Recognized 30, Trusted 150, Valued 300, Distinguished 600 points", () => {
    expect([at("Recognized"), at("Trusted"), at("Valued"), at("Distinguished")]).toEqual([30, 150, 300, 600]);
    expect(gradeOf(0, T).title).toBe("Unknown");
    expect(hasPerk(29, T, "deskTier2")).toBe(false);
    expect(hasPerk(30, T, "deskTier2")).toBe(true);
  });
});

describe("Desk tiers", () => {
  it("open tier 2 at Recognized and tier 3 at Trusted, and tier 1 alone below", () => {
    expect(deskTiersFor(0, T)).toEqual([1]);
    expect(deskTiersFor(29, T)).toEqual([1]);
    expect(deskTiersFor(30, T)).toEqual([1, 2]);
    expect(deskTiersFor(149, T)).toEqual([1, 2]);
    expect(deskTiersFor(150, T)).toEqual([1, 2, 3]);
  });

  it("draw every opened tier and no other, and keep each draw's kind whatever tiers are open", () => {
    const seen = new Set();
    for (let draw = 1; draw <= 300; draw += 1) {
      const trusted = drawEntry("acct-perks", draw, undefined, [1, 2, 3]);
      seen.add(trusted.tier);
      expect(trusted.kind).toBe(drawEntry("acct-perks", draw).kind);
      expect(drawEntry("acct-perks", draw).tier).toBe(1);
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it("a Trusted corporation that never opened the Desk is shown draws at its tiers", () => {
    const tiers = new Set();
    for (let i = 0; i < 40; i += 1) for (const e of deskState(corpWith(150), `acct-${i}`).open) tiers.add(e.tier);
    expect([...tiers].sort()).toEqual([1, 2, 3]);
    for (let i = 0; i < 40; i += 1) for (const e of deskState(corpWith(29), `acct-${i}`).open) expect(e.tier).toBe(1);
  });
});

describe("the Bureau's contract board", () => {
  it("offers a third contract at Recognized and a fourth at Distinguished", () => {
    expect(contractsOfferedFor(29, T, CONTRACTS_PER_AGENT)).toBe(2);
    expect(contractsOfferedFor(30, T, CONTRACTS_PER_AGENT)).toBe(3);
    expect(contractsOfferedFor(599, T, CONTRACTS_PER_AGENT)).toBe(3);
    expect(contractsOfferedFor(600, T, CONTRACTS_PER_AGENT)).toBe(4);
    for (const [points, n] of [[0, 2], [30, 3], [600, 4]]) {
      const corp = corpWith(points);
      refreshContractOfferings(corp);
      expect(corp.contractOfferings.missions.filter((m) => m.kind !== "time-served"), `${points} points`).toHaveLength(n);
    }
  });

  it("refreshes hourly from Trusted, every two hours below", () => {
    expect(contractRefreshMsFor(149, T, CONTRACT_REFRESH_MS)).toBe(2 * 3_600_000);
    expect(contractRefreshMsFor(150, T, CONTRACT_REFRESH_MS)).toBe(3_600_000);
    for (const [points, hours] of [[149, 2], [150, 1]]) {
      const corp = corpWith(points);
      const before = Date.now();
      refreshContractOfferings(corp);
      expect(corp.contractOfferings.nextRefreshAt - before).toBeGreaterThanOrEqual(hours * 3_600_000 - 1000);
      expect(corp.contractOfferings.nextRefreshAt - before).toBeLessThanOrEqual(hours * 3_600_000 + 1000);
    }
  });
});

describe("priority processing", () => {
  it("takes exactly priorityProcessingPct off from Valued, and nothing below", () => {
    const pct = ECONOMY.desk.priorityProcessingPct;
    expect(pct).toBe(5);
    for (const price of [20000, 25000, 1000, 7000, 333]) {
      expect(priorityPrice(price, 299, T, pct)).toBe(price);
      expect(priorityPrice(price, 300, T, pct)).toBe(Math.round((price * (100 - pct)) / 100));
    }
    expect(priorityPrice(20000, 300, T, 0)).toBe(20000);
  });
});

describe("the public card", () => {
  it("shows the grade title, Unknown at 0 points", () => {
    const card = (points) => corpCard({ state: { corp: { publicId: "p", corporationName: "C", ...corpWith(points) } } });
    expect(card(0).grade).toBe("Unknown");
    expect(card(30).grade).toBe("Recognized");
    expect(card(300).grade).toBe("Valued");
    expect(corpCard({ state: { corp: { publicId: "p", agentReputation: { "elara-voss": { completedCount: 7 } } } } }).grade).toBe("Reliable");
  });
});
