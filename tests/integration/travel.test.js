import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, listAccountNotifications } from "../../server/gameState.js";
import { vi } from "vitest";
import { travelTick } from "../../server/ticks.js";
import { allStations } from "../../server/game/stations.js";

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

// ISP-255 (AB#4831): a journey's notices carry the protocol line on the Travel screen: In force when the course is set,
// Concluded on arrival.
describe("the travel notices' protocol (AB#4831)", () => {
  it("a course set is In force, and the docking on arrival Concluded", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const to = allStations().find((st) => st.systemId === "sol" && st.id !== "earth-station-prime").id;
    mutateAccountState(account.id, (state) => { state.corp.currentSystemId = "sol"; state.corp.currentStationId = "earth-station-prime"; state.corp.travel = null; });
    const res = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/travel`).send({ toStationId: to });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const notes = () => listAccountNotifications(account.id).notifications;
    expect(notes().find((n) => n.title === "Undocking — Course Set")?.protocol).toEqual({ meaning: "active", screen: "travel" });
    const arrives = getAccountById(account.id).state.corp.travel.arrivesAt;
    vi.spyOn(Date, "now").mockReturnValue(arrives + 1000);
    try { travelTick(); } finally { vi.restoreAllMocks(); }
    expect(notes().find((n) => n.title === "Docking Complete")?.protocol).toEqual({ meaning: "complete", screen: "travel" });
  });
});
