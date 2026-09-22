import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #976: POST /gameplay/travel refused a corporation at a near star the jump home to Sol unless it had
// deep-star navigation, stranding anyone who had researched only Proxima navigation.
async function corpAt(systemId, unlockedTech) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.currentSystemId = systemId;
    state.corp.currentStationId = null;
    state.corp.travel = null;
    state.corp.unlockedTech = unlockedTech;
  });
  const api = authed(app, accessToken);
  const travel = (toSystemId) => api.post(`/api/accounts/${account.id}/gameplay/travel`).send({ toSystemId });
  const corp = () => getAccountById(account.id).state.corp;
  return { travel, corp };
}

describe("POST /api/accounts/:id/gameplay/travel research gate (Bug #976)", () => {
  it("lets a corporation at Alpha Centauri with only Proxima navigation jump home to Sol", async () => {
    const { travel, corp } = await corpAt("alpha-centauri", ["tt-proxima-navigation"]);
    expect(corp().currentSystemId).toBe("alpha-centauri");
    const res = await travel("sol");
    expect(res.status).toBe(200);
    expect(corp().travel).toMatchObject({ travelType: "interstellar", fromSystemId: "alpha-centauri", toSystemId: "sol" });
  });

  it("still refuses that corporation a deep-star system and starts no journey", async () => {
    const { travel, corp } = await corpAt("alpha-centauri", ["tt-proxima-navigation"]);
    const res = await travel("epsilon-eridani");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Requires Deep-Star Cartography Suite/); // Bug #1270: the research is named
    expect(corp().travel).toBeFalsy();
  });

  it("still refuses a corporation in Sol with no research a near star", async () => {
    const { travel, corp } = await corpAt("sol", []);
    const res = await travel("alpha-centauri");
    expect(res.status).toBe(400);
    expect(corp().travel).toBeFalsy();
  });
});
