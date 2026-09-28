import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { deploymentCapText, deploymentRaise } from "../../server/game/progression.js";

// Bug AB#2310: with every deployment slot in use, a launch was refused with "Wait for a probe to return or research
// additional capacity". No research grants a deployment slot in this build; only corporation levels do
// (data/milestones.json, unlocks.maxDeployments: 2 at Level 12, 3 at Level 24). The refusal now names the next level
// that raises the cap, or nothing past waiting when none does.

describe("what raises the deployment cap, in words (Bug AB#2310)", () => {
  const corp = (level, maxDeployments, active = maxDeployments) => ({
    level,
    asteroidMining: { maxDeployments, activeExpeditions: Array.from({ length: active }, (_, i) => ({ id: `e${i}` })) },
  });

  it("names the next level whose unlocks raise the cap, and never research", () => {
    expect(deploymentCapText(corp(5, 1))).toBe("All deployment slots are occupied (1/1). Wait for a probe to return. Reaching Corporation Level 12 raises it to 2.");
    expect(deploymentCapText(corp(12, 2))).toBe("All deployment slots are occupied (2/2). Wait for a probe to return. Reaching Corporation Level 24 raises it to 3.");
    expect(deploymentRaise(corp(0, 1))).toEqual({ level: 12, cap: 2 }); // Level 11's unlock is 1, which raises nothing
  });

  it("a corporation at the cap with no level left to raise it is told to wait, and nothing else", () => {
    const text = deploymentCapText(corp(30, 3));
    expect(text).toBe("All deployment slots are occupied (3/3). Wait for a probe to return.");
    expect(deploymentRaise(corp(24, 3))).toBeNull();
    for (const c of [corp(0, 1), corp(12, 2), corp(24, 3), corp(30, 3), { level: 3 }]) expect(deploymentCapText(c)).not.toMatch(/research/i);
  });

  it("a corporation with no mining record yet reads the base cap", () => {
    expect(deploymentCapText({ level: 0 })).toBe("All deployment slots are occupied (0/1). Wait for a probe to return. Reaching Corporation Level 12 raises it to 2.");
  });
});

describe("the launch refusal, through the route (Bug AB#2310)", () => {
  async function miner(level, maxDeployments) {
    const { app } = await getApp();
    const reg = await registerAccount(app);
    mutateAccountState(reg.account.id, (s) => {
      s.corp.level = level;
      s.corp.finances.credits = 1_000_000;
      s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), "tt-asteroid-prospecting"])];
      s.corp.currentStationId = "earth-station-prime";
      s.corp.asteroidMining = { probeCount: maxDeployments + 2, maxDeployments, fabricationQueue: [], activeExpeditions: [], completedExpeditions: [], scoutedBelts: ["sol:belt"], scoutedGenerations: { "sol:belt": 1 } };
    }, { sanitize: false, settleMining: false });
    const api = authed(app, reg.accessToken);
    const launch = () => api.post(`/api/accounts/${reg.account.id}/gameplay/launch-expedition`).send({ beltKey: "sol:belt", duration: "extended" });
    return { launch, corp: () => getAccountById(reg.account.id).state.corp };
  }

  it("at the top cap, the refusal says to wait, and does not mention research", async () => {
    const m = await miner(30, 3);
    for (let i = 0; i < 3; i++) {
      const ok = await m.launch();
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    }
    const res = await m.launch();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("All deployment slots are occupied (3/3). Wait for a probe to return.");
    expect(m.corp().asteroidMining.activeExpeditions).toHaveLength(3);
  });

  it("below Level 12, the refusal names Level 12, which raises the cap to 2", async () => {
    const m = await miner(5, 1);
    expect((await m.launch()).status).toBe(200);
    const res = await m.launch();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("All deployment slots are occupied (1/1). Wait for a probe to return. Reaching Corporation Level 12 raises it to 2.");
  });
});
