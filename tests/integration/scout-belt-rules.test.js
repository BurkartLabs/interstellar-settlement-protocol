import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #1256: scout-belt revealed any belt's composition in any system with no research and no travel, though the
// Starmap locks mining behind Asteroid Prospecting Arrays. Scouting now takes the research and a presence in the
// belt's system, as launch-expedition does. It still costs nothing: whether it should is the PM's question.
async function corp({ research = false } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const api = authed(app, accessToken);
  if (research) {
    mutateAccountState(account.id, (state) => {
      state.corp.unlockedTech = [...(state.corp.unlockedTech || []), "tt-asteroid-prospecting"];
    });
  }
  const scout = (beltKey) => api.post(`/api/accounts/${account.id}/gameplay/scout-belt`).send({ beltKey });
  const compositions = () => api.get(`/api/accounts/${account.id}/gameplay/belt-compositions`);
  const scouted = () => getAccountById(account.id).state.corp.asteroidMining?.scoutedBelts || [];
  const credits = () => getAccountById(account.id).state.corp.finances.credits;
  return { id: account.id, scout, compositions, scouted, credits };
}

describe("scout-belt takes the research and the belt's system (Bug #1256)", () => {
  it("refuses a new corporation without the research, naming it, and reveals nothing", async () => {
    const c = await corp();
    for (const beltKey of ["sol:belt", "tau-ceti:tc-cloud"]) {
      const res = await c.scout(beltKey);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Research Asteroid Prospecting Arrays in Corporate R&D to scout asteroid belts.");
    }
    expect(c.scouted()).toEqual([]);
    expect((await c.compositions()).body.compositions).toEqual({});
  });

  it("with the research, refuses a belt in another system and changes nothing", async () => {
    const c = await corp({ research: true });
    const res = await c.scout("tau-ceti:tc-cloud");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same system as the asteroid belt/);
    expect(c.scouted()).toEqual([]);
  });

  it("with the research, scouts the belt in the corporation's own system at no cost", async () => {
    const c = await corp({ research: true });
    const before = c.credits();
    const res = await c.scout("sol:belt");
    expect(res.status).toBe(200);
    expect(c.scouted()).toEqual(["sol:belt"]);
    expect(Object.keys((await c.compositions()).body.compositions)).toEqual(["sol:belt"]);
    expect(c.credits()).toBe(before);
  });

  it("scouting a belt again is still accepted and adds nothing", async () => {
    const c = await corp({ research: true });
    await c.scout("sol:belt");
    expect((await c.scout("sol:belt")).status).toBe(200);
    expect(c.scouted()).toEqual(["sol:belt"]);
  });

  it("an unknown belt is refused as before", async () => {
    const c = await corp({ research: true });
    expect((await c.scout("sol:nowhere")).status).toBe(400);
  });
});
