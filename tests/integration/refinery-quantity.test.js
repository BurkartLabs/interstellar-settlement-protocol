import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// AB#1255: start-refinery raised anything below one batch to a batch (5 Carbon consumed 200) and rounded the rest down.
// It now runs exactly what was asked for, or refuses with the form's reason and leaves the inventory alone.
async function refiner() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    const corp = state.corp;
    corp.currentStationId = "earth-station-prime";
    corp.unlockedTech = ["tt-material-compression", "tt-nano-lattice", "tt-energy-routing"];
    corp.refineries = [{ id: "ref-1", name: "Refinery #1", tier: 1, active: false, chainId: null, totalInputConsumed: 0, totalOutputProduced: 0 }];
    corp.inventory = { "earth-station-prime": { Silicates: 400, Carbon: 450, Titanium: 400 } };
  });
  const api = authed(app, accessToken);
  const corp = () => getAccountById(account.id).state.corp;
  const stock = () => ({ ...corp().inventory["earth-station-prime"] });
  const start = (chainId, inputQuantity) => api.post(`/api/accounts/${account.id}/gameplay/start-refinery`)
    .send({ refineryId: "ref-1", chainId, inputQuantity });
  return { corp, stock, start };
}

describe("start-refinery runs what was asked for, or refuses (AB#1255)", () => {
  it("5 Carbon is refused, not raised to a 200 batch, and nothing is spent", async () => {
    const p = await refiner();
    const before = p.stock();
    const res = await p.start("carbon-chain", 5);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A run needs at least 200 Carbon.");
    expect(p.stock()).toEqual(before);
    expect(p.corp().refineries[0].active).toBe(false);
  });

  it("150 Silicates is refused, not rounded down to 100", async () => {
    const p = await refiner();
    const before = p.stock();
    const res = await p.start("silicates-chain", 150);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Runs use whole batches of 100 Silicates: enter 100 or 200.");
    expect(p.stock()).toEqual(before);
  });

  it("Titanium states its real minimum, two batches of 80", async () => {
    const p = await refiner();
    const res = await p.start("titanium-chain", 100);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A run needs at least 160 Titanium.");
  });

  it("200 Carbon runs one batch and spends exactly 200", async () => {
    const p = await refiner();
    const res = await p.start("carbon-chain", 200);
    expect(res.status).toBe(200);
    expect(p.stock().Carbon).toBe(250);
    expect(p.corp().refineries[0]).toMatchObject({ active: true, chainId: "carbon-chain", cycleScale: 1, totalInputConsumed: 200 });
  });

  it("300 Silicates runs three batches, three times as long", async () => {
    const p = await refiner();
    const res = await p.start("silicates-chain", 300);
    expect(res.status).toBe(200);
    expect(p.stock().Silicates).toBe(100);
    const r = p.corp().refineries[0];
    expect(r.cycleScale).toBe(3);
    expect(Math.round((r.endsAt - r.startedAt) / 3_600_000)).toBe(12);
  });

  it("more than is at the station is refused as before, and nothing is spent", async () => {
    const p = await refiner();
    const res = await p.start("silicates-chain", 500);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Not enough Silicates at this station/);
    expect(p.stock().Silicates).toBe(400);
  });
});
