import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, applyRefineryOperations } from "../../server/gameState.js";

// Bug #692: outputs of a refinery cycle landed wherever the corporation was when the cycle ended.
async function refinerAtMars() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.currentSystemId = "sol";
    corp.currentStationId = "mars-orbital-dock";
    corp.unlockedTech = ["tt-material-compression", "tt-nano-lattice"];
    corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: false, chainId: null }];
    corp.inventory = { ...(corp.inventory || {}), "mars-orbital-dock": { Silicates: 100 } };
  });
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  const moveTo = (stationId) => mutateAccountState(account.id, (state) => { state.corp.currentStationId = stationId; });
  const tickPastEnd = () => mutateAccountState(account.id, (state) => {
    applyRefineryOperations(state.corp, Number(state.corp.refineries[0].endsAt) + 1);
  });
  const start = () => api.post(`/api/accounts/${account.id}/gameplay/start-refinery`)
    .send({ refineryId: "ref-1", chainId: "silicates-chain", inputQuantity: 100 });
  return { corp, moveTo, tickPastEnd, start };
}

describe("POST /gameplay/start-refinery output station (Bug #692)", () => {
  it("delivers to Mars, where the inputs came from, after the corporation moves to Luna", async () => {
    const p = await refinerAtMars();
    const res = await p.start();
    expect(res.status).toBe(200);
    expect(p.corp().inventory["mars-orbital-dock"].Silicates || 0).toBe(0);
    expect(p.corp().refineries[0].stationId).toBe("mars-orbital-dock");

    p.moveTo("luna-gateway");
    p.tickPastEnd();
    expect(p.corp().inventory["mars-orbital-dock"]).toMatchObject({ Aerogel: 40, "Quantum Insulators": 15 });
    expect(p.corp().inventory["luna-gateway"]?.Aerogel || 0).toBe(0);
  });

  it("delivers to Mars when the cycle ends in transit, and nothing to Earth Station Prime", async () => {
    const p = await refinerAtMars();
    expect((await p.start()).status).toBe(200);
    p.moveTo(null);
    p.tickPastEnd();
    expect(p.corp().inventory["mars-orbital-dock"]).toMatchObject({ Aerogel: 40, "Quantum Insulators": 15 });
    expect(p.corp().inventory["earth-station-prime"]?.Aerogel || 0).toBe(0);
  });
});
