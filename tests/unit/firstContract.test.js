import { describe, it, expect, vi, afterEach } from "vitest";
import { refreshContractOfferings, MISSION_TEMPLATES, FIRST_CONTRACT_ID } from "../../server/gameState.js";
import { WALKTHROUGH_STEPS } from "../../public/scripts/walkthrough.js";
import { ASSIGNED_COORDINATOR } from "../../public/scripts/liaison.js";

// AB#579: the walkthrough ends with Elara Voss promising the player her silicate requisition. Offerings are 2 of 10
// templates at random, so without a rule the promise was true for about one new corporation in five.
const newCorp = () => ({ completedMissions: [], activeMissions: [], contractOfferings: { missions: [], nextRefreshAt: 0 } });

describe("the first contract a new corporation is offered (AB#579)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a real template: Voss's silicate requisition", () => {
    const t = MISSION_TEMPLATES.find((m) => m.id === FIRST_CONTRACT_ID);
    expect(t).toBeTruthy();
    expect(t.agentId).toBe(ASSIGNED_COORDINATOR.id);
    expect(t.resource).toBe("Silicates");
    // AB#1051: a range now, not a fixed 400 — 400 is still inside it (the range this story replaced it with).
    expect(t.quotaMin).toBeLessThanOrEqual(400);
    expect(t.quotaMax).toBeGreaterThanOrEqual(400);
  });

  it("is always offered to a corporation that has never taken a contract, whatever the shuffle", () => {
    for (const r of [0, 0.01, 0.25, 0.5, 0.75, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const offered = refreshContractOfferings(newCorp()).missions.map((m) => m.id);
      expect(offered).toContain(FIRST_CONTRACT_ID);
      expect(offered).toHaveLength(2);
      vi.restoreAllMocks();
    }
  });

  it("is not forced on a corporation that has already completed a contract", () => {
    const corp = { ...newCorp(), completedMissions: [{ id: "ms-log-002", completedAt: 1 }] };
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      corp.contractOfferings = { missions: [], nextRefreshAt: 0 };
      seen.add(refreshContractOfferings(corp).missions.map((m) => m.id).sort().join(","));
    }
    expect([...seen].some((ids) => !ids.includes(FIRST_CONTRACT_ID))).toBe(true);
  });
});

describe("the walkthrough's closing handoff (AB#579)", () => {
  it("names the first contract by its template title, and the step carries its id", () => {
    const last = WALKTHROUGH_STEPS[WALKTHROUGH_STEPS.length - 1];
    const t = MISSION_TEMPLATES.find((m) => m.id === last.handoffContractId);
    expect(last.handoffContractId).toBe(FIRST_CONTRACT_ID);
    expect(t).toBeTruthy();
    expect(t.agentId).toBe("elara-voss");
    expect(last.text).toContain(t.title);
  });
});
