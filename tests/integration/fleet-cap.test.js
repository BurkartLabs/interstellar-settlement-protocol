import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, fleetStatus } from "../../server/gameState.js";

// Bug #586: fabrication stopped at a hidden cap of 2 that nothing raised, while the sidebar showed a
// Fleet Cap that levels and research raise and no gate read.
const LEVELS = JSON.parse(readFileSync(new URL("../../data/milestones.json", import.meta.url), "utf8")).levels;
const levelCap = (n) => LEVELS.filter((l) => l.level <= n).reduce((m, l) => Math.max(m, l.unlocks.maxFleetSize || 0), 0);

async function prober() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.unlockedTech = ["tt-assembly-fabrication", "tt-asteroid-prospecting"];
    corp.buildings = [...(corp.buildings || []), { name: "Assembly Facility", tier: 1, status: "Operational" }];
    corp.finances.credits = 10_000_000;
  });
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  const set = (fn) => mutateAccountState(account.id, (state) => fn(state.corp));
  const build = () => api.post(`/api/accounts/${account.id}/gameplay/build-mining-probe`).send({});
  return { corp, set, build };
}

// The probes a player owns, without waiting out fabrication.
const own = (corp, hangar, away = 0) => {
  corp.asteroidMining.probeCount = hangar;
  corp.asteroidMining.fabricationQueue = [];
  corp.asteroidMining.activeExpeditions = Array.from({ length: away }, (_, i) => ({ id: `exp-${i}`, beltId: "b", systemId: "sol", startedAt: 0, completesAt: Date.now() + 3_600_000, yields: {} }));
};

describe("Fleet Cap gates probe fabrication (Bug #586)", () => {
  it("raises the fabrication cap when the corporation levels past the first milestones", async () => {
    const p = await prober();
    p.set((c) => { c.level = 0; c.unlocks.maxFleetSize = 0; own(c, 2); });
    expect(p.corp().fleet.cap).toBe(2);
    expect((await p.build()).status).toBe(400);

    p.set((c) => { c.level = 1; c.unlocks.maxFleetSize = levelCap(1); });
    expect(p.corp().fleet.cap).toBe(levelCap(1));
    expect((await p.build()).status).toBe(200);

    p.set((c) => { c.level = 3; c.unlocks.maxFleetSize = levelCap(3); own(c, levelCap(1)); });
    expect(p.corp().fleet.cap).toBe(levelCap(3));
    expect(levelCap(3)).toBeGreaterThan(levelCap(1));
    expect((await p.build()).status).toBe(200);
  });

  it("stops at the cap the sidebar shows, and names what raises it next", async () => {
    const p = await prober();
    p.set((c) => { c.level = 1; c.unlocks.maxFleetSize = levelCap(1); own(c, levelCap(1)); });
    const res = await p.build();
    expect(res.status).toBe(400);
    const next = LEVELS.find((l) => l.level > 1 && l.unlocks.maxFleetSize > levelCap(1));
    expect(res.body.error).toContain(`${levelCap(1)}/${levelCap(1)}`);
    expect(res.body.error).toContain(`Reaching Corporation Level ${next.level} raises it to ${next.unlocks.maxFleetSize}`);
    expect(res.body.error).toContain("Fleet Coordination Matrix research adds 12");
    expect(res.body.error).not.toMatch(/Research or level up/);
  });

  it("adds 12 for Fleet Coordination Matrix, as the research promises", async () => {
    const p = await prober();
    p.set((c) => { c.level = 1; c.unlocks.maxFleetSize = levelCap(1); own(c, levelCap(1)); });
    expect((await p.build()).status).toBe(400);
    p.set((c) => { c.unlockedTech.push("tt-fleet-coordination"); });
    expect(p.corp().fleet.cap).toBe(levelCap(1) + 12);
    expect((await p.build()).status).toBe(200);
  });

  it("counts probes out on expeditions, so a returning probe is never lost to the cap", async () => {
    const p = await prober();
    p.set((c) => { c.level = 1; c.unlocks.maxFleetSize = levelCap(1); own(c, levelCap(1) - 1, 1); });
    expect(p.corp().fleet.vessels).toBe(levelCap(1));
    expect((await p.build()).status).toBe(400);
  });

  it("says so at the top of the ladder with the research done", () => {
    const top = LEVELS.reduce((m, l) => Math.max(m, l.level), 0);
    const fleet = fleetStatus({ level: top, unlocks: { maxFleetSize: levelCap(top) }, unlockedTech: ["tt-fleet-coordination"], asteroidMining: {} });
    expect(fleet.cap).toBe(levelCap(top) + 12);
    expect(fleet.raises).toEqual([]);
    expect(fleet.raiseText).toBe("This is the highest Fleet Cap in this build.");
  });
});
