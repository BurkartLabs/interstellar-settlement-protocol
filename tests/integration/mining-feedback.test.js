import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, BELT_COMPOSITIONS, PROBE_FABRICATION_MS } from "../../server/gameState.js";
import { beltScoutedText, probeFabricationStartedText, probeReadyText, readyInText } from "../../public/scripts/miningFeedback.js";

// AB#1257: pressing Fabricate Mining Probe logged "Mining Probe fabricated." while the facility showed 29m 59s to go
// and the hangar held nothing; scouting logged "Asteroid belt scouted: sol:belt". The lines are built from the state
// the server returns, so these tests build them from real responses.

async function player() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.unlockedTech = ["tt-assembly-fabrication", "tt-asteroid-prospecting"];
    state.corp.buildings = [...(state.corp.buildings || []), { name: "Assembly Facility", tier: 1, status: "Operational" }];
  });
  return { account, api: authed(app, accessToken) };
}

describe("Fabricate Mining Probe says it has started, and when it will be ready (AB#1257)", () => {
  it("from the queue the server returns: started, ready in its fabrication time, and not 'fabricated'", async () => {
    const p = await player();
    const res = await p.api.post(`/api/accounts/${p.account.id}/gameplay/build-mining-probe`).send({});
    expect(res.status).toBe(200);
    const am = res.body.state.corp.asteroidMining;
    expect(am.probeCount || 0).toBe(0); // nothing in the hangar yet
    const job = am.fabricationQueue[0];
    expect(job.completesAt - job.startedAt).toBe(PROBE_FABRICATION_MS); // 10 s here (tests run as dev), 30 min in production
    const line = probeFabricationStartedText(am.fabricationQueue, job.startedAt);
    expect(line).toBe(`Mining Probe fabrication started: ready in ${readyInText(PROBE_FABRICATION_MS)}.`);
    expect(line).not.toMatch(/fabricated/i);
  });

  it("says 30 minutes for the production fabrication time, and rounds up so it never promises early", () => {
    const now = 1_000_000;
    expect(probeFabricationStartedText([{ completesAt: now + 30 * 60_000 }], now)).toBe("Mining Probe fabrication started: ready in 30 minutes.");
    expect(probeFabricationStartedText([{ completesAt: now + 29 * 60_000 + 1 }], now)).toBe("Mining Probe fabrication started: ready in 30 minutes.");
    expect(readyInText(10_000)).toBe("10 seconds");
    expect(readyInText(90 * 60_000)).toBe("1h 30m");
    expect(probeFabricationStartedText([], now)).toBe("Mining Probe fabrication started.");
  });

  it("says fabricated once, when the probe exists", () => {
    expect(probeReadyText(1)).toBe("Mining Probe fabricated: 1 probe in the hangar, ready to launch.");
    expect(probeReadyText(2)).toBe("Mining Probe fabricated: 2 probes in the hangar, ready to launch.");
  });
});

describe("Scouting names the belt and its system, never the key (AB#1257)", () => {
  it("for every belt in the game, from the systems a player's account holds", async () => {
    const p = await player();
    const systems = getAccountById(p.account.id).state.world.systems;
    for (const beltKey of Object.keys(BELT_COMPOSITIONS)) {
      const [systemId, bodyId] = beltKey.split(":");
      const system = systems.find((s) => s.id === systemId);
      const body = system.bodies.find((b) => b.id === bodyId);
      const line = beltScoutedText(beltKey, systems);
      expect(line).toBe(`Scouted the ${body.name} in ${system.name}.`);
      expect(line).not.toContain(beltKey);
      expect(line).not.toContain(":");
    }
  });

  it("reads 'Scouted the Asteroid Belt in Sol.' for Sol", async () => {
    const p = await player();
    expect(beltScoutedText("sol:belt", getAccountById(p.account.id).state.world.systems)).toBe("Scouted the Asteroid Belt in Sol.");
  });

  it("still shows no key when the systems are not loaded", () => {
    expect(beltScoutedText("tau-ceti:tc-cloud", [])).toBe("Scouted the asteroid belt.");
    expect(beltScoutedText("tau-ceti:tc-cloud", undefined)).toBe("Scouted the asteroid belt.");
  });
});
