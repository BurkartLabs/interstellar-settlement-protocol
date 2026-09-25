// AB#1051: contract offers vary quota and reward within the template's own bounds, so the same template does not
// read identically forever. materializeOffer (server/game/corporation.js) is the one place that rolls it.
import { describe, it, expect } from "vitest";
import { MISSION_TEMPLATES, materializeOffer, refreshContractOfferings, FIRST_CONTRACT_ID } from "../../server/gameState.js";

function parseRewardCredits(reward) {
  return Number(String(reward).replace(/[^0-9]/g, ""));
}

describe("materializeOffer rolls quota and reward within the template's bounds (AB#1051)", () => {
  const template = MISSION_TEMPLATES.find((t) => t.id === FIRST_CONTRACT_ID);

  it("never leaves the template's quota or reward bounds, over many rolls", () => {
    for (let i = 0; i < 200; i++) {
      const offer = materializeOffer(template);
      expect(offer.quota.resource).toBe(template.resource);
      expect(offer.quota.amount).toBeGreaterThanOrEqual(template.quotaMin);
      expect(offer.quota.amount).toBeLessThanOrEqual(template.quotaMax);
      const rewardCredits = parseRewardCredits(offer.reward);
      expect(rewardCredits).toBeGreaterThanOrEqual(template.rewardMin);
      expect(rewardCredits).toBeLessThanOrEqual(template.rewardMax);
    }
  });

  it("two rolls of the same template can differ — this is the point of the story", () => {
    const quotas = new Set();
    const rewards = new Set();
    for (let i = 0; i < 60; i++) {
      const offer = materializeOffer(template);
      quotas.add(offer.quota.amount);
      rewards.add(parseRewardCredits(offer.reward));
    }
    expect(quotas.size, "60 rolls produced only one quota value").toBeGreaterThan(1);
    expect(rewards.size, "60 rolls produced only one reward value").toBeGreaterThan(1);
  });

  it("keeps the offer's shape identical to what every existing reader expects", () => {
    const offer = materializeOffer(template);
    expect(typeof offer.id).toBe("string");
    expect(typeof offer.title).toBe("string");
    expect(typeof offer.type).toBe("string");
    expect(typeof offer.risk).toBe("string");
    expect(typeof offer.text).toBe("string");
    expect(typeof offer.agentId).toBe("string");
    expect(typeof offer.reward).toBe("string");
    expect(offer.reward).toMatch(/^[\d,]+ Credits$/);
    expect(offer.quota).toEqual({ resource: template.resource, amount: expect.any(Number) });
  });

  it("a real refresh through refreshContractOfferings produces offers within bounds too, not just direct calls", () => {
    const corp = { completedMissions: [], activeMissions: [], contractOfferings: { missions: [], nextRefreshAt: 0 } };
    const offered = refreshContractOfferings(corp).missions;
    for (const offer of offered) {
      const t = MISSION_TEMPLATES.find((x) => x.id === offer.id);
      expect(offer.quota.amount).toBeGreaterThanOrEqual(t.quotaMin);
      expect(offer.quota.amount).toBeLessThanOrEqual(t.quotaMax);
    }
  });
});
